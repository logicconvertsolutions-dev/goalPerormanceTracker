// Regression coverage for todayIso(): it used to be `new Date().toISOString()`,
// always UTC regardless of where it ran (server or browser), which was wrong
// for roughly half of every day for any agent not in UTC -- most visibly,
// any agent evening after their local midnight has already passed UTC's.
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  todayIso,
  cycleBounds,
  previousCycleBounds,
  nextCycleStart,
  cyclesInRange,
  formatCycleRange,
  isPeriodPreset,
  resolvePeriod,
  shiftZonedTimestampByDays,
} from './dates';

describe('todayIso', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the local calendar day in the given zone, not UTC', () => {
    // 2026-08-18 03:00 UTC == 2026-08-17 20:00 in Vancouver (UTC-7 in August, PDT).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T03:00:00Z'));

    expect(todayIso('America/Vancouver')).toBe('2026-08-17');
    expect(todayIso('UTC')).toBe('2026-08-18');
  });

  it('falls back to DEFAULT_TIME_ZONE (America/New_York) when no zone is given', () => {
    // 2026-08-18 03:00 UTC == 2026-08-17 23:00 Eastern (EDT, UTC-4) -- still
    // the previous day locally, same class of bug as the Vancouver case.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T03:00:00Z'));

    expect(todayIso()).toBe('2026-08-17');
    expect(todayIso(null)).toBe('2026-08-17');
    expect(todayIso(undefined)).toBe('2026-08-17');
  });

  it('falls back to the default zone for an invalid/garbage zone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T03:00:00Z'));

    expect(todayIso('not-a-real-zone')).toBe(todayIso());
  });
});

// P16: the 10-day cycle (day 1-10, day 11-20, day 21-end-of-month, the last
// chunk 8-11 days depending on the month) that replaced "This Week"/"Last
// Week" as the period-filter unit and Goals' versioning unit.
describe('cycleBounds', () => {
  it('resolves the first chunk (day 1-10)', () => {
    expect(cycleBounds(new Date('2026-09-06T00:00:00Z'))).toEqual({ from: '2026-09-01', to: '2026-09-10' });
    expect(cycleBounds(new Date('2026-09-01T00:00:00Z'))).toEqual({ from: '2026-09-01', to: '2026-09-10' });
    expect(cycleBounds(new Date('2026-09-10T00:00:00Z'))).toEqual({ from: '2026-09-01', to: '2026-09-10' });
  });

  it('resolves the second chunk (day 11-20)', () => {
    expect(cycleBounds(new Date('2026-09-11T00:00:00Z'))).toEqual({ from: '2026-09-11', to: '2026-09-20' });
    expect(cycleBounds(new Date('2026-09-15T00:00:00Z'))).toEqual({ from: '2026-09-11', to: '2026-09-20' });
    expect(cycleBounds(new Date('2026-09-20T00:00:00Z'))).toEqual({ from: '2026-09-11', to: '2026-09-20' });
  });

  it('resolves the variable-length third chunk (day 21-end-of-month)', () => {
    // 30-day month.
    expect(cycleBounds(new Date('2026-09-21T00:00:00Z'))).toEqual({ from: '2026-09-21', to: '2026-09-30' });
    // 31-day month.
    expect(cycleBounds(new Date('2026-10-25T00:00:00Z'))).toEqual({ from: '2026-10-21', to: '2026-10-31' });
    // Non-leap February (2026 is not a leap year) -- 8-day third chunk.
    expect(cycleBounds(new Date('2026-02-21T00:00:00Z'))).toEqual({ from: '2026-02-21', to: '2026-02-28' });
    // Leap February -- 9-day third chunk.
    expect(cycleBounds(new Date('2024-02-21T00:00:00Z'))).toEqual({ from: '2024-02-21', to: '2024-02-29' });
  });
});

describe('formatCycleRange', () => {
  it('states the month once for a within-month cycle', () => {
    expect(formatCycleRange('2026-09-11', '2026-09-20')).toBe('Sep 11-20');
    expect(formatCycleRange('2026-09-01', '2026-09-10')).toBe('Sep 1-10');
  });

  it('covers the variable-length third chunk', () => {
    expect(formatCycleRange('2026-08-21', '2026-08-31')).toBe('Aug 21-31');
    expect(formatCycleRange('2026-02-21', '2026-02-28')).toBe('Feb 21-28');
  });

  it('names both months if a range ever spans two', () => {
    expect(formatCycleRange('2026-08-21', '2026-09-01')).toBe('Aug 21 - Sep 1');
  });
});

describe('previousCycleBounds', () => {
  it('steps back within the same month', () => {
    expect(previousCycleBounds(new Date('2026-09-15T00:00:00Z'))).toEqual({ from: '2026-09-01', to: '2026-09-10' });
    expect(previousCycleBounds(new Date('2026-09-25T00:00:00Z'))).toEqual({ from: '2026-09-11', to: '2026-09-20' });
  });

  it('crosses a month boundary onto the previous month\'s variable-length third chunk', () => {
    expect(previousCycleBounds(new Date('2026-09-03T00:00:00Z'))).toEqual({ from: '2026-08-21', to: '2026-08-31' });
  });

  it('crosses a year boundary', () => {
    expect(previousCycleBounds(new Date('2026-01-05T00:00:00Z'))).toEqual({ from: '2025-12-21', to: '2025-12-31' });
  });
});

describe('nextCycleStart', () => {
  it('returns the next chunk within the same month', () => {
    expect(nextCycleStart('2026-09-03')).toBe('2026-09-11');
    expect(nextCycleStart('2026-09-15')).toBe('2026-09-21');
  });

  it('crosses a month boundary', () => {
    expect(nextCycleStart('2026-09-25')).toBe('2026-10-01');
  });

  it('never returns the input\'s own cycle start, even from the exact start date', () => {
    expect(nextCycleStart('2026-09-01')).toBe('2026-09-11');
  });
});

describe('cyclesInRange', () => {
  it('divides by the nominal 10-day cycle length', () => {
    expect(cyclesInRange('2026-09-01', '2026-09-10')).toBe(1);
    expect(cyclesInRange('2026-09-01', '2026-09-20')).toBe(2);
    expect(cyclesInRange('2026-09-01', '2026-09-30')).toBe(3);
  });
});

describe('isPeriodPreset / resolvePeriod (current_cycle, previous_cycle)', () => {
  it('accepts the new cycle presets and rejects the retired week ones', () => {
    expect(isPeriodPreset('current_cycle')).toBe(true);
    expect(isPeriodPreset('previous_cycle')).toBe(true);
    expect(isPeriodPreset('this_week')).toBe(false);
    expect(isPeriodPreset('last_week')).toBe(false);
    expect(isPeriodPreset(null)).toBe(false);
    expect(isPeriodPreset(undefined)).toBe(false);
  });

  it('resolves current_cycle/previous_cycle to the same bounds as cycleBounds/previousCycleBounds', () => {
    const asOf = '2026-09-15';
    expect(resolvePeriod('current_cycle', asOf)).toEqual(cycleBounds(new Date(asOf + 'T00:00:00Z')));
    expect(resolvePeriod('previous_cycle', asOf)).toEqual(previousCycleBounds(new Date(asOf + 'T00:00:00Z')));
  });
});

// P25 C1 edge case E4: snoozing an appointment shifts the slot by whole
// days in the agent's own zone. Adding 24h*n to the instant instead would
// slide the appointment an hour off whenever the shift crosses a DST
// transition -- a 2:00 PM appointment becoming 1:00 PM or 3:00 PM.
describe('shiftZonedTimestampByDays', () => {
  it('keeps the local wall-clock time across spring-forward', () => {
    // 2026-03-08 is the US spring-forward. 2:00 PM EST on the 7th must stay
    // 2:00 PM (EDT) on the 8th, even though only 23 real hours elapsed.
    const out = shiftZonedTimestampByDays('2026-03-07T19:00:00.000Z', 1, 'America/New_York');
    expect(out).toBe('2026-03-08T18:00:00.000Z');
  });

  it('keeps the local wall-clock time across fall-back', () => {
    // 2026-11-01 is the US fall-back: 25 real hours, same wall clock.
    const out = shiftZonedTimestampByDays('2026-10-31T18:00:00.000Z', 1, 'America/New_York');
    expect(out).toBe('2026-11-01T19:00:00.000Z');
  });

  it('shifts whole days with no transition in between', () => {
    expect(shiftZonedTimestampByDays('2026-06-10T18:00:00.000Z', 7, 'America/New_York')).toBe(
      '2026-06-17T18:00:00.000Z'
    );
  });

  it('rolls over a month boundary', () => {
    expect(shiftZonedTimestampByDays('2026-01-30T18:00:00.000Z', 7, 'America/New_York')).toBe(
      '2026-02-06T18:00:00.000Z'
    );
  });

  it('falls back to the default zone rather than the runtime zone', () => {
    // Same reasoning as todayIso above -- an agent with no time_zone set
    // must not get whatever zone the server process happens to run in.
    expect(shiftZonedTimestampByDays('2026-06-10T18:00:00.000Z', 1, null)).toBe(
      shiftZonedTimestampByDays('2026-06-10T18:00:00.000Z', 1, 'America/New_York')
    );
  });
});
