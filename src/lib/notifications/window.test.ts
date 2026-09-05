// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { kindsInWindow, isRosterReminderWindow, localParts, resolveTimeZone, DEFAULT_TIME_ZONE } from './window';

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

// P14a widened these from an exact 15-minute slot to "any time from the
// target hour through end of local day" -- self-healing against a late or
// skipped cron tick (whatever triggers the caller). The per-day dedup lives
// in each caller's own claim table, not in how narrow this window is.
describe('kindsInWindow', () => {
  it('matches evening_nudge any time from 19:00 through 23:59, every day of the week', () => {
    expect(kindsInWindow({ isoDow: 3, hour: 19, minute: 0, dateIso: '2026-08-26' })).toEqual(['evening_nudge']);
    expect(kindsInWindow({ isoDow: 3, hour: 19, minute: 45, dateIso: '2026-08-26' })).toEqual(['evening_nudge']);
    expect(kindsInWindow({ isoDow: 5, hour: 23, minute: 59, dateIso: '2026-08-28' })).toEqual(['evening_nudge']);
    // Weekends, by product decision -- an associate who logs activity on a
    // Saturday still gets the same reminder as any weekday.
    expect(kindsInWindow({ isoDow: 6, hour: 20, minute: 0, dateIso: '2026-08-29' })).toEqual(['evening_nudge']);
  });

  it('does not match evening_nudge before 19:00', () => {
    expect(kindsInWindow({ isoDow: 3, hour: 18, minute: 59, dateIso: '2026-08-26' })).toEqual([]);
    expect(kindsInWindow({ isoDow: 6, hour: 18, minute: 59, dateIso: '2026-08-29' })).toEqual([]);
  });

  it('matches sunday_summary any time from 18:00 onward, Sunday only', () => {
    // Before evening_nudge's own 19:00 threshold, only sunday_summary is open.
    expect(kindsInWindow({ isoDow: 7, hour: 18, minute: 5, dateIso: '2026-08-30' })).toEqual(['sunday_summary']);
    expect(kindsInWindow({ isoDow: 6, hour: 18, minute: 5, dateIso: '2026-08-29' })).toEqual([]);
  });

  it('matches monday_digest from 08:00 up to (not including) 19:00, Monday only', () => {
    expect(kindsInWindow({ isoDow: 1, hour: 8, minute: 0, dateIso: '2026-08-24' })).toEqual(['monday_digest']);
    expect(kindsInWindow({ isoDow: 1, hour: 18, minute: 59, dateIso: '2026-08-24' })).toEqual(['monday_digest']);
    expect(kindsInWindow({ isoDow: 1, hour: 7, minute: 59, dateIso: '2026-08-24' })).toEqual([]);
  });

  it('hands Monday evening to evening_nudge, not monday_digest, once both would otherwise be open', () => {
    // Without the 19:00 cap on monday_digest, this would return both kinds
    // for a Monday evening. Unlike the Sunday case below, this pairing can
    // never actually happen for one person (evening_nudge is associate-only,
    // monday_digest is leader/admin-only), so the cap is defensive
    // consistency with the SQL mirror, not a behavior anyone relies on.
    expect(kindsInWindow({ isoDow: 1, hour: 19, minute: 0, dateIso: '2026-08-24' })).toEqual(['evening_nudge']);
    expect(kindsInWindow({ isoDow: 1, hour: 23, minute: 0, dateIso: '2026-08-24' })).toEqual(['evening_nudge']);
  });

  it('deliberately returns both evening_nudge and sunday_summary on a Sunday evening', () => {
    // Both are associate-facing, so this is the one real case where the
    // same person gets two kinds from a single call -- a product decision,
    // not a bug (see this file's own doc comment). Each kind has its own
    // notification_log dedup key, so both sends are independently rate-limited.
    const kinds = kindsInWindow({ isoDow: 7, hour: 19, minute: 0, dateIso: '2026-08-30' });
    expect(kinds.sort()).toEqual(['evening_nudge', 'sunday_summary']);
  });
});

describe('isRosterReminderWindow', () => {
  it('matches Wednesday and Saturday any time from 09:00 onward', () => {
    expect(isRosterReminderWindow({ isoDow: 3, hour: 9, minute: 0, dateIso: '2026-08-26' })).toBe(true);
    expect(isRosterReminderWindow({ isoDow: 3, hour: 21, minute: 0, dateIso: '2026-08-26' })).toBe(true);
    expect(isRosterReminderWindow({ isoDow: 6, hour: 9, minute: 0, dateIso: '2026-08-29' })).toBe(true);
  });

  it('does not match before 09:00 or on other days', () => {
    expect(isRosterReminderWindow({ isoDow: 3, hour: 8, minute: 59, dateIso: '2026-08-26' })).toBe(false);
    expect(isRosterReminderWindow({ isoDow: 1, hour: 9, minute: 0, dateIso: '2026-08-24' })).toBe(false);
    expect(isRosterReminderWindow({ isoDow: 7, hour: 9, minute: 0, dateIso: '2026-08-30' })).toBe(false);
  });
});
