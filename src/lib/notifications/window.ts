// Per-agent local time window matching. Each agent carries an IANA time_zone
// (settings screen, defaults from the browser); the cron tick that calls
// this maps "now, in UTC" to "is it evening yet for this particular agent."
// Deliberately no manual DST math: Intl.DateTimeFormat resolves the offset
// for the given instant + zone, DST included.
//
// P14a widened every window below from an exact narrow slot (originally
// 15 minutes, matching a fixed cron cadence) to "any time from the target
// local hour through the end of the local day" -- self-healing against a
// late or skipped cron tick, whatever triggers the caller. This mirrors
// private.enqueue_due_notifications()'s own SQL (which now owns the
// evening_nudge/sunday_summary/monday_digest decision for real -- see that
// migration); kindsInWindow/isRosterReminderWindow stay here only because
// the roster-reminder and auto-call-nudge paths (src/app/api/cron/
// notifications/route.ts) still use them directly. Each caller's own
// insert-first dedup table (notification_log, team_roster_reminder_log,
// agent_auto_nudge_log) is what actually prevents a widened window from
// sending twice in one day, not the window's width.

export type NotificationKind = 'evening_nudge' | 'sunday_summary' | 'monday_digest';

export const DEFAULT_TIME_ZONE = 'America/New_York';

/** Falls back to DEFAULT_TIME_ZONE for null/invalid zones (e.g. never set in /settings). */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIME_ZONE;
  try {
    // eslint-disable-next-line no-new -- throws on an invalid IANA zone name
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export interface LocalParts {
  /** ISO day of week: 1 = Monday .. 7 = Sunday, matching week_start()'s convention. */
  isoDow: number;
  /** Day of the month (1-31), matching cycle_start()/cycle_end()'s convention. */
  dayOfMonth: number;
  hour: number;
  minute: number;
  /** YYYY-MM-DD in the target zone -- the notification_log rate-limit key. */
  dateIso: string;
}

const ISO_DOW: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localParts(timeZone: string, at: Date): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // en-US hour12:false formats midnight as "24", not "00".
  const hour = Number(get('hour')) % 24;
  return {
    isoDow: ISO_DOW[get('weekday')] ?? 1,
    dayOfMonth: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    dateIso: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** True when `dateIso` (YYYY-MM-DD) is the last calendar day of its month --
 * the variable-length end of a 10-day cycle's third chunk (8-11 days). */
function isLastDayOfMonth(dateIso: string): boolean {
  const [y, m] = dateIso.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Number(dateIso.slice(-2)) === lastDay;
}

/**
 * Which notification kinds are in their send window for this agent right
 * now. evening_nudge runs every day (by product decision -- agents who log
 * activity on weekends still get reminded), which means the last evening of
 * a cycle can yield *both* evening_nudge and sunday_summary at once for the
 * same agent -- a deliberate exception, not a bug, since the two serve
 * different purposes (a daily reminder vs. a cycle recap) and each has its
 * own notification_log dedup key. monday_digest still caps out before 19:00
 * so it never overlaps evening_nudge's own >=19:00 window on the same
 * calendar day -- relevant since P19b made leaders eligible for both
 * (evening_nudge/sunday_summary now fire for associates and leaders alike,
 * not associates only; monday_digest stays leader/admin only), so a leader
 * really can receive an evening nudge and a team cycle digest on the same
 * cycle-start day, just never at the same moment.
 *
 * sunday_summary/monday_digest keep their original names (P18) even though
 * they no longer fire on Sunday/Monday specifically -- see
 * private.enqueue_due_notifications()'s own doc comment for why the
 * internal identifiers weren't renamed along with the cadence.
 */
export function kindsInWindow(parts: LocalParts): NotificationKind[] {
  const kinds: NotificationKind[] = [];
  if (parts.hour >= 19) {
    kinds.push('evening_nudge');
  }
  const isCycleEndDay = parts.dayOfMonth === 10 || parts.dayOfMonth === 20 || isLastDayOfMonth(parts.dateIso);
  if (isCycleEndDay && parts.hour >= 18) {
    kinds.push('sunday_summary');
  }
  const isCycleStartDay = parts.dayOfMonth === 1 || parts.dayOfMonth === 11 || parts.dayOfMonth === 21;
  if (isCycleStartDay && parts.hour >= 8 && parts.hour < 19) {
    kinds.push('monday_digest');
  }
  return kinds;
}

// team_roster's automatic training-reminder cadence (p11a) -- distinct from
// kindsInWindow above: it's not keyed to an agent's own role/prefs, it's an
// always-on schedule for every roster entry with auto_reminders_enabled, so
// it isn't part of the NotificationKind union. Wed/Sat, 9am local to
// whichever time zone the cron route resolves for that roster row (its
// upline's, since a roster entry has none of its own).
export function isRosterReminderWindow(parts: LocalParts): boolean {
  return (parts.isoDow === 3 || parts.isoDow === 6) && parts.hour >= 9;
}
