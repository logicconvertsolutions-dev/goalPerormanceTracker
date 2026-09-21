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

/**
 * Same idea as {@link todayIso}, but for an arbitrary instant instead of
 * "now" -- the calendar date (YYYY-MM-DD) a given ISO timestamp falls on in
 * the given IANA zone. Server-safe (unlike {@link isoToLocalParts}, which
 * reads the runtime's own zone): pass the acting agent's `time_zone`
 * explicitly, same as todayIso.
 */
export function isoToDateInZone(iso: string, timeZone?: string | null): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
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

/**
 * Splits an ISO instant into the local `date`/`time` strings an
 * `<input type="date">`/`<input type="time">` pair need, in the browser's
 * own zone -- the inverse of `new Date(`${date}T${time}`).toISOString()`,
 * which combines them back on submit. Client-side use only (see
 * {@link browserTimeZone}'s own caveat -- this reads the *current* runtime's
 * zone via Intl's default, same reasoning applies here).
 */
export function isoToLocalParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d),
    time: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d),
  };
}

/**
 * Shifts a timestamptz by whole days *in the given IANA zone*, preserving
 * the local wall-clock time across a DST transition -- "2:00 PM on the 7th"
 * snoozed by one day is "2:00 PM on the 8th", not "1:00 PM" or "3:00 PM"
 * (P25 edge case E4).
 *
 * `addDays` can't do this: it operates on date-only strings, and adding
 * 24h*n to an instant slides the local time by an hour whenever the shift
 * crosses a transition. Pass the acting agent's `time_zone`, same as
 * {@link isoToDateInZone}.
 */
export function shiftZonedTimestampByDays(iso: string, days: number, timeZone?: string | null): string {
  const zone = resolveTimeZone(timeZone);
  const parts = zonedParts(new Date(iso), zone);
  // Date.UTC normalises an out-of-range day (e.g. Jan 32 -> Feb 1) for us.
  const target = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, parts.second));
  const wall = target.getTime();

  // Solve for the instant whose local wall-clock reading in `zone` is
  // `wall`. One correction lands on the answer except when the guess and
  // the answer sit on opposite sides of a transition; a second settles it.
  // (A wall time skipped by a spring-forward gap has no exact instant --
  // this converges on the hour after the gap, which is the useful answer.)
  let ts = wall;
  for (let i = 0; i < 2; i += 1) {
    ts = wall - zoneOffsetMs(new Date(ts), zone);
  }
  return new Date(ts).toISOString();
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The calendar fields an instant reads as in `zone`. */
function zonedParts(date: Date, zone: string): ZonedParts {
  const fields = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)])
  ) as unknown as ZonedParts;
  return fields;
}

/** `zone`'s UTC offset in milliseconds at the given instant. */
function zoneOffsetMs(date: Date, zone: string): number {
  const p = zonedParts(date, zone);
  // Milliseconds are dropped by formatToParts, so compare against a
  // second-truncated instant rather than date.getTime() directly.
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
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

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/**
 * `{from, to}` for the 10-day cycle containing `date`: day 1-10, day 11-20,
 * or day 21-through-end-of-month (variable length -- 8 or 9 days in
 * February, 10 or 11 elsewhere depending on the month). Mirrors the
 * Postgres functions `public.cycle_start(d)`/`public.cycle_end(d)` exactly
 * -- same "both must agree" rule as {@link weekStart}.
 */
export function cycleBounds(date: Date): { from: string; to: string } {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const day = date.getUTCDate();
  const ymd = (d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  if (day <= 10) return { from: ymd(1), to: ymd(10) };
  if (day <= 20) return { from: ymd(11), to: ymd(20) };
  return { from: ymd(21), to: ymd(daysInMonth(y, m)) };
}

/**
 * The 10-day cycle immediately before the one containing `date` -- steps one
 * day before the current cycle's start and re-resolves, so a cycle at the
 * start of a month correctly lands on the previous month's third (variable-
 * length) chunk with no special-casing.
 */
export function previousCycleBounds(date: Date): { from: string; to: string } {
  const current = cycleBounds(date);
  return cycleBounds(new Date(addDays(current.from, -1) + 'T00:00:00Z'));
}

/** Compact day-in-month label, e.g. "Sep 18" -- for the cycle digest's
 * per-agent "last active" column, where formatDisplayDate's weekday prefix
 * would not fit the table cell. */
export function formatShortDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-CA', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * Human label for an inclusive cycle range, e.g. "Sep 11-20" -- for copy
 * that has to name *which* cycle it is reporting (the cycle digest email).
 * A cycle never crosses a month boundary (cycleBounds chunks within one
 * month), so the month is stated once; the cross-month form is spelled out
 * anyway rather than assuming it.
 */
export function formatCycleRange(from: string, to: string): string {
  const start = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  const month = (d: Date) => d.toLocaleDateString('en-CA', { month: 'short', timeZone: 'UTC' });
  const startMonth = month(start);
  const endMonth = month(end);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  return startMonth === endMonth
    ? `${startMonth} ${startDay}-${endDay}`
    : `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
}

/** The start date of the next 10-day cycle strictly after the one containing `iso`. */
export function nextCycleStart(iso: string): string {
  const current = cycleBounds(new Date(iso + 'T00:00:00Z'));
  return cycleBounds(new Date(addDays(current.to, 1) + 'T00:00:00Z')).from;
}

/**
 * Number of 10-day cycles spanned by an inclusive `[from, to]` range (e.g. a
 * 30-day month = 3, a 31-day month ≈ 3.1). Targets are only ever set
 * per-cycle (CLAUDE.md rule 8) — there is no monthly target concept in the
 * database — so any KPI target shown for a period longer than one cycle is
 * this multiplier applied to the per-cycle number, never a value the SMD
 * set directly. A cycle is 8-11 days depending on where it falls in the
 * month, so this divides by the nominal 10, same style of approximation.
 */
export function cyclesInRange(from: string, to: string): number {
  const start = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return days / 10;
}

export const PERIOD_PRESETS = [
  'current_cycle',
  'previous_cycle',
  'this_month',
  'last_30_days',
  'custom',
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

/**
 * Type guard for a raw URL search-param string. Centralized here since
 * every period-filter page needs the identical check before trusting
 * `params.period` as a {@link PeriodPreset}.
 */
export function isPeriodPreset(v: string | null | undefined): v is PeriodPreset {
  return !!v && (PERIOD_PRESETS as readonly string[]).includes(v);
}

/**
 * Resolves a period preset (plus optional custom bounds) to an inclusive
 * `{from, to}` ISO date range. Shared by `<FilterBar>` and every page that
 * reads it, so "Current Cycle" means exactly the same thing everywhere
 * (08-screen-specs.md).
 */
export function resolvePeriod(
  preset: PeriodPreset,
  asOf: string,
  customFrom?: string,
  customTo?: string
): { from: string; to: string } {
  switch (preset) {
    case 'current_cycle':
      return cycleBounds(new Date(asOf + 'T00:00:00Z'));
    case 'previous_cycle':
      return previousCycleBounds(new Date(asOf + 'T00:00:00Z'));
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

