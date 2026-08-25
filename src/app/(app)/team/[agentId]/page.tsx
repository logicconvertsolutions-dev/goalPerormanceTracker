import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireLeader } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { FilterBar } from '@/components/shell/filter-bar';
import { BackLink } from '@/components/shell/back-link';
import type { DailyMetricsRow } from '@/lib/metrics';
import { addDays, resolvePeriod, todayIso, weekStart, type PeriodPreset, PERIOD_PRESETS } from '@/lib/dates';
import { buildDashboardViewModel } from '../../dashboard/dashboard-view-model';
import { DashboardView } from '../../dashboard/dashboard-view';

function isPeriodPreset(v: string | undefined): v is PeriodPreset {
  return !!v && (PERIOD_PRESETS as readonly string[]).includes(v);
}

// Reuses the associate's own dashboard rendering stack verbatim — 08-screen-specs.md:
// "The layout is deliberately identical to the agent's own /dashboard so
// coaching happens against the same picture the agent sees." Counts only,
// via agent_aggregate/team_target — no contact name, no notes, ever.
export default async function TeamAgentPage({
  params: routeParams,
  searchParams,
}: {
  params: { agentId: string };
  searchParams: Record<string, string | undefined>;
}) {
  await requireLeader();
  const supabase = await createClient();
  const agentId = routeParams.agentId;

  // RPCs already self-check is_upline_of, but a direct 404 beats a silent
  // blank dashboard (05-testing.md E2E test 3).
  const { data: agent } = await supabase
    .from('agents')
    .select('id, full_name')
    .eq('id', agentId)
    .maybeSingle();
  if (!agent) notFound();

  const params = searchParams;
  const today = todayIso();
  const preset: PeriodPreset = isPeriodPreset(params.period) ? params.period : 'this_week';
  const { from, to } = resolvePeriod(preset, today, params.from, params.to);
  const targetWeek = weekStart(new Date(from + 'T00:00:00Z'));

  const [{ data: agg }, { data: target }, { data: trendRows }, { data: openAppts }, { data: recentMetrics }] =
    await Promise.all([
      supabase.rpc('agent_aggregate', { p_agent_id: agentId, p_from: from, p_to: to }),
      supabase.rpc('team_target', { p_agent_id: agentId, p_week: targetWeek }),
      supabase
        .from('daily_metrics')
        .select('*')
        .eq('agent_id', agentId)
        .gte('activity_date', addDays(weekStart(new Date(today + 'T00:00:00Z')), -7 * 7))
        .lte('activity_date', today)
        .order('activity_date'),
      supabase
        .from('appointments')
        .select('status, expected_premium_cents')
        .eq('agent_id', agentId)
        .eq('status', 'scheduled'),
      supabase
        .from('daily_metrics')
        .select('activity_date, calls_made')
        .eq('agent_id', agentId)
        .lte('activity_date', today)
        .order('activity_date', { ascending: false })
        .limit(90),
    ]);

  const streakRows = new Map((recentMetrics ?? []).map((r) => [r.activity_date, r as DailyMetricsRow]));

  const vm = buildDashboardViewModel({
    totals: agg?.[0],
    target: target?.[0],
    trendRows: (trendRows ?? []) as DailyMetricsRow[],
    openAppointments: openAppts ?? [],
    streakRows,
    today,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <BackLink href="/team" label="Team" className="text-xs" />
          <h1 className="text-xl font-semibold tracking-heading-tight text-fg">{agent.full_name}</h1>
        </div>
        <Link href={`/team/${agentId}/daily`} className="text-sm text-acc hover:underline">
          Daily grid →
        </Link>
      </div>

      <FilterBar preset={preset} customFrom={params.from} customTo={params.to} />

      <DashboardView vm={vm} />
    </div>
  );
}
