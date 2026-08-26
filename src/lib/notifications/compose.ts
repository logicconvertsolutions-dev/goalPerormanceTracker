import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';
import { addDays, weekStart, nextMonday } from '@/lib/dates';
import { currentStreak } from '@/lib/metrics';
import { localParts, resolveTimeZone } from './window';
import {
  eveningNudgeEmail,
  sundaySummaryEmail,
  mondayDigestEmail,
  nudgeEmail,
  trainingReminderEmail,
  type EmailContent,
} from './templates';

type AdminClient = SupabaseClient<Database>;
type DailyMetricsRow = Database['public']['Tables']['daily_metrics']['Row'];

// Mirrors public.system_team_week_summary / private.team_week_summary_for's
// `returns table (...)` (20260819090000_p55a_notifications.sql) -- spelled
// out explicitly rather than inferred through the RPC generic, so the
// reduce/map/sort below stay typed even before `npm run types` has run.
interface TeamWeekSummaryRow {
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
    p_week: weekStart(new Date(`${localDateIso}T00:00:00Z`)),
  });
  // effective_target always resolves to exactly one row (fallback defaults
  // coalesce to a value) -- a missing row here means the RPC call itself
  // failed, worth surfacing since the caller silently skips the send.
  if (error) console.error(`[notifications] system_effective_target failed for ${agentId}`, error);
  return data?.[0] ?? null;
}

/** Evening nudge -- 7pm local, associate hasn't logged anything today yet. */
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

/** Sunday summary -- 6pm local, week-in-review for the associate. */
export async function composeSundaySummary(
  admin: AdminClient,
  agent: NotifiableAgent,
  localDateIso: string
): Promise<{ to: string; content: EmailContent } | null> {
  const target = await fetchTarget(admin, agent.id, localDateIso);
  if (!target) return null;

  const ws = weekStart(new Date(`${localDateIso}T00:00:00Z`));
  const { data: weekRows } = await admin
    .from('daily_metrics')
    .select('calls_made')
    .eq('agent_id', agent.id)
    .gte('activity_date', ws)
    .lte('activity_date', localDateIso);
  const callsMade = (weekRows ?? []).reduce((sum, r) => sum + r.calls_made, 0);

  const streakDays = await fetchStreakDays(admin, agent.id, target.min_calls_per_day, localDateIso);

  const nextWeekStart = nextMonday(localDateIso);
  const nextWeekEnd = addDays(nextWeekStart, 6);
  const { count } = await admin
    .from('call_logs')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agent.id)
    .is('follow_up_done_at', null)
    .gte('follow_up_on', nextWeekStart)
    .lte('follow_up_on', nextWeekEnd);

  return {
    to: agent.email,
    content: sundaySummaryEmail({
      agentId: agent.id,
      fullName: agent.full_name,
      callsMade,
      callsTarget: target.calls_per_week,
      streakDays,
      followUpsDueNextWeek: count ?? 0,
    }),
  };
}

/** Monday digest -- 8am local, team roster summary for the SMD. */
export async function composeMondayDigest(
  admin: AdminClient,
  leader: NotifiableAgent,
  localDateIso: string
): Promise<{ to: string; content: EmailContent } | null> {
  const ws = weekStart(new Date(`${localDateIso}T00:00:00Z`));
  const lastWeekStart = addDays(ws, -7);

  const [{ data: thisWeek }, { data: lastWeek }] = await Promise.all([
    admin.rpc('system_team_week_summary', { p_leader_id: leader.id, p_week_start: ws }),
    admin.rpc('system_team_week_summary', { p_leader_id: leader.id, p_week_start: lastWeekStart }),
  ]);
  const roster: TeamWeekSummaryRow[] = thisWeek ?? [];
  if (roster.length === 0) return null;

  const totalCalls = roster.reduce((sum: number, r) => sum + r.calls_made, 0);
  const totalCallsTarget = roster.reduce((sum: number, r) => sum + r.calls_target, 0);
  const totalPremiumCents = roster.reduce((sum: number, r) => sum + Number(r.premium_cents), 0);

  const quietAgentNames = roster.filter((r) => r.calls_made === 0).map((r) => r.full_name);

  const lastWeekRoster: TeamWeekSummaryRow[] = lastWeek ?? [];
  const lastWeekByAgent = new Map(lastWeekRoster.map((r) => [r.agent_id, r.calls_made]));
  const moverNames = roster
    .map((r) => ({ name: r.full_name, delta: r.calls_made - (lastWeekByAgent.get(r.agent_id) ?? 0) }))
    .filter((m) => m.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3)
    .map((m) => m.name);

  return {
    to: leader.email,
    content: mondayDigestEmail({
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

/** The SMD's ad-hoc per-agent nudge (public.nudge_agent already rate-limits to 1/7 days). */
export async function composeNudge(
  admin: AdminClient,
  agent: NotifiableAgent,
  sentByName: string
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
    }),
  };
}

/** The SMD's ad-hoc per-agent training reminder — distinct from composeNudge
 * above (public.send_training_reminder rate-limits to 1/7 days, separately
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
