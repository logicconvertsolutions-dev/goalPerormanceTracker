// Derived-value math over the daily_metrics read model. Pure functions, no DB
// access — reused by the golden-file test (docs/05-testing.md) and P4's dashboard.
// Formulas mirror the source workbook's own Dashboard tab formulas exactly
// (verified against .github/Spec Sheets/weekly_calls_tracker - Template.xlsx).
import type { Database } from '../../types/database';

export type DailyMetricsRow = Database['public']['Tables']['daily_metrics']['Row'];

export interface WeekSummary {
  callsMade: number;
  apptsSet: number;
  apptsHeld: number;
  premiumCents: number;
  outConnected: number;
  outVoicemail: number;
  outNoAnswer: number;
  outAppointmentSet: number;
  outNotInterested: number;
  srcWarmMarket: number;
  srcReferral: number;
  srcCold: number;
  srcSocialMedia: number;
  srcFriend: number;
  srcOther: number;
  apptScheduled: number;
  apptHeld: number;
  apptNoShow: number;
  apptRescheduled: number;
  apptCancelled: number;
  referralsGiven: number;
  recruitingConvos: number;
  salesCount: number;
}

export function summarizeWeek(rows: DailyMetricsRow[]): WeekSummary {
  const sum = (f: (r: DailyMetricsRow) => number) => rows.reduce((acc, r) => acc + f(r), 0);
  return {
    callsMade: sum((r) => r.calls_made),
    apptsSet: sum((r) => r.appts_set),
    apptsHeld: sum((r) => r.appt_held),
    premiumCents: sum((r) => r.premium_cents),
    outConnected: sum((r) => r.out_connected),
    outVoicemail: sum((r) => r.out_voicemail),
    outNoAnswer: sum((r) => r.out_no_answer),
    outAppointmentSet: sum((r) => r.out_appt_set),
    outNotInterested: sum((r) => r.out_not_interested),
    srcWarmMarket: sum((r) => r.src_warm_market),
    srcReferral: sum((r) => r.src_referral),
    srcCold: sum((r) => r.src_cold),
    srcSocialMedia: sum((r) => r.src_social_media),
    srcFriend: sum((r) => r.src_friend),
    srcOther: sum((r) => r.src_other),
    apptScheduled: sum((r) => r.appt_scheduled),
    apptHeld: sum((r) => r.appt_held),
    apptNoShow: sum((r) => r.appt_no_show),
    apptRescheduled: sum((r) => r.appt_rescheduled),
    apptCancelled: sum((r) => r.appt_cancelled),
    referralsGiven: sum((r) => r.referrals_given),
    recruitingConvos: sum((r) => r.recruiting_convos),
    salesCount: sum((r) => r.sales_count),
  };
}

/** Dashboard B70: `=IFERROR(connected/callsMade,0)`. */
export function dialToConnectRatio(rows: DailyMetricsRow[]): number {
  const s = summarizeWeek(rows);
  return s.callsMade === 0 ? 0 : s.outConnected / s.callsMade;
}

/**
 * Dashboard B71: `=IFERROR(noShow/SUM(scheduled..cancelled),0)` — denominator
 * is every appointment status logged in the week, not just held+no-show.
 */
export function noShowRate(rows: DailyMetricsRow[]): number {
  const s = summarizeWeek(rows);
  const denom = s.apptScheduled + s.apptHeld + s.apptNoShow + s.apptRescheduled + s.apptCancelled;
  return denom === 0 ? 0 : s.apptNoShow / denom;
}

/**
 * Dashboard B77: `=AVERAGE(last 4 weeks' calls made)` — Excel AVERAGE divides
 * by 4 regardless of how many of those weeks actually have data (all cells
 * are populated with 0, never blank), so the denominator is always 4.
 */
export function rollingAvgCallsPerWeek(weeklyRows: DailyMetricsRow[][]): number {
  const last4 = weeklyRows.slice(-4);
  const total = last4.reduce((acc, week) => acc + summarizeWeek(week).callsMade, 0);
  return total / 4;
}

/** Consecutive days back from `asOf` where calls_made >= minCallsPerDay. */
export function currentStreak(
  rowsByDate: Map<string, DailyMetricsRow>,
  minCallsPerDay: number,
  asOf: string
): number {
  let streak = 0;
  let cursor = asOf;
  for (;;) {
    const row = rowsByDate.get(cursor);
    if (!row || row.calls_made < minCallsPerDay) break;
    streak += 1;
    const d = new Date(cursor + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    cursor = d.toISOString().slice(0, 10);
  }
  return streak;
}

/** Dashboard B78: `=mdDeadline-TODAY()` — computed from the real current date. */
export function daysToMdDeadline(mdDeadlineIso: string, asOf: string): number {
  const deadline = new Date(mdDeadlineIso + 'T00:00:00Z').getTime();
  const from = new Date(asOf + 'T00:00:00Z').getTime();
  return Math.round((deadline - from) / 86_400_000);
}

export interface FunnelResult {
  callsMade: number;
  apptsSet: number;
  apptsHeld: number;
  salesClosed: number;
  pctApptsSet: number;
  pctApptsHeld: number;
  pctSalesClosed: number;
}

/**
 * Dashboard B82-B85: every stage is a share of calls made (B82=C10), not
 * chained stage-over-previous-stage.
 */
export function conversionFunnel(rows: DailyMetricsRow[]): FunnelResult {
  const s = summarizeWeek(rows);
  const pct = (n: number) => (s.callsMade === 0 ? 0 : n / s.callsMade);
  return {
    callsMade: s.callsMade,
    apptsSet: s.apptsSet,
    apptsHeld: s.apptsHeld,
    salesClosed: s.salesCount,
    pctApptsSet: pct(s.apptsSet),
    pctApptsHeld: pct(s.apptsHeld),
    pctSalesClosed: pct(s.salesCount),
  };
}

/**
 * Dashboard B75: sum of expected premium on still-open (scheduled)
 * appointments. daily_metrics has no premium/status breakdown for open
 * appointments — this is the one metric that legitimately reads raw
 * `appointments` rows instead of the read model (mirrors the "own dashboard
 * reads raw logs for today only" carve-out in docs/02-data-model.md).
 */
export function pipelineValueOpenAppts(
  appointments: { status: string; expected_premium_cents: number }[]
): number {
  return appointments
    .filter((a) => a.status === 'scheduled')
    .reduce((acc, a) => acc + a.expected_premium_cents, 0);
}
