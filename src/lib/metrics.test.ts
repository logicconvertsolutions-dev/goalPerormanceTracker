// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  conversionFunnel,
  currentStreak,
  dialToConnectRatio,
  daysToMdDeadline,
  noShowRate,
  pipelineValueOpenAppts,
  rollingAvgCallsPerWeek,
  summarizeWeek,
  type DailyMetricsRow,
} from './metrics';

function row(overrides: Partial<DailyMetricsRow>): DailyMetricsRow {
  return {
    agent_id: 'a',
    org_id: 'o',
    activity_date: '2026-07-06',
    calls_made: 0,
    appts_set: 0,
    referrals_given: 0,
    recruiting_convos: 0,
    follow_ups_due: 0,
    follow_ups_done: 0,
    premium_cents: 0,
    sales_count: 0,
    out_connected: 0,
    out_voicemail: 0,
    out_no_answer: 0,
    out_appt_set: 0,
    out_not_interested: 0,
    src_warm_market: 0,
    src_referral: 0,
    src_cold: 0,
    src_social_media: 0,
    src_friend: 0,
    src_other: 0,
    appt_scheduled: 0,
    appt_held: 0,
    appt_no_show: 0,
    appt_rescheduled: 0,
    appt_cancelled: 0,
    updated_at: '2026-07-06T00:00:00Z',
    ...overrides,
  };
}

// Mirrors the workbook's one populated week: 1 call (outcome "No Answer",
// source "Friend"), no appointments/sales this week.
const workbookWeek: DailyMetricsRow[] = [
  row({ activity_date: '2026-07-06', calls_made: 1, out_no_answer: 1, src_friend: 1 }),
];

describe('summarizeWeek', () => {
  it('sums across days', () => {
    const rows = [
      row({ activity_date: '2026-07-06', calls_made: 2, out_connected: 1 }),
      row({ activity_date: '2026-07-07', calls_made: 3, out_connected: 1 }),
    ];
    expect(summarizeWeek(rows).callsMade).toBe(5);
    expect(summarizeWeek(rows).outConnected).toBe(2);
  });
});

describe('dialToConnectRatio', () => {
  it('is 0 when no calls made', () => {
    expect(dialToConnectRatio([])).toBe(0);
  });
  it('matches the workbook (0 connected / 1 call = 0)', () => {
    expect(dialToConnectRatio(workbookWeek)).toBe(0);
  });
  it('divides connected by calls made', () => {
    const rows = [row({ calls_made: 4, out_connected: 1 })];
    expect(dialToConnectRatio(rows)).toBe(0.25);
  });
});

describe('noShowRate', () => {
  it('is 0 when no appointments logged', () => {
    expect(noShowRate(workbookWeek)).toBe(0);
  });
  it('divides no-shows by all appointment statuses in the week', () => {
    const rows = [
      row({ appt_scheduled: 1, appt_held: 2, appt_no_show: 1, appt_rescheduled: 0, appt_cancelled: 0 }),
    ];
    // 1 / (1+2+1+0+0) = 0.25
    expect(noShowRate(rows)).toBe(0.25);
  });
});

describe('rollingAvgCallsPerWeek', () => {
  it('matches the workbook: 1 call in the most recent of 4 weeks = 0.25', () => {
    const weeks = [[], [], [], workbookWeek];
    expect(rollingAvgCallsPerWeek(weeks)).toBe(0.25);
  });
  it('always divides by 4 even with fewer weeks supplied', () => {
    expect(rollingAvgCallsPerWeek([workbookWeek])).toBe(0.25);
  });
  it('only considers the last 4 weeks when more are supplied', () => {
    const eightZeroWeeks = Array.from({ length: 7 }, () => [] as DailyMetricsRow[]);
    expect(rollingAvgCallsPerWeek([...eightZeroWeeks, workbookWeek])).toBe(0.25);
  });
});

describe('currentStreak', () => {
  it('counts consecutive days meeting the minimum, walking back from asOf', () => {
    const rows = new Map<string, DailyMetricsRow>([
      ['2026-07-08', row({ activity_date: '2026-07-08', calls_made: 15 })],
      ['2026-07-07', row({ activity_date: '2026-07-07', calls_made: 20 })],
      ['2026-07-06', row({ activity_date: '2026-07-06', calls_made: 14 })], // breaks it
    ]);
    expect(currentStreak(rows, 15, '2026-07-08')).toBe(2);
  });
  it('is 0 when today does not meet the minimum', () => {
    const rows = new Map<string, DailyMetricsRow>([
      ['2026-07-08', row({ activity_date: '2026-07-08', calls_made: 1 })],
    ]);
    expect(currentStreak(rows, 15, '2026-07-08')).toBe(0);
  });
  it('is unaffected by future-dated rows', () => {
    const rows = new Map<string, DailyMetricsRow>([
      ['2026-07-09', row({ activity_date: '2026-07-09', calls_made: 0 })], // future, empty
      ['2026-07-08', row({ activity_date: '2026-07-08', calls_made: 15 })],
    ]);
    expect(currentStreak(rows, 15, '2026-07-08')).toBe(1);
  });
});

describe('daysToMdDeadline', () => {
  it('matches the workbook formula shape: deadline - today', () => {
    expect(daysToMdDeadline('2026-08-01', '2026-07-25')).toBe(7);
  });
  it('is negative once the deadline has passed', () => {
    expect(daysToMdDeadline('2026-07-01', '2026-07-10')).toBe(-9);
  });
});

describe('conversionFunnel', () => {
  it('matches the workbook: 1 call, 0 appts, 0 sales', () => {
    const f = conversionFunnel(workbookWeek);
    expect(f).toMatchObject({
      callsMade: 1,
      apptsSet: 0,
      apptsHeld: 0,
      salesClosed: 0,
      pctApptsSet: 0,
      pctApptsHeld: 0,
      pctSalesClosed: 0,
    });
  });
  it('each stage is a percentage of calls made, not the previous stage', () => {
    const rows = [row({ calls_made: 10, appts_set: 4, appt_held: 2, sales_count: 1 })];
    const f = conversionFunnel(rows);
    expect(f.pctApptsSet).toBe(0.4);
    expect(f.pctApptsHeld).toBe(0.2);
    expect(f.pctSalesClosed).toBe(0.1);
  });
});

describe('pipelineValueOpenAppts', () => {
  it('sums expected premium for scheduled appointments only', () => {
    const appts = [
      { status: 'scheduled', expected_premium_cents: 8500 },
      { status: 'held', expected_premium_cents: 5000 },
      { status: 'scheduled', expected_premium_cents: 1500 },
    ];
    expect(pipelineValueOpenAppts(appts)).toBe(10000);
  });
});
