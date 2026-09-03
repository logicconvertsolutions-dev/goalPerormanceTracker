// Week math lives here and only here (CLAUDE.md rule). Mirrors the
// Postgres function public.week_start(date) exactly — both must agree, or a
// client-computed week boundary will disagree with the RPCs that use it.
import { resolveTimeZone, DEFAULT_TIME_ZONE } from './notifications/window';

/**
 * The browser's own resolved IANA zone -- for 'use client' components that
 * need "what day/time is it right now for this person" without a server
 * round trip (form date defaults, the "Today" chip, etc). Falls back to
 * DEFAULT_TIME_ZONE on the vanishingly rare browser without Intl support,
 * same fallback todayIso/formatDisplayTime use elsewhere.
 *
 * Only meaningful when called client-side: on the server this would
 * resolve to whatever zone the server process itself runs in, not any
 * particular user's, so never call this outside a 'use client' component.
 */
export function browserTimeZone(): string {
  return typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : DEFAULT_TIME_ZONE;
}

/** Monday-start week boundary for the given date, as a YYYY-MM-DD string. */
export function weekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // 1=Mon..7=Sun
  d.setUTCDate(d.getUTCDate() - (isoDow - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Today's calendar date as YYYY-MM-DD, in the given IANA zone -- pass the
 * viewing/acting agent's `time_zone`. `Date.toISOString()` is always UTC
 * regardless of where the code runs (server or browser), so calling this
 * with no zone silently used UTC's calendar day everywhere it mattered
 * (default log/appointment/sale/recruiting dates, "cannot be in the future"
 * validation, "today"/"this week" query boundaries) -- wrong for roughly
 * half of every day for any agent not in UTC, and always wrong during each
 * zone's evening hours already past midnight UTC. Falls back to
 * {@link DEFAULT_TIME_ZONE} (via `resolveTimeZone`) when no zone is given,
 * same fallback the notification scheduler and formatDisplayTime/DateTime use.
 */
export function todayIso(timeZone?: string | null): string {
  // en-CA already formats as yyyy-mm-dd (same trick used by formatDisplayDate
  // et al. below), so no manual part-assembly needed.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function formatDisplayDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-CA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** Same as {@link formatDisplayDate} with the full weekday name, e.g. "Tuesday, Aug 26" — used for the My Day page header. */
export function formatFullDisplayDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-CA', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * Formats a timestamptz as a local time (e.g. "10:30 AM") in the given IANA
 * zone -- pass the viewing agent's `time_zone`. Falls back to
 * {@link DEFAULT_TIME_ZONE} (America/New_York) when the agent hasn't set one
 * or an invalid zone slipped through, matching the fallback the notification
 * scheduler already uses (`resolveTimeZone` in lib/notifications/window.ts)
 * so "the time an agent logged something" reads the same everywhere.
 */
export function formatDisplayTime(isoTimestamp: string, timeZone?: string | null): string {
  return new Date(isoTimestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: resolveTimeZone(timeZone),
  });
}

/**
 * Formats a timestamptz as a local date+weekday (e.g. "Tue, Aug 26") in the
 * given IANA zone -- unlike {@link formatDisplayDate}, which takes a
 * date-only string and is intentionally UTC-locked (a `date` column has no
 * time-of-day to convert), this takes a real timestamptz and must resolve
 * to the viewer's zone or a timestamp near local midnight can show the
 * wrong calendar day.
 */
export function formatDisplayDateTime(isoTimestamp: string, timeZone?: string | null): string {
  return new Date(isoTimestamp).toLocaleDateString('en-CA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: resolveTimeZone(timeZone),
  });
}

/** Adds `days` (may be negative) to an ISO date string, returning an ISO date string. */
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The next Monday strictly after `iso` (i.e. never returns `iso` itself). */
export function nextMonday(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // 1=Mon..7=Sun
  const daysUntilMonday = 8 - isoDow; // always 1..7, so strictly after iso
  return addDays(iso, daysUntilMonday);
}

/**
 * Number of 7-day weeks spanned by an inclusive `[from, to]` range (e.g. a
 * 28-day month = 4, a 31-day month ≈ 4.43). Targets are only ever set
 * per-week (CLAUDE.md rule 8) — there is no monthly target concept in the
 * database — so any KPI target shown for a period longer than one week is
 * this multiplier applied to the weekly number, never a value the SMD set
 * directly.
 */
export function weeksInRange(from: string, to: string): number {
  const start = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return days / 7;
}

export const PERIOD_PRESETS = [
  'this_week',
  'last_week',
  'this_month',
  'last_30_days',
  'custom',
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

/**
 * Resolves a period preset (plus optional custom bounds) to an inclusive
 * `{from, to}` ISO date range. Shared by `<FilterBar>` and every page that
 * reads it, so "This Week" means exactly the same thing everywhere (08-screen-specs.md).
 */
export function resolvePeriod(
  preset: PeriodPreset,
  asOf: string,
  customFrom?: string,
  customTo?: string
): { from: string; to: string } {
  switch (preset) {
    case 'this_week': {
      const from = weekStart(new Date(asOf + 'T00:00:00Z'));
      return { from, to: addDays(from, 6) };
    }
    case 'last_week': {
      const thisWeek = weekStart(new Date(asOf + 'T00:00:00Z'));
      const from = addDays(thisWeek, -7);
      return { from, to: addDays(from, 6) };
    }
    case 'this_month': {
      const d = new Date(asOf + 'T00:00:00Z');
      const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
      const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      return { from, to };
    }
    case 'last_30_days':
      return { from: addDays(asOf, -29), to: asOf };
    case 'custom':
      return { from: customFrom || asOf, to: customTo || asOf };
  }
}

