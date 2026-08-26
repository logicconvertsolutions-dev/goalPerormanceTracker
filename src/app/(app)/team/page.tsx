import Link from 'next/link';
import { requireLeader } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/shell/kpi-card';
import { FilterBar, type FilterChip } from '@/components/shell/filter-bar';
import { AgentMultiSelect } from '@/components/shell/agent-multi-select';
import { DonutChart } from '@/components/charts/donut-chart';
import { HorizontalBarChart } from '@/components/charts/horizontal-bar-chart';
import { TrendChart, type TrendWeek } from '@/components/charts/trend-chart';
import { resolvePeriod, todayIso, addDays, weeksInRange, type PeriodPreset, PERIOD_PRESETS } from '@/lib/dates';
import { DailyBreakdownTable } from '@/components/shell/daily-breakdown-table';
import { RosterRow, type RosterRowData } from './roster-row';
import { DailyGrid, type DailyGridColumn } from './daily-grid';
import { NudgeButton } from './nudge-button';

function isPeriodPreset(v: string | undefined): v is PeriodPreset {
  return !!v && (PERIOD_PRESETS as readonly string[]).includes(v);
}

type View = 'summary' | 'daily' | 'activity';

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const params = searchParams;
  await requireLeader();
  const supabase = await createClient();

  const today = todayIso();
  const preset: PeriodPreset = isPeriodPreset(params.period) ? params.period : 'this_week';
  const { from, to } = resolvePeriod(preset, today, params.from, params.to);
  const view: View =
    params.view === 'daily' ? 'daily' : params.view === 'activity' ? 'activity' : 'summary';
  const selectedIds = (params.agents ?? '').split(',').filter(Boolean);

  const [{ data: roster }, { data: quiet }, { data: trendRows }, { data: breakdown }, { data: dailyBreakdown }] =
    await Promise.all([
      supabase.rpc('team_period_summary', { p_from: from, p_to: to }),
      supabase.rpc('team_inactive', { p_days: 7 }),
      supabase.rpc('team_trend', { p_weeks: 8, p_agent_ids: selectedIds.length ? selectedIds : undefined }),
      supabase.rpc('team_breakdown', {
        p_from: from,
        p_to: to,
        p_agent_ids: selectedIds.length ? selectedIds : undefined,
      }),
      supabase.rpc('agent_daily_breakdown', {
        p_from: from,
        p_to: to,
        p_agent_ids: selectedIds.length ? selectedIds : undefined,
      }),
    ]);

  const allAgents = (roster ?? []) as RosterRowData[];
  if (allAgents.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-[28px] font-bold leading-[34px] tracking-heading-tight text-fg">My Team</h1>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-fg-2">
              No one in your downline yet —{' '}
              <Link href="/team/invites" className="text-acc hover:underline">
                invite someone
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const visibleAgents =
    selectedIds.length === 0 ? allAgents : allAgents.filter((a) => selectedIds.includes(a.agent_id));

  const totalCalls = visibleAgents.reduce((acc, a) => acc + a.calls_made, 0);
  const totalCallsTarget = visibleAgents.reduce((acc, a) => acc + a.calls_target, 0);
  const totalApptsHeld = visibleAgents.reduce((acc, a) => acc + a.appts_held, 0);
  const totalApptsHeldTarget = visibleAgents.reduce((acc, a) => acc + a.appts_held_target, 0);
  const totalPremium = visibleAgents.reduce((acc, a) => acc + a.premium_cents, 0);
  const totalPremiumTarget = visibleAgents.reduce((acc, a) => acc + Number(a.premium_cents_target), 0);
  const onTarget = visibleAgents.filter((a) => (a.pct_calls ?? 0) >= 100).length;
  // Targets are only ever set per week (CLAUDE.md rule 8) -- team_period_summary
  // already scales each agent's target by the weeks in [from, to], so the "~"
  // here just marks that scaling for any period longer than one week.
  const targetPrefix = weeksInRange(from, to) !== 1 ? '~' : '';
  const visibleIdSet = new Set(visibleAgents.map((a) => a.agent_id));
  const quietRows = (quiet ?? []).filter((q) => visibleIdSet.has(q.agent_id));
  const quietIds = quietRows.map((q) => q.agent_id);

  const chips: FilterChip[] = [];
  if (selectedIds.length > 0) chips.push({ key: 'agents', label: `${selectedIds.length} agent(s)` });

  const trendWeeks: TrendWeek[] = (trendRows ?? []).map((w) => ({
    weekStart: w.week_start,
    label: new Date(w.week_start + 'T00:00:00Z').toLocaleDateString('en-CA', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }),
    calls: w.calls_made,
    callsTarget: w.calls_target,
    premiumCents: w.premium_cents,
  }));

  const exportParams = new URLSearchParams({
    period: preset,
    ...(params.from ? { from: params.from } : {}),
    ...(params.to ? { to: params.to } : {}),
  });

  function withParam(overrides: Record<string, string>): string {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) next.set(k, v);
    for (const [k, v] of Object.entries(overrides)) next.set(k, v);
    return `/team?${next.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <h1 className="text-[28px] font-bold leading-[34px] tracking-heading-tight text-fg">My Team</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/team/organization">Organization</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/team/targets">Goals</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/team/invites">Invites</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/team/members">Members</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/team/audit">Audit</Link>
          </Button>
        </div>
      </div>

      <FilterBar preset={preset} customFrom={params.from} customTo={params.to} chips={chips}>
        <AgentMultiSelect agents={allAgents.map((a) => ({ id: a.agent_id, full_name: a.full_name }))} />
        <div className="flex rounded-sm border border-line-2 bg-sunken p-1">
          <Link
            href={withParam({ view: 'summary' })}
            className={
              view === 'summary'
                ? 'rounded-sm bg-acc px-3 py-1.5 text-xs font-medium text-bg min-h-[32px] flex items-center'
                : 'rounded-sm px-3 py-1.5 text-xs font-medium text-fg-2 hover:bg-hover hover:text-fg min-h-[32px] flex items-center'
            }
          >
            Summary
          </Link>
          <Link
            href={withParam({ view: 'daily' })}
            className={
              view === 'daily'
                ? 'rounded-sm bg-acc px-3 py-1.5 text-xs font-medium text-bg min-h-[32px] flex items-center'
                : 'rounded-sm px-3 py-1.5 text-xs font-medium text-fg-2 hover:bg-hover hover:text-fg min-h-[32px] flex items-center'
            }
          >
            Daily
          </Link>
          <Link
            href={withParam({ view: 'activity' })}
            className={
              view === 'activity'
                ? 'rounded-sm bg-acc px-3 py-1.5 text-xs font-medium text-bg min-h-[32px] flex items-center'
                : 'rounded-sm px-3 py-1.5 text-xs font-medium text-fg-2 hover:bg-hover hover:text-fg min-h-[32px] flex items-center'
            }
          >
            Activity
          </Link>
        </div>
        {view === 'summary' && (
          <Link
            href={`/team/export?${exportParams.toString()}`}
            className="text-xs text-acc hover:underline whitespace-nowrap"
          >
            Export CSV
          </Link>
        )}
      </FilterBar>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard
          label="Total Calls"
          value={String(totalCalls)}
          target={{
            value: `${targetPrefix}${totalCallsTarget}`,
            pct: totalCallsTarget ? Math.round((100 * totalCalls) / totalCallsTarget) : 0,
          }}
        />
        <KpiCard
          label="Total Appts Held"
          value={String(totalApptsHeld)}
          target={{
            value: `${targetPrefix}${totalApptsHeldTarget}`,
            pct: totalApptsHeldTarget ? Math.round((100 * totalApptsHeld) / totalApptsHeldTarget) : 0,
          }}
        />
        <KpiCard
          label="Total Premium"
          value={`$${(totalPremium / 100).toLocaleString('en-CA')}`}
          target={{
            value: `${targetPrefix}$${(totalPremiumTarget / 100).toLocaleString('en-CA')}`,
            pct: totalPremiumTarget ? Math.round((100 * totalPremium) / totalPremiumTarget) : 0,
          }}
        />
        <KpiCard label="Agents On Goal" value={`${onTarget} / ${visibleAgents.length}`} />
        <Link href={withParam({ agents: quietIds.join(',') })}>
          <KpiCard label="Quiet Agents" value={String(quietRows.length)} />
        </Link>
      </div>

      {quietRows.length > 0 && (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <h2 className="text-[16px] font-semibold text-fg">Quiet — nothing logged in 7+ days</h2>
            {quietRows.map((q) => (
              <div key={q.agent_id} className="flex items-center justify-between text-sm py-1">
                <Link href={`/team/${q.agent_id}`} className="text-fg hover:text-acc">
                  {q.full_name}
                </Link>
                <NudgeButton agentId={q.agent_id} fullName={q.full_name} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {view === 'daily' ? (
        <DailyGridSection agentIds={selectedIds.length ? selectedIds : allAgents.map((a) => a.agent_id)} allAgents={allAgents} from={from} to={to} />
      ) : view === 'activity' ? (
        <DailyBreakdownTable rows={dailyBreakdown ?? []} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-[12px] border border-line hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-bg-2 text-fg-3 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Agent</th>
                  <th className="text-left font-medium px-4 py-2.5">Calls</th>
                  <th className="text-right font-medium px-4 py-2.5">Appts Set</th>
                  <th className="text-right font-medium px-4 py-2.5">Appts Held</th>
                  <th className="text-right font-medium px-4 py-2.5">Premium</th>
                  <th className="text-right font-medium px-4 py-2.5">Streak</th>
                  <th className="text-left font-medium px-4 py-2.5">Last logged</th>
                </tr>
              </thead>
              <tbody>
                {visibleAgents.map((row) => (
                  <RosterRow key={row.agent_id} row={row} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards, not table (03-ui.md). */}
          <div className="space-y-2 md:hidden">
            {visibleAgents.map((row) => (
              <Card key={row.agent_id}>
                <CardContent className="pt-4">
                  <Link href={`/team/${row.agent_id}`} className="text-fg font-medium hover:text-acc">
                    {row.full_name}
                  </Link>
                  <p className="text-xs text-fg-3 mt-1">
                    {row.calls_made} / {row.calls_target} calls · last logged{' '}
                    {row.last_logged_at ? row.last_logged_at.slice(0, 10) : '—'}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-4">
                <h2 className="text-[16px] font-semibold text-fg mb-3">Calls by Agent</h2>
                <HorizontalBarChart
                  title="Calls by Agent"
                  data={visibleAgents.map((a) => ({ label: a.full_name, value: a.calls_made }))}
                  target={visibleAgents.length ? Math.round(totalCallsTarget / visibleAgents.length) : undefined}
                />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <h2 className="text-[16px] font-semibold text-fg mb-3">Team Call Outcomes</h2>
                <DonutChart
                  title="Team Call Outcomes"
                  slices={[
                    { label: 'Connected', value: breakdown?.[0]?.out_connected ?? 0 },
                    { label: 'Voicemail', value: breakdown?.[0]?.out_voicemail ?? 0 },
                    { label: 'No Answer', value: breakdown?.[0]?.out_no_answer ?? 0 },
                    { label: 'Appt Set', value: breakdown?.[0]?.out_appt_set ?? 0 },
                    { label: 'Not Interested', value: breakdown?.[0]?.out_not_interested ?? 0 },
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <h2 className="text-[16px] font-semibold text-fg mb-3">Team Call Source</h2>
                <HorizontalBarChart
                  title="Team Call Source"
                  data={[
                    { label: 'Warm Market', value: breakdown?.[0]?.src_warm_market ?? 0 },
                    { label: 'Referral', value: breakdown?.[0]?.src_referral ?? 0 },
                    { label: 'Cold', value: breakdown?.[0]?.src_cold ?? 0 },
                    { label: 'Social Media', value: breakdown?.[0]?.src_social_media ?? 0 },
                    { label: 'Friend', value: breakdown?.[0]?.src_friend ?? 0 },
                    { label: 'Other', value: breakdown?.[0]?.src_other ?? 0 },
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <h2 className="text-[16px] font-semibold text-fg mb-3">8-Week Team Trend</h2>
                <TrendChart weeks={trendWeeks} metric="calls" />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

async function DailyGridSection({
  agentIds,
  allAgents,
  from,
  to,
}: {
  agentIds: string[];
  allAgents: RosterRowData[];
  from: string;
  to: string;
}) {
  const supabase = await createClient();
  const nameById = new Map(allAgents.map((a) => [a.agent_id, a.full_name]));

  const results = await Promise.all(
    agentIds.map((id) => supabase.rpc('agent_daily_activity', { p_agent_id: id, p_from: from, p_to: to }))
  );

  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);

  const columns: DailyGridColumn[] = agentIds.map((id, i) => ({
    agentId: id,
    fullName: nameById.get(id) ?? id,
    rows: (results[i].data ?? []).map((r) => ({
      activity_date: r.activity_date,
      calls_made: r.calls_made,
      min_met: r.min_met,
    })),
  }));

  return <DailyGrid dates={dates} columns={columns} />;
}
