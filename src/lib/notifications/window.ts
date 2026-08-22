// Per-agent local time window matching. Each agent carries an IANA time_zone
// (settings screen, defaults from the browser); the cron job runs on a
// fixed UTC schedule (.github/workflows/notifications-cron.yml, every 15
// minutes) and this is what maps "now, in UTC" to "is it 7:00pm for this
// particular agent right now." Deliberately no manual DST math:
// Intl.DateTimeFormat resolves the offset for the given instant + zone,
// DST included.

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
    hour,
    minute: Number(get('minute')),
    dateIso: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

const WINDOW_MINUTES = 15; // matches the cron cadence in notifications-cron.yml

/** Which notification kinds are in their send window for this agent right now. */
export function kindsInWindow(parts: LocalParts): NotificationKind[] {
  const kinds: NotificationKind[] = [];
  if (parts.isoDow >= 1 && parts.isoDow <= 5 && parts.hour === 19 && parts.minute < WINDOW_MINUTES) {
    kinds.push('evening_nudge');
  }
  if (parts.isoDow === 7 && parts.hour === 18 && parts.minute < WINDOW_MINUTES) {
    kinds.push('sunday_summary');
  }
  if (parts.isoDow === 1 && parts.hour === 8 && parts.minute < WINDOW_MINUTES) {
    kinds.push('monday_digest');
  }
  return kinds;
}
