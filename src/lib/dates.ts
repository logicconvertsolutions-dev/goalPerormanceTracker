// Week math lives here and only here (CLAUDE.md rule). Mirrors the
// Postgres function public.week_start(date) exactly — both must agree, or a
// client-computed week boundary will disagree with the RPCs that use it.

/** Monday-start week boundary for the given date, as a YYYY-MM-DD string. */
export function weekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // 1=Mon..7=Sun
  d.setUTCDate(d.getUTCDate() - (isoDow - 1));
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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

/** Formats a timestamptz as a UTC time (e.g. "10:30 AM"). The app has no client-side
 * timezone conversion yet (dates elsewhere are UTC-rendered too), so this stays UTC
 * for consistency rather than silently guessing the viewer's zone. */
export function formatDisplayTime(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
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

