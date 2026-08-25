// Pure transform from raw fetched rows to what <DashboardView> renders.
// Kept separate from page.tsx (data fetching) and dashboard-view.tsx
// (rendering) so the golden-file test can build a view model directly from
// known numbers without needing to render an async Server Component.
import {
  conversionFunnel,
  currentStreak,
  pipelineValueOpenAppts,
  type DailyMetricsRow,
  type FunnelResult,
} from '@/lib/metrics';
import { addDays, weekStart } from '@/lib/dates';
import type { TrendWeek } from '@/components/charts/trend-chart';

export interface AgentAggregateTotals {
  calls_made: number;
  appts_set: number;
  appt_held: number;
  sales_count: number;
  premium_cents: number;
  referrals_given: number;
  recruiting_convos: number;
  out_connected: number;
  out_voicemail: number;
  out_no_answer: number;
  out_appt_set: number;
  out_not_interested: number;
  src_warm_market: number;
  src_referral: number;
  src_cold: number;
  src_social_media: number;
  src_friend: number;
  src_other: number;
  appt_scheduled: number;
  appt_no_show: number;
  appt_rescheduled: number;
  appt_cancelled: number;
}

export interface EffectiveTarget {
  calls_per_week: number;
  appts_held_per_week: number;
  premium_cents_per_week: number;
  min_calls_per_day: number;
}

export interface DashboardViewModel {
  hasAnyActivity: boolean;
  callsMade: number;
  apptsHeld: number;
  premiumCents: number;
  streak: number;
  callsTarget: { value: string; pct: number } | undefined;
  apptsTarget: { value: string; pct: number } | undefined;
  premiumTarget: { value: string; pct: number } | undefined;
  dialToConnectPct: number;
  noShowPct: number;
  referralsGiven: number;
  recruitingConvos: number;
  pipelineValueCents: number;
  callOutcomes: { label: string; value: number }[];
  appointmentStatus: { label: string; value: number }[];
  callSource: { label: string; value: number }[];
  trendWeeks: TrendWeek[];
  funnel: FunnelResult;
}

export function buildDashboardViewModel(input: {
  totals: AgentAggregateTotals | undefined;
  target: EffectiveTarget | undefined;
  trendRows: DailyMetricsRow[];
  openAppointments: { status: string; expected_premium_cents: number }[];
  streakRows: Map<string, DailyMetricsRow>;
  today: string;
  /** Weeks spanned by the selected period (lib/dates.ts weeksInRange). The
   * weekly target is scaled by this so "This Month" compares the month's
   * totals against a monthly-equivalent target instead of one week's. */
  periodWeeks?: number;
}): DashboardViewModel {
  const { totals: t2, target, trendRows, openAppointments, streakRows, today, periodWeeks = 1 } = input;
  // Targets are only ever set per week -- scale here for any longer period,
  // and mark the scaled value with "~" so it reads as derived, not SMD-set.
  const scaled = target && periodWeeks !== 1
    ? {
        ...target,
        calls_per_week: Math.round(target.calls_per_week * periodWeeks),
        appts_held_per_week: Math.round(target.appts_held_per_week * periodWeeks),
        premium_cents_per_week: Math.round(Number(target.premium_cents_per_week) * periodWeeks),
      }
    : target;
  const targetPrefix = periodWeeks !== 1 ? '~' : '';

  const funnel = conversionFunnel(
    t2
      ? [
          {
            calls_made: t2.calls_made,
            appts_set: t2.appts_set,
            appt_held: t2.appt_held,
            sales_count: t2.sales_count,
          } as DailyMetricsRow,
        ]
      : []
  );

  const dialToConnect = t2 && t2.calls_made > 0 ? t2.out_connected / t2.calls_made : 0;
  const noShow = t2
    ? (() => {
        const denom = t2.appt_scheduled + t2.appt_held + t2.appt_no_show + t2.appt_rescheduled + t2.appt_cancelled;
        return denom === 0 ? 0 : t2.appt_no_show / denom;
      })()
    : 0;

  const pipelineValueCents = pipelineValueOpenAppts(openAppointments);
  const streak = currentStreak(streakRows, target?.min_calls_per_day ?? 15, today);

  const callsTargetPct = scaled?.calls_per_week ? Math.round((100 * (t2?.calls_made ?? 0)) / scaled.calls_per_week) : 0;
  const apptsTargetPct = scaled?.appts_held_per_week
    ? Math.round((100 * (t2?.appt_held ?? 0)) / scaled.appts_held_per_week)
    : 0;
  const premiumTargetPct = scaled?.premium_cents_per_week
    ? Math.round((100 * Number(t2?.premium_cents ?? 0)) / Number(scaled.premium_cents_per_week))
    : 0;

  const trendWeeks: TrendWeek[] = [];
  for (let i = 7; i >= 0; i--) {
    const ws = addDays(weekStart(new Date(today + 'T00:00:00Z')), -7 * i);
    const weekRows = trendRows.filter((r) => r.activity_date >= ws && r.activity_date <= addDays(ws, 6));
    const calls = weekRows.reduce((acc, r) => acc + r.calls_made, 0);
    const premium = weekRows.reduce((acc, r) => acc + r.premium_cents, 0);
    trendWeeks.push({
      weekStart: ws,
      label: new Date(ws + 'T00:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      calls,
      callsTarget: target?.calls_per_week ?? 0,
      premiumCents: premium,
    });
  }

  const hasAnyActivity = (t2?.calls_made ?? 0) > 0 || trendRows.some((r) => r.calls_made > 0);

  return {
    hasAnyActivity,
    callsMade: t2?.calls_made ?? 0,
    apptsHeld: t2?.appt_held ?? 0,
    premiumCents: t2?.premium_cents ?? 0,
    streak,
    callsTarget: scaled
      ? { value: `${targetPrefix}${scaled.calls_per_week}`, pct: callsTargetPct }
      : undefined,
    apptsTarget: scaled
      ? { value: `${targetPrefix}${scaled.appts_held_per_week}`, pct: apptsTargetPct }
      : undefined,
    premiumTarget: scaled
      ? {
          value: `${targetPrefix}$${(Number(scaled.premium_cents_per_week) / 100).toLocaleString('en-CA')}`,
          pct: premiumTargetPct,
        }
      : undefined,
    dialToConnectPct: Math.round(dialToConnect * 100),
    noShowPct: Math.round(noShow * 100),
    referralsGiven: t2?.referrals_given ?? 0,
    recruitingConvos: t2?.recruiting_convos ?? 0,
    pipelineValueCents,
    callOutcomes: [
      { label: 'Connected', value: t2?.out_connected ?? 0 },
      { label: 'Voicemail', value: t2?.out_voicemail ?? 0 },
      { label: 'No Answer', value: t2?.out_no_answer ?? 0 },
      { label: 'Appt Set', value: t2?.out_appt_set ?? 0 },
      { label: 'Not Interested', value: t2?.out_not_interested ?? 0 },
    ],
    appointmentStatus: [
      { label: 'Scheduled', value: t2?.appt_scheduled ?? 0 },
      { label: 'Held', value: t2?.appt_held ?? 0 },
      { label: 'No-show', value: t2?.appt_no_show ?? 0 },
      { label: 'Rescheduled', value: t2?.appt_rescheduled ?? 0 },
      { label: 'Cancelled', value: t2?.appt_cancelled ?? 0 },
    ],
    callSource: [
      { label: 'Warm Market', value: t2?.src_warm_market ?? 0 },
      { label: 'Referral', value: t2?.src_referral ?? 0 },
      { label: 'Cold', value: t2?.src_cold ?? 0 },
      { label: 'Social Media', value: t2?.src_social_media ?? 0 },
      { label: 'Friend', value: t2?.src_friend ?? 0 },
      { label: 'Other', value: t2?.src_other ?? 0 },
    ],
    trendWeeks,
    funnel,
  };
}
