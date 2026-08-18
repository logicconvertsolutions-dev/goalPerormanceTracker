import { Card, CardContent } from '@/components/ui/card';
import { KpiCard } from '@/components/shell/kpi-card';
import { DonutChart } from '@/components/charts/donut-chart';
import { HorizontalBarChart } from '@/components/charts/horizontal-bar-chart';
import { TrendChart } from '@/components/charts/trend-chart';
import { FunnelChart } from '@/components/charts/funnel-chart';
import type { DashboardViewModel } from './dashboard-view-model';

/** Pure presentational rendering of a DashboardViewModel — no data fetching. */
export function DashboardView({ vm }: { vm: DashboardViewModel }) {
  if (!vm.hasAnyActivity) {
    return (
      <Card>
        <CardContent className="pt-4">
          <p className="text-sm text-fg-2">
            Nothing logged yet this week. Your dashboard fills in as you log calls — head to{' '}
            <a href="/log" className="text-acc hover:underline">
              /log
            </a>{' '}
            to get started.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Calls Made" value={String(vm.callsMade)} target={vm.callsTarget} />
        <KpiCard label="Appointments Held" value={String(vm.apptsHeld)} target={vm.apptsTarget} />
        <KpiCard
          label="Premium"
          value={`$${(vm.premiumCents / 100).toLocaleString('en-CA')}`}
          target={vm.premiumTarget}
        />
        <KpiCard label="Current Streak" value={`${vm.streak}d`} />
        <KpiCard label="Days to MD Deadline" value={vm.daysToDeadline === null ? '—' : String(vm.daysToDeadline)} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Dial-to-Connect Rate" value={`${vm.dialToConnectPct}%`} />
        <KpiCard label="No-Show Rate" value={`${vm.noShowPct}%`} />
        <KpiCard label="Referrals Given" value={String(vm.referralsGiven)} />
        <KpiCard label="Recruiting Conversations" value={String(vm.recruitingConvos)} />
        <KpiCard label="Pipeline Value" value={`$${(vm.pipelineValueCents / 100).toLocaleString('en-CA')}`} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4">
            <h2 className="text-sm font-medium text-fg mb-3">Call Outcomes</h2>
            <DonutChart title="Call Outcomes" slices={vm.callOutcomes} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <h2 className="text-sm font-medium text-fg mb-3">Appointment Status</h2>
            <DonutChart title="Appointment Status" slices={vm.appointmentStatus} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <h2 className="text-sm font-medium text-fg mb-3">Call Source</h2>
            <HorizontalBarChart title="Call Source" data={vm.callSource} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <h2 className="text-sm font-medium text-fg mb-3">8-Week Trend</h2>
            <TrendChart weeks={vm.trendWeeks} metric="calls" />
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardContent className="pt-4">
            <h2 className="text-sm font-medium text-fg mb-3">Conversion Funnel</h2>
            <FunnelChart funnel={vm.funnel} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
