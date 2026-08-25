import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireLeader } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { FilterBar } from '@/components/shell/filter-bar';
import { BackLink } from '@/components/shell/back-link';
import { resolvePeriod, todayIso, addDays, type PeriodPreset, PERIOD_PRESETS } from '@/lib/dates';
import { DailyGrid, type DailyGridColumn } from '../../daily-grid';

function isPeriodPreset(v: string | undefined): v is PeriodPreset {
  return !!v && (PERIOD_PRESETS as readonly string[]).includes(v);
}

// Day-by-day grid for one agent (08-screen-specs.md: "/team/[agentId]/daily
// — day-by-day grid for one agent over a date range").
export default async function TeamAgentDailyPage({
  params: routeParams,
  searchParams,
}: {
  params: { agentId: string };
  searchParams: Record<string, string | undefined>;
}) {
  await requireLeader();
  const supabase = await createClient();
  const agentId = routeParams.agentId;

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

  const { data: activity } = await supabase.rpc('agent_daily_activity', {
    p_agent_id: agentId,
    p_from: from,
    p_to: to,
  });

  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);

  const columns: DailyGridColumn[] = [
    {
      agentId,
      fullName: agent.full_name,
      rows: (activity ?? []).map((r) => ({
        activity_date: r.activity_date,
        calls_made: r.calls_made,
        min_met: r.min_met,
      })),
    },
  ];

  const exportParams = new URLSearchParams({
    period: preset,
    ...(params.from ? { from: params.from } : {}),
    ...(params.to ? { to: params.to } : {}),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <BackLink href={`/team/${agentId}`} label={agent.full_name} className="text-xs" />
          <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Daily grid</h1>
        </div>
        <Link
          href={`/team/${agentId}/daily/export?${exportParams.toString()}`}
          className="text-sm text-acc hover:underline"
        >
          Export CSV
        </Link>
      </div>

      <FilterBar preset={preset} customFrom={params.from} customTo={params.to} />

      <DailyGrid dates={dates} columns={columns} />
    </div>
  );
}
