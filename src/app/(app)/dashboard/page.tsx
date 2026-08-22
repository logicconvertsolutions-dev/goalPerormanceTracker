import Link from 'next/link';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { FilterBar } from '@/components/shell/filter-bar';
import { DailyBreakdownTable } from '@/components/shell/daily-breakdown-table';
import type { DailyMetricsRow } from '@/lib/metrics';
import {
  addDays,
  resolvePeriod,
  todayIso,
  weekStart,
  weeksInRange,
  type PeriodPreset,
  PERIOD_PRESETS,
} from '@/lib/dates';
import { buildDashboardViewModel } from './dashboard-view-model';
import { DashboardView } from './dashboard-view';

function isPeriodPreset(v: string | undefined): v is PeriodPreset {
  return !!v && (PERIOD_PRESETS as readonly string[]).includes(v);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const params = searchParams;
  const session = await requireAgent();
  const agentId = session.agent!.id;
  const supabase = await createClient();

  const today = todayIso();
  const preset: PeriodPreset = isPeriodPreset(params.period) ? params.period : 'this_week';
  const { from, to } = resolvePeriod(preset, today, params.from, params.to);
  const targetWeek = weekStart(new Date(from + 'T00:00:00Z'));
  const view: 'overview' | 'activity' = params.view === 'activity' ? 'activity' : 'overview';

  const [
    { data: agg },
    { data: target },
    { data: trendRows },
    { data: openAppts },
    { data: recentMetrics },
    { data: dailyBreakdown },
  ] = await Promise.all([
    supabase.rpc('agent_aggregate', { p_agent_id: agentId, p_from: from, p_to: to }),
    supabase.rpc('my_target', { p_week: targetWeek }),
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
    // Streak reads back further than the trend window needs, cheap at one agent's own row count.
    supabase
      .from('daily_metrics')
      .select('activity_date, calls_made')
      .eq('agent_id', agentId)
      .lte('activity_date', today)
      .order('activity_date', { ascending: false })
      .limit(90),
    supabase.rpc('agent_daily_breakdown', { p_from: from, p_to: to, p_agent_ids: [agentId] }),
  ]);

  const streakRows = new Map(
    (recentMetrics ?? []).map((r) => [r.activity_date, r as DailyMetricsRow])
  );

  const vm = buildDashboardViewModel({
    totals: agg?.[0],
    target: target?.[0],
    trendRows: (trendRows ?? []) as DailyMetricsRow[],
    openAppointments: openAppts ?? [],
    streakRows,
    today,
    periodWeeks: weeksInRange(from, to),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Dashboard</h1>
      </div>

      {/* Desktop reaches these via the rail nav's secondary group; the mobile
          tab bar has no room for them, so they need a link here too. */}
      <div className="flex flex-wrap gap-3 text-sm md:hidden">
        <Link href="/appointments" className="text-acc hover:underline">
          Appointments →
        </Link>
        <Link href="/sales" className="text-acc hover:underline">
          Sales →
        </Link>
        <Link href="/recruiting" className="text-acc hover:underline">
          Recruiting →
        </Link>
      </div>

      <FilterBar preset={preset} customFrom={params.from} customTo={params.to}>
        <div className="flex rounded-sm border border-line-2 bg-sunken p-1">
          {(['overview', 'activity'] as const).map((v) => {
            const next = new URLSearchParams();
            for (const [k, val] of Object.entries(params)) if (val !== undefined) next.set(k, val);
            next.set('view', v);
            return (
              <Link
                key={v}
                href={`/dashboard?${next.toString()}`}
                className={
                  view === v
                    ? 'rounded-sm bg-acc px-3 py-1.5 text-xs font-medium text-bg min-h-[32px] flex items-center'
                    : 'rounded-sm px-3 py-1.5 text-xs font-medium text-fg-2 hover:bg-hover hover:text-fg min-h-[32px] flex items-center'
                }
              >
                {v === 'overview' ? 'Overview' : 'Activity'}
              </Link>
            );
          })}
        </div>
      </FilterBar>

      {view === 'activity' ? (
        <DailyBreakdownTable rows={dailyBreakdown ?? []} />
      ) : (
        <DashboardView vm={vm} />
      )}
    </div>
  );
}
