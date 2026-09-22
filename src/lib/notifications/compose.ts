import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';
import {
  addDays,
  cycleBounds,
  previousCycleBounds,
  nextCycleStart,
  formatCycleRange,
  formatShortDate,
} from '@/lib/dates';
import { currentStreak } from '@/lib/metrics';
import { localParts, resolveTimeZone } from './window';
import {
  eveningNudgeEmail,
  cycleSummaryEmail,
  cycleDigestEmail,
  type CycleDigestAgent,
  type CycleDigestCallout,
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

// --- Cycle digest tuning -------------------------------------------------
// Thresholds for "who should the SMD talk to." Deliberately constants rather
// than per-org settings: there is no UI to tune them and inventing one would
// be a bigger change than the digest itself.
const UNDER_TARGET_PCT = 60; // below this share of the call target -> a callout
const SEVERE_PCT = 25; // below this, the callout is flagged severe
const LOW_SET_RATE_PCT = 5; // dialing plenty but converting almost none
const LOW_SET_RATE_MIN_CALLS = 40; // ...only meaningful above a real call volume
const HELD_RATE_PCT = 60; // appts set that never got held
const STALE_DAYS = 5; // silence long enough to be worth naming
const ATTENTION_LIMIT = 5; // a list of everyone is not a list
const BANNER_SHARE = 0.6; // this share under target -> a team-level banner
const MOVER_LIMIT = 3;
const LAST_ACTIVE_LOOKBACK_DAYS = 120;

interface AgentExtras {
  recruits: number;
  sales: number;
}

/**
 * recruiting_convos / sales_count for a window.
 *
 * system_team_period_summary does not return either, so this reads the read
 * model directly (CLAUDE.md rule 10 -- daily_metrics *is* the read model; the
 * rule forbids aggregating raw activity tables, which this does not do).
 * `agentIds` is always the id list the RPC itself just returned, so the
 * hierarchy and org fences still come from the SECURITY DEFINER function --
 * no scoping logic is re-derived here.
 */
async function fetchDigestExtras(
  admin: AdminClient,
  agentIds: string[],
  from: string,
  to: string
): Promise<Map<string, AgentExtras>> {
  const { data } = await admin
    .from('daily_metrics')
    .select('agent_id, recruiting_convos, sales_count')
    .in('agent_id', agentIds)
    .gte('activity_date', from)
    .lte('activity_date', to);

  const byAgent = new Map<string, AgentExtras>();
  for (const row of data ?? []) {
    const acc = byAgent.get(row.agent_id) ?? { recruits: 0, sales: 0 };
    acc.recruits += row.recruiting_convos;
    acc.sales += row.sales_count;
    byAgent.set(row.agent_id, acc);
  }
  return byAgent;
}

/**
 * Each agent's last day carrying any activity, up to and including the send
 * date -- deliberately NOT windowed to the reported cycle, since "has this
 * person logged anything since" is the question an SMD is actually asking,
 * and someone who logged this morning should not be chased.
 *
 * Not taken from the RPC's `last_logged_at`, which before P26 was
 * max(updated_at) -- a recompute timestamp, not an activity date.
 */
async function fetchLastActive(
  admin: AdminClient,
  agentIds: string[],
  asOfIso: string
): Promise<Map<string, string>> {
  const { data } = await admin
    .from('daily_metrics')
    .select(
      'agent_id, activity_date, calls_made, appts_set, sales_count, recruiting_convos, appt_held, referrals_given'
    )
    .in('agent_id', agentIds)
    .gte('activity_date', addDays(asOfIso, -LAST_ACTIVE_LOOKBACK_DAYS))
    .lte('activity_date', asOfIso);

  const byAgent = new Map<string, string>();
  for (const row of data ?? []) {
    const hadActivity =
      row.calls_made > 0 ||
      row.appts_set > 0 ||
      row.sales_count > 0 ||
      row.recruiting_convos > 0 ||
      row.appt_held > 0 ||
      row.referrals_given > 0;
    if (!hadActivity) continue;
    const seen = byAgent.get(row.agent_id);
    if (!seen || row.activity_date > seen) byAgent.set(row.agent_id, row.activity_date);
  }
  return byAgent;
}

export interface DigestAgentInput {
  agentId: string;
  name: string;
  calls: number;
  callsTarget: number;
  apptsSet: number;
  apptsHeld: number;
  sales: number;
  premiumCents: number;
  recruits: number;
  priorCalls: number;
  lastActiveIso: string | null;
}

export interface DigestCallouts {
  banner: { title: string; body: string } | null;
  attention: CycleDigestCallout[];
  movers: { name: string; note: string }[];
}

const share = (n: number, d: number) => (d > 0 ? Math.round((100 * n) / d) : 0);
const daysBetween = (fromIso: string, toIso: string) =>
  Math.round(
    (new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86_400_000
  );

/**
 * Turns the roster into the three human-readable sections of the digest.
 * Pure on purpose -- every threshold rule is unit-testable without a database.
 */
export function buildDigestCallouts(agents: DigestAgentInput[], asOfIso: string): DigestCallouts {
  const scored = agents.map((a) => {
    const pct = share(a.calls, a.callsTarget);
    const setRate = share(a.apptsSet, a.calls);
    const heldRate = share(a.apptsHeld, a.apptsSet);
    const staleDays = a.lastActiveIso === null ? Infinity : daysBetween(a.lastActiveIso, asOfIso);
    return { ...a, pct, setRate, heldRate, staleDays };
  });

  const hintFor = (a: (typeof scored)[number]): string | undefined => {
    if (a.calls === 0 && a.priorCalls > 0) {
      return `Logged ${a.priorCalls} calls last cycle — the drop to zero is the signal`;
    }
    if (a.lastActiveIso === null) return 'Has never logged anything';
    if (a.staleDays >= STALE_DAYS) return `Nothing logged since ${formatShortDate(a.lastActiveIso)}`;
    if (a.apptsSet > 0 && a.apptsHeld === 0) {
      return `${a.apptsSet} appointment${a.apptsSet === 1 ? '' : 's'} set, none held`;
    }
    if (a.priorCalls > a.calls) return `Down from ${a.priorCalls} calls last cycle`;
    return undefined;
  };

  // Lower rank = more urgent; ties break on how far under target they are.
  const ranked = scored
    .map((a) => {
      if (a.calls === 0) {
        return { a, rank: 0, reason: `0 of ${a.callsTarget} calls`, severe: true };
      }
      if (a.pct < UNDER_TARGET_PCT) {
        return {
          a,
          rank: 1,
          reason: `${a.calls} of ${a.callsTarget} calls (${a.pct}%)`,
          severe: a.pct < SEVERE_PCT,
        };
      }
      if (a.apptsSet > 0 && a.heldRate < HELD_RATE_PCT) {
        return { a, rank: 2, reason: `${a.apptsSet} appts set, only ${a.apptsHeld} held`, severe: false };
      }
      if (a.calls >= LOW_SET_RATE_MIN_CALLS && a.setRate < LOW_SET_RATE_PCT) {
        return {
          a,
          rank: 3,
          reason: `${a.calls} calls to ${a.apptsSet} appts set (${a.setRate}% set rate)`,
          severe: false,
        };
      }
      return null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((x, y) => Number(y.severe) - Number(x.severe) || x.rank - y.rank || x.a.pct - y.a.pct);

  const attention: CycleDigestCallout[] = ranked.slice(0, ATTENTION_LIMIT).map((x) => ({
    name: x.a.name,
    reason: x.reason,
    hint: hintFor(x.a),
    severe: x.severe,
  }));

  // When most of the roster misses the same way, the useful statement is
  // about the team, not about each person in turn.
  const underTarget = scored.filter((a) => a.calls === 0 || a.pct < UNDER_TARGET_PCT);
  const totalCalls = scored.reduce((sum, a) => sum + a.calls, 0);
  const totalTarget = scored.reduce((sum, a) => sum + a.callsTarget, 0);
  const everyone = underTarget.length === scored.length;
  const banner =
    scored.length >= 3 && underTarget.length / scored.length >= BANNER_SHARE
      ? {
          title: everyone
            ? `Every one of the ${scored.length} is under ${UNDER_TARGET_PCT}% of their call target.`
            : `${underTarget.length} of ${scored.length} are under ${UNDER_TARGET_PCT}% of their call target.`,
          body: `The team logged ${totalCalls} calls against ${totalTarget}.${
            everyone
              ? ' When the whole roster misses by this much it is usually one tracking-habit conversation, not ' +
                `${scored.length} separate performance conversations.`
              : ''
          }`,
        }
      : null;

  const movers = scored
    .map((a) => ({ a, delta: a.calls - a.priorCalls }))
    .filter((m) => m.delta > 0)
    .sort((x, y) => y.delta - x.delta)
    .slice(0, MOVER_LIMIT);

  const onlyMover = movers.length === 1 && scored.length >= 3;
  return {
    banner,
    attention,
    movers: movers.map((m) => ({
      name: m.a.name,
      note:
        `+${m.delta} calls` +
        (m.a.premiumCents > 0 ? ` and ${formatCents(m.a.premiumCents)} premium` : '') +
        (onlyMover ? ' — the only positive move on the team' : ''),
    })),
  };
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/**
 * Cycle digest -- 8am local on the cycle's first day, team roster summary
 * for the SMD. It reports the cycle that just *closed*, not the one that
 * opened a few hours earlier.
 *
 * A digest anchored to the cycle containing `localDateIso` is structurally
 * empty: it fires at 08:00 on day 1/11/21, so that cycle is at most eight
 * hours old -- every total reads ~0 against a full cycle's target, every
 * agent lands in the quiet list, and no per-agent delta can be positive so
 * there are never any movers. It shipped that way in P14a (8am Monday,
 * summarising the week that started that morning) and P18 carried the same
 * off-by-one-cycle window over to the 10-day cadence verbatim. Totals-vs-
 * target, a quiet list and biggest movers are all retrospective by nature,
 * so the only window where they mean anything is the cycle that ended
 * yesterday -- with the cycle before that as the comparison.
 */
export async function composeCycleDigest(
  admin: AdminClient,
  leader: NotifiableAgent,
  localDateIso: string
): Promise<{ to: string; content: EmailContent } | null> {
  // The cycle being reported: the one that ended the day before this fires.
  const cycle = previousCycleBounds(new Date(`${localDateIso}T00:00:00Z`));
  // Its predecessor, the comparison for every delta in the email.
  const priorCycle = previousCycleBounds(new Date(`${cycle.from}T00:00:00Z`));

  const [{ data: cycleData }, { data: priorCycleData }] = await Promise.all([
    admin.rpc('system_team_period_summary', { p_leader_id: leader.id, p_from: cycle.from, p_to: cycle.to }),
    admin.rpc('system_team_period_summary', { p_leader_id: leader.id, p_from: priorCycle.from, p_to: priorCycle.to }),
  ]);
  const roster: TeamPeriodSummaryRow[] = cycleData ?? [];
  if (roster.length === 0) return null;

  const agentIds = roster.map((r) => r.agent_id);
  const priorRoster: TeamPeriodSummaryRow[] = priorCycleData ?? [];
  const priorByAgent = new Map(priorRoster.map((r) => [r.agent_id, r]));

  const [cycleExtras, priorExtras, lastActive] = await Promise.all([
    fetchDigestExtras(admin, agentIds, cycle.from, cycle.to),
    fetchDigestExtras(admin, agentIds, priorCycle.from, priorCycle.to),
    fetchLastActive(admin, agentIds, localDateIso),
  ]);
  const extrasFor = (m: Map<string, AgentExtras>, id: string) => m.get(id) ?? { recruits: 0, sales: 0 };

  const inputs: DigestAgentInput[] = roster.map((r) => ({
    agentId: r.agent_id,
    name: r.full_name,
    calls: r.calls_made,
    callsTarget: r.calls_target,
    apptsSet: r.appts_set,
    apptsHeld: r.appts_held,
    sales: extrasFor(cycleExtras, r.agent_id).sales,
    premiumCents: Number(r.premium_cents),
    recruits: extrasFor(cycleExtras, r.agent_id).recruits,
    priorCalls: priorByAgent.get(r.agent_id)?.calls_made ?? 0,
    lastActiveIso: lastActive.get(r.agent_id) ?? null,
  }));

  const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((acc, r) => acc + pick(r), 0);
  const { banner, attention, movers } = buildDigestCallouts(inputs, localDateIso);

  const agents: CycleDigestAgent[] = [...inputs]
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
    .map((a) => ({
      name: a.name,
      calls: a.calls,
      callsTarget: a.callsTarget,
      apptsSet: a.apptsSet,
      apptsHeld: a.apptsHeld,
      sales: a.sales,
      premiumCents: a.premiumCents,
      recruits: a.recruits,
      lastActive: a.lastActiveIso ? formatShortDate(a.lastActiveIso) : null,
      stale: a.lastActiveIso === null || daysBetween(a.lastActiveIso, localDateIso) >= STALE_DAYS,
    }));

  return {
    to: leader.email,
    content: cycleDigestEmail({
      agentId: leader.id,
      fullName: leader.full_name,
      cycleLabel: formatCycleRange(cycle.from, cycle.to),
      priorLabel: formatCycleRange(priorCycle.from, priorCycle.to),
      totals: {
        calls: sum(inputs, (r) => r.calls),
        apptsSet: sum(inputs, (r) => r.apptsSet),
        apptsHeld: sum(inputs, (r) => r.apptsHeld),
        sales: sum(inputs, (r) => r.sales),
        premiumCents: sum(inputs, (r) => r.premiumCents),
        recruits: sum(inputs, (r) => r.recruits),
      },
      prior: {
        calls: sum(priorRoster, (r) => r.calls_made),
        apptsSet: sum(priorRoster, (r) => r.appts_set),
        apptsHeld: sum(priorRoster, (r) => r.appts_held),
        sales: sum(agentIds, (id) => extrasFor(priorExtras, id).sales),
        premiumCents: sum(priorRoster, (r) => Number(r.premium_cents)),
        recruits: sum(agentIds, (id) => extrasFor(priorExtras, id).recruits),
      },
      targets: {
        calls: sum(roster, (r) => r.calls_target),
        apptsHeld: sum(roster, (r) => r.appts_held_target),
        premiumCents: sum(roster, (r) => Number(r.premium_cents_target)),
      },
      banner,
      attention,
      movers,
      agents,
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
