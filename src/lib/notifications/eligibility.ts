// Pure filtering: given a batch of agents and "now", which of them are due
// for which scheduled email. No DB access here on purpose -- the cron route
// does one bulk fetch of agents/prefs/log/activity, builds the lookup sets,
// and this function stays unit-testable without a database.
import { kindsInWindow, localParts, resolveTimeZone, type NotificationKind } from './window';

export interface AgentForEligibility {
  agentId: string;
  role: 'associate' | 'leader' | 'admin';
  timeZone: string | null;
  prefs: {
    eveningNudge: boolean;
    sundaySummary: boolean;
    mondayDigest: boolean;
  };
}

export interface DueNotification {
  agentId: string;
  kind: NotificationKind;
  /** The agent-local calendar date this send is for -- the notification_log key. */
  localDateIso: string;
}

export interface EligibilityInput {
  agents: AgentForEligibility[];
  now: Date;
  /** Keys already sent today, formatted `${agentId}:${kind}:${localDateIso}`. */
  alreadySent: ReadonlySet<string>;
  /** Agents (by id) who have logged any activity for today's local date. */
  loggedToday: ReadonlySet<string>;
}

// 09-account-and-auth.md rows: evening_nudge and sunday_summary go to
// associates, monday_digest goes to the SMD (leader/admin). A person has one
// role, so no one is ever eligible for more than one kind on a given day --
// that alone satisfies "never more than one per day per person".
function roleAllows(kind: NotificationKind, role: AgentForEligibility['role']): boolean {
  if (kind === 'monday_digest') return role === 'leader' || role === 'admin';
  return role === 'associate';
}

function prefAllows(kind: NotificationKind, prefs: AgentForEligibility['prefs']): boolean {
  if (kind === 'evening_nudge') return prefs.eveningNudge;
  if (kind === 'sunday_summary') return prefs.sundaySummary;
  return prefs.mondayDigest;
}

export function agentsDueNow({ agents, now, alreadySent, loggedToday }: EligibilityInput): DueNotification[] {
  const due: DueNotification[] = [];
  for (const agent of agents) {
    const parts = localParts(resolveTimeZone(agent.timeZone), now);
    for (const kind of kindsInWindow(parts)) {
      if (!roleAllows(kind, agent.role)) continue;
      if (!prefAllows(kind, agent.prefs)) continue;
      if (alreadySent.has(`${agent.agentId}:${kind}:${parts.dateIso}`)) continue;
      // Only evening_nudge is conditioned on "nothing logged today" per its
      // spec row -- sunday_summary and monday_digest are unconditional
      // summaries, not reminders, so a logged Sunday doesn't suppress them.
      if (kind === 'evening_nudge' && loggedToday.has(agent.agentId)) continue;
      due.push({ agentId: agent.agentId, kind, localDateIso: parts.dateIso });
    }
  }
  return due;
}
