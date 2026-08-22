// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { kindsInWindow, localParts, resolveTimeZone, DEFAULT_TIME_ZONE } from './window';

describe('localParts', () => {
  it('resolves the correct local wall-clock time for a UTC instant', () => {
    // 2026-08-24 (Monday) 23:05 UTC = 19:05 in America/New_York (EDT, UTC-4).
    const at = new Date('2026-08-24T23:05:00.000Z');
    const parts = localParts('America/New_York', at);
    expect(parts).toEqual({ isoDow: 1, hour: 19, minute: 5, dateIso: '2026-08-24' });
  });

  it('rolls the calendar date across the timezone boundary', () => {
    // 2026-08-24 01:00 UTC = 2026-08-23 18:00 in America/Los_Angeles (PDT, UTC-7).
    const at = new Date('2026-08-24T01:00:00.000Z');
    const parts = localParts('America/Los_Angeles', at);
    expect(parts.dateIso).toBe('2026-08-23');
    expect(parts.isoDow).toBe(7); // Sunday
    expect(parts.hour).toBe(18);
  });

  it('handles midnight without an off-by-one hour', () => {
    const at = new Date('2026-08-24T04:00:00.000Z'); // 00:00 in America/New_York (EDT)
    const parts = localParts('America/New_York', at);
    expect(parts.hour).toBe(0);
  });
});

describe('resolveTimeZone', () => {
  it('passes through a valid IANA zone', () => {
    expect(resolveTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
  });

  it('falls back to the default for null, undefined, or invalid zones', () => {
    expect(resolveTimeZone(null)).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone(undefined)).toBe(DEFAULT_TIME_ZONE);
    expect(resolveTimeZone('Not/AZone')).toBe(DEFAULT_TIME_ZONE);
  });
});

describe('kindsInWindow', () => {
  it('matches evening_nudge on a weekday at 19:00-19:14', () => {
    expect(kindsInWindow({ isoDow: 3, hour: 19, minute: 0, dateIso: '2026-08-26' })).toEqual([
      'evening_nudge',
    ]);
    expect(kindsInWindow({ isoDow: 3, hour: 19, minute: 14, dateIso: '2026-08-26' })).toEqual([
      'evening_nudge',
    ]);
  });

  it('does not match evening_nudge outside the window or on a weekend', () => {
    expect(kindsInWindow({ isoDow: 3, hour: 19, minute: 15, dateIso: '2026-08-26' })).toEqual([]);
    expect(kindsInWindow({ isoDow: 3, hour: 20, minute: 0, dateIso: '2026-08-26' })).toEqual([]);
    expect(kindsInWindow({ isoDow: 6, hour: 19, minute: 0, dateIso: '2026-08-29' })).toEqual([]);
  });

  it('matches sunday_summary only on Sunday at 18:00-18:14', () => {
    expect(kindsInWindow({ isoDow: 7, hour: 18, minute: 5, dateIso: '2026-08-30' })).toEqual([
      'sunday_summary',
    ]);
    expect(kindsInWindow({ isoDow: 6, hour: 18, minute: 5, dateIso: '2026-08-29' })).toEqual([]);
  });

  it('matches monday_digest only on Monday at 08:00-08:14', () => {
    expect(kindsInWindow({ isoDow: 1, hour: 8, minute: 0, dateIso: '2026-08-24' })).toEqual([
      'monday_digest',
    ]);
    expect(kindsInWindow({ isoDow: 1, hour: 9, minute: 0, dateIso: '2026-08-24' })).toEqual([]);
  });

  it('never matches more than one kind at once', () => {
    for (let dow = 1; dow <= 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        expect(kindsInWindow({ isoDow: dow, hour, minute: 0, dateIso: '2026-08-24' }).length).toBeLessThanOrEqual(1);
      }
    }
  });
});
