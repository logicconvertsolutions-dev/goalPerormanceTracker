import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';
import { addDays, cycleBounds, previousCycleBounds, nextCycleStart } from '@/lib/dates';
import { currentStreak } from '@/lib/metrics';
import { localParts, resolveTimeZone } from './window';
import {
  eveningNudgeEmail,
  cycleSummaryEmail,
  cycleDigestEmail,
  nudgeEmail,
  trainingReminderEmail,
  type EmailContent,
} from './templates';

type AdminClient = SupabaseClient<Database>;
type DailyMetricsRow = Database['public']['Tables']['daily_metrics']['Row'];

// Mirrors public.system_team_period_summary / private.team_period_summary_for's
// `returns table (...)` (20260906092000_p17b) -- spelled out explicitly
// rather than inferred through the RPC generic, so the reduce/map/sort below
// stay typed even before `npm run types` has run.
interface TeamPeriodSummaryRow {
  agent_id: string;
  full_name: string;
  depth: number;
  calls_made: number;
  appts_set: number;
  appts_held: number;
  premium_cents: number;
  calls_target: number;
  appts_held_target: number;
  premium_cents_target: number;
  pct_calls: number | null;
  streak_days: number;
  last_logged_at: string | null;
  has_override: boolean;
}

export interface NotifiableAgent {
  id: string;
  email: string;
  full_name: string;
  time_zone: string | null;
}

const STREAK_LOOKBACK_DAYS = 30;

async function fetchStreakDays(
  admin: AdminClient,
  agentId: string,
  minCallsPerDay: number,
  asOfIso: string
): Promise<number> {
  const { data } = await admin
    .from('daily_metrics')
    .select('*')
    .eq('agent_id', agentId)
    .gte('activity_date', addDays(asOfIso, -STREAK_LOOKBACK_DAYS))
    .lte('activity_date', asOfIso);

  const rowsByDate = new Map<string, DailyMetricsRow>();
  for (const row of data ?? []) rowsByDate.set(row.activity_date, row);
  return currentStreak(rowsByDate, minCallsPerDay, asOfIso);
}

async function fetchTarget(admin: AdminClient, agentId: string, localDateIso: string) {
  const { data, error } = await admin.rpc('system_effective_target', {
    p_agent_id: agentId,
    p_period_start: cycleBounds(new Date(`${localDateIso}T00:00:00Z`)).from,
  });
  // effective_target always resolves to exactly one row (fallback defaults
  // coalesce to a value) -- a missing row here means the RPC call itself
  // failed, worth surfacing since the caller silently skips the send.
  if (error) console.error(`[notifications] system_effective_target failed for ${agentId}`, error);
  return data?.[0] ?? null;
}

/** Evening nudge -- 7pm local, agent (associate or leader) hasn't logged anything today yet. */
export async function composeEveningNudge(
  admin: AdminClient,
  agent: NotifiableAgent,
  localDateIso: string
): Promise<{ to: string; content: EmailContent } | null> {
  const target = await fetchTarget(admin, agent.id, localDateIso);
  if (!target) return null;
  // asOf = yesterday: today has no qualifying calls yet (that's why this is
  // firing), so "current streak" means the run ending yesterday.
  const streakDays = await fetchStreakDays(admin, agent.id, target.min_calls_per_day, addDays(localDateIso, -1));
  return {
    to: agent.email,
    content: eveningNudgeEmail({
      agentId: agent.id,
      fullName: agent.full_name,
      streakDays,
      minCallsPerDay: target.min_calls_per_day,
    }),
  };
}

/** Cycle summary -- 6pm local on the cycle's last day, cycle-in-review for the agent (associate or leader). */
export async function composeCycleSummary(
  admin: AdminClient,
  agent: NotifiableAgent,
  localDateIso: string
): Promise<{ to: string; content: EmailContent } | null> {
  const target = await fetchTarget(admin, agent.id, localDateIso);
  if (!target) return null;

  const cycleStart = cycleBounds(new Date(`${localDateIso}T00:00:00Z`)).from;
  const { data: cycleRows } = await admin
    .from('daily_metrics')
    .select('calls_made')
    .eq('agent_id', agent.id)
    .gte('activity_date', cycleStart)
    .lte('activity_date', localDateIso);
  const callsMade = (cycleRows ?? []).reduce((sum, r) => sum + r.calls_made, 0);

  const streakDays = await fetchStreakDays(admin, agent.id, target.min_calls_per_day, localDateIso);

  const nextCycleStartDate = nextCycleStart(localDateIso);
  const nextCycleEndDate = cycleBounds(new Date(`${nextCycleStartDate}T00:00:00Z`)).to;
  const { count } = await admin
    .from('call_logs')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agent.id)
    .is('follow_up_done_at', null)
    .gte('follow_up_on', nextCycleStartDate)
    .lte('follow_up_on', nextCycleEndDate);

  return {
    to: agent.email,
    content: cycleSummaryEmail({
      agentId: agent.id,
      fullName: agent.full_name,
      callsMade,
      callsTarget: target.calls_per_cycle,
      streakDays,
      followUpsDueNextCycle: count ?? 0,
    }),
  };
}

/** Cycle digest -- 8am local on the cycle's first day, team roster summary for the SMD. */
export async function composeCycleDigest(
  admin: AdminClient,
  leader: NotifiableAgent,
  localDateIso: string
): Promise<{ to: string; content: EmailContent } | null> {
  const cycle = cycleBounds(new Date(`${localDateIso}T00:00:00Z`));
  const lastCycle = previousCycleBounds(new Date(`${localDateIso}T00:00:00Z`));

  const [{ data: thisCycle }, { data: lastCycleData }] = await Promise.all([
    admin.rpc('system_team_period_summary', { p_leader_id: leader.id, p_from: cycle.from, p_to: cycle.to }),
    admin.rpc('system_team_period_summary', { p_leader_id: leader.id, p_from: lastCycle.from, p_to: lastCycle.to }),
  ]);
  const roster: TeamPeriodSummaryRow[] = thisCycle ?? [];
  if (roster.length === 0) return null;

  const totalCalls = roster.reduce((sum: number, r) => sum + r.calls_made, 0);
  const totalCallsTarget = roster.reduce((sum: number, r) => sum + r.calls_target, 0);
  const totalPremiumCents = roster.reduce((sum: number, r) => sum + Number(r.premium_cents), 0);

  const quietAgentNames = roster.filter((r) => r.calls_made === 0).map((r) => r.full_name);

  const lastCycleRoster: TeamPeriodSummaryRow[] = lastCycleData ?? [];
  const lastCycleByAgent = new Map(lastCycleRoster.map((r) => [r.agent_id, r.calls_made]));
  const moverNames = roster
    .map((r) => ({ name: r.full_name, delta: r.calls_made - (lastCycleByAgent.get(r.agent_id) ?? 0) }))
    .filter((m) => m.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3)
    .map((m) => m.name);

  return {
    to: leader.email,
    content: cycleDigestEmail({
      agentId: leader.id,
      fullName: leader.full_name,
      totalCalls,
      totalCallsTarget,
      totalPremiumCents,
      quietAgentNames,
      moverNames,
    }),
  };
}

/**
 * The SMD's per-agent nudge -- either the manual one-off (public.nudge_agent
 * rate-limits to 1/day) or, when `recurring` is set, the automatic daily
 * version (p12a: agents.auto_call_nudges_enabled). See nudgeEmail's own doc
 * comment for why only the recurring one carries an unsubscribe link.
 */
export async function composeNudge(
  admin: AdminClient,
  agent: NotifiableAgent,
  sentByName: string,
  recurring = false
): Promise<{ to: string; content: EmailContent } | null> {
  const localDateIso = localParts(resolveTimeZone(agent.time_zone), new Date()).dateIso;
  const target = await fetchTarget(admin, agent.id, localDateIso);
  if (!target) return null;
  const streakDays = await fetchStreakDays(admin, agent.id, target.min_calls_per_day, addDays(localDateIso, -1));
  return {
    to: agent.email,
    content: nudgeEmail({
      agentId: agent.id,
      fullName: agent.full_name,
      sentByName,
      streakDays,
      minCallsPerDay: target.min_calls_per_day,
      recurring,
    }),
  };
}

/** The SMD's ad-hoc per-agent training reminder — distinct from composeNudge
 * above (public.send_training_reminder rate-limits to 1/day, separately
 * from nudge_agent's own cooldown). No target/streak lookup needed since
 * this isn't about daily activity. */
export async function composeTrainingReminder(
  agent: NotifiableAgent,
  sentByName: string
): Promise<{ to: string; content: EmailContent }> {
  return {
    to: agent.email,
    content: trainingReminderEmail({ agentId: agent.id, fullName: agent.full_name, sentByName }),
  };
}
