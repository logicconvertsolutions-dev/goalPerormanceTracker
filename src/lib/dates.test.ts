// Regression coverage for todayIso(): it used to be `new Date().toISOString()`,
// always UTC regardless of where it ran (server or browser), which was wrong
// for roughly half of every day for any agent not in UTC -- most visibly,
// any agent evening after their local midnight has already passed UTC's.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { todayIso } from './dates';

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
