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

