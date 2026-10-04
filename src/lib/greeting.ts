import { formatDisplayTime, formatFullDisplayDate, hourInZone, isoToDateInZone } from './dates';

/** "Good morning" / "Good afternoon" / "Good evening" for the agent's own
 * local hour -- pass the agent's `time_zone`, not the server's. */
export function greetingFor(now: Date, timeZone?: string | null): string {
  const hour = hourInZone(now, timeZone);
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** First word of a full name, for a friendly greeting. Falls back to the
 * whole (trimmed) string when there is no space, and to "there" when empty. */
export function firstName(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? '').trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0];
}

/** The My Day header's second line (P36): the agent's local date and time,
 * e.g. "Saturday, Oct 3 · 7:42 PM" -- pass the agent's `time_zone`. */
export function dateTimeLine(now: Date, timeZone?: string | null): string {
  const iso = now.toISOString();
  return `${formatFullDisplayDate(isoToDateInZone(iso, timeZone))} · ${formatDisplayTime(iso, timeZone)}`;
}
