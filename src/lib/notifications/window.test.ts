// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { kindsInWindow, isRosterReminderWindow, localParts, resolveTimeZone, DEFAULT_TIME_ZONE } from './window';

describe('localParts', () => {
  it('resolves the correct local wall-clock time for a UTC instant', () => {
    // 2026-08-24 (Monday) 23:05 UTC = 19:05 in America/New_York (EDT, UTC-4).
    const at = new Date('2026-08-24T23:05:00.000Z');
    const parts = localParts('America/New_York', at);
    expect(parts).toEqual({ isoDow: 1, dayOfMonth: 24, hour: 19, minute: 5, dateIso: '2026-08-24' });
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
//
// P18: sunday_summary/monday_digest fire on the 10-day cycle boundary now
// (day 10/20/end-of-month evening, day 1/11/21 morning) instead of Sunday/
// Monday -- the kind names are unchanged (see window.ts's own doc comment),
// only what makes each one open changed, so these tests now key off
// dayOfMonth instead of isoDow for those two kinds.
describe('kindsInWindow', () => {
  it('matches evening_nudge any time from 19:00 through 23:59, every day of the week', () => {
    expect(kindsInWindow({ isoDow: 3, dayOfMonth: 26, hour: 19, minute: 0, dateIso: '2026-08-26' })).toEqual(['evening_nudge']);
    expect(kindsInWindow({ isoDow: 3, dayOfMonth: 26, hour: 19, minute: 45, dateIso: '2026-08-26' })).toEqual(['evening_nudge']);
    expect(kindsInWindow({ isoDow: 5, dayOfMonth: 28, hour: 23, minute: 59, dateIso: '2026-08-28' })).toEqual(['evening_nudge']);
    // Weekends, by product decision -- an associate who logs activity on a
    // Saturday still gets the same reminder as any weekday.
    expect(kindsInWindow({ isoDow: 6, dayOfMonth: 29, hour: 20, minute: 0, dateIso: '2026-08-29' })).toEqual(['evening_nudge']);
  });

  it('does not match evening_nudge before 19:00', () => {
    expect(kindsInWindow({ isoDow: 3, dayOfMonth: 26, hour: 18, minute: 59, dateIso: '2026-08-26' })).toEqual([]);
    expect(kindsInWindow({ isoDow: 6, dayOfMonth: 29, hour: 18, minute: 59, dateIso: '2026-08-29' })).toEqual([]);
  });

  it('matches sunday_summary any time from 18:00 onward, on day 10/20/end-of-month only', () => {
    // Before evening_nudge's own 19:00 threshold, only sunday_summary is open.
    expect(kindsInWindow({ isoDow: 4, dayOfMonth: 10, hour: 18, minute: 5, dateIso: '2026-09-10' })).toEqual(['sunday_summary']);
    expect(kindsInWindow({ isoDow: 7, dayOfMonth: 20, hour: 18, minute: 5, dateIso: '2026-09-20' })).toEqual(['sunday_summary']);
    // 30-day month's end.
    expect(kindsInWindow({ isoDow: 3, dayOfMonth: 30, hour: 18, minute: 5, dateIso: '2026-09-30' })).toEqual(['sunday_summary']);
    // Non-leap February's end (28 days).
    expect(kindsInWindow({ isoDow: 6, dayOfMonth: 28, hour: 18, minute: 5, dateIso: '2026-02-28' })).toEqual(['sunday_summary']);
    // A non-boundary day, even at the same hour, is closed.
    expect(kindsInWindow({ isoDow: 3, dayOfMonth: 9, hour: 18, minute: 5, dateIso: '2026-09-09' })).toEqual([]);
  });

  it('matches monday_digest from 08:00 up to (not including) 19:00, on day 1/11/21 only', () => {
    expect(kindsInWindow({ isoDow: 2, dayOfMonth: 1, hour: 8, minute: 0, dateIso: '2026-09-01' })).toEqual(['monday_digest']);
    expect(kindsInWindow({ isoDow: 5, dayOfMonth: 11, hour: 18, minute: 59, dateIso: '2026-09-11' })).toEqual(['monday_digest']);
    expect(kindsInWindow({ isoDow: 1, dayOfMonth: 21, hour: 7, minute: 59, dateIso: '2026-09-21' })).toEqual([]);
    expect(kindsInWindow({ isoDow: 3, dayOfMonth: 2, hour: 8, minute: 0, dateIso: '2026-09-02' })).toEqual([]);
  });

  it('hands a cycle-start evening to evening_nudge, not monday_digest, once both would otherwise be open', () => {
    // Without the 19:00 cap on monday_digest, this would return both kinds
    // on a cycle-start day's evening. This pairing can never actually
    // happen for one person (evening_nudge is associate-only, monday_digest
    // is leader/admin-only), so the cap is defensive consistency with the
    // SQL mirror, not a behavior anyone relies on.
    expect(kindsInWindow({ isoDow: 2, dayOfMonth: 1, hour: 19, minute: 0, dateIso: '2026-09-01' })).toEqual(['evening_nudge']);
    expect(kindsInWindow({ isoDow: 2, dayOfMonth: 1, hour: 23, minute: 0, dateIso: '2026-09-01' })).toEqual(['evening_nudge']);
  });

  it('deliberately returns both evening_nudge and sunday_summary on a cycle-end evening', () => {
    // Both are associate-facing, so this is the one real case where the
    // same person gets two kinds from a single call -- a product decision,
    // not a bug (see this file's own doc comment). Each kind has its own
    // notification_log dedup key, so both sends are independently rate-limited.
    const kinds = kindsInWindow({ isoDow: 4, dayOfMonth: 10, hour: 19, minute: 0, dateIso: '2026-09-10' });
    expect(kinds.sort()).toEqual(['evening_nudge', 'sunday_summary']);
  });
});

describe('isRosterReminderWindow', () => {
  it('matches Wednesday and Saturday any time from 09:00 onward', () => {
    expect(isRosterReminderWindow({ isoDow: 3, dayOfMonth: 26, hour: 9, minute: 0, dateIso: '2026-08-26' })).toBe(true);
    expect(isRosterReminderWindow({ isoDow: 3, dayOfMonth: 26, hour: 21, minute: 0, dateIso: '2026-08-26' })).toBe(true);
    expect(isRosterReminderWindow({ isoDow: 6, dayOfMonth: 29, hour: 9, minute: 0, dateIso: '2026-08-29' })).toBe(true);
  });

  it('does not match before 09:00 or on other days', () => {
    expect(isRosterReminderWindow({ isoDow: 3, dayOfMonth: 26, hour: 8, minute: 59, dateIso: '2026-08-26' })).toBe(false);
    expect(isRosterReminderWindow({ isoDow: 1, dayOfMonth: 24, hour: 9, minute: 0, dateIso: '2026-08-24' })).toBe(false);
    expect(isRosterReminderWindow({ isoDow: 7, dayOfMonth: 30, hour: 9, minute: 0, dateIso: '2026-08-30' })).toBe(false);
  });
});
