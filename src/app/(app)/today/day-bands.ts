import type { DueItemKind } from './use-follow-up-actions';

/**
 * P25 Phase D-1 (F13): My Day's queue, banded by when a thing is due
 * rather than served as one flat list.
 *
 * Until D-1, `my_followups` refused to look past today, so the list could
 * only ever contain overdue and due-today items and "a flat list, most
 * overdue first" was a complete answer. The RPC now looks seven days
 * ahead, which makes a flat list actively misleading: next Friday's
 * appointment would sit in the same undifferentiated run as something
 * twelve days overdue, and the Next Up card would have labelled it
 * "Due today".
 *
 * All of this is derived at read time from `days_late` and
 * `appointment_at`, both of which the RPC already returns. There is no
 * stored band, no cron, and no new table -- which is why D-1 reverts by
 * reverting the deploy.
 */

/** The narrowest row shape banding needs. Widened structurally so callers
 *  can pass the full RPC row without mapping it first. */
export interface BandableItem {
  kind: DueItemKind;
  /** `p_as_of - greatest(due date, set_on)`. Negative means "in the
   *  future" -- see the D-1 migration header. */
  days_late: number;
  /** Present only for the two appointment kinds. */
  appointment_at: string | null;
}

export type BandId =
  | 'starting_soon'
  | 'needs_outcome'
  | 'overdue'
  | 'today'
  | 'tomorrow'
  | 'later';

/**
 * Display order, most urgent first.
 *
 * `starting_soon` outranks even a badly overdue item, per the plan's
 * "pinned at the top". An appointment forty minutes away is unmissable and
 * time-boxed; a follow-up twelve days overdue has waited twelve days and
 * can wait another forty minutes. Urgency here is "what stops being
 * possible soonest", not "what has been neglected longest".
 */
export const BAND_ORDER: readonly BandId[] = [
  'starting_soon',
  'needs_outcome',
  'overdue',
  'today',
  'tomorrow',
  'later',
] as const;

/** Only a real or legacy appointment can be "starting soon" or "need an
 *  outcome" -- a follow-up is a task with a date, not a commitment at a
 *  time. */
function isAppointmentKind(kind: DueItemKind): boolean {
  return kind === 'appointment' || kind === 'call_appointment';
}

/** How far ahead "starting soon" reaches. The plan's lead time for the
 *  T-2h push reminder (D-2), reused here so the band and the notification
 *  answer the same question. */
export const STARTING_SOON_MS = 2 * 60 * 60 * 1000;

/**
 * Which band a single row belongs in.
 *
 * `nowMs` is passed rather than read from the clock so this stays pure and
 * testable. It is evaluated once per render on the server: "starting soon"
 * is therefore accurate as of page load and does not tick over on its own,
 * which is the accepted cost of deriving the band at read time instead of
 * storing it.
 */
export function bandFor(item: BandableItem, nowMs: number): BandId {
  // Deliberately BEFORE the overdue checks. An appointment at 00:30
  // tomorrow, viewed at 23:00 tonight, is genuinely starting soon even
  // though its calendar day has not arrived (days_late === -1).
  if (isAppointmentKind(item.kind) && item.appointment_at && item.days_late <= 0) {
    const delta = new Date(item.appointment_at).getTime() - nowMs;
    if (delta >= 0 && delta < STARTING_SOON_MS) return 'starting_soon';
  }

  if (item.days_late > 0) {
    // The band that exists to stop stale appointments quietly shrinking
    // every outcome-based denominator (§1 F3/F10). An overdue follow-up is
    // late work; an overdue appointment is a missing FACT about something
    // that already happened, and the numbers are wrong until it is
    // recorded. Two different problems, two different bands.
    return isAppointmentKind(item.kind) ? 'needs_outcome' : 'overdue';
  }

  if (item.days_late === 0) return 'today';
  if (item.days_late === -1) return 'tomorrow';
  return 'later';
}

/** A row is actionable now if it is due today or already late. Everything
 *  else is advance notice. This is the rule behind both the "Due today" /
 *  "Overdue" tiles and the nav count badge. */
export function isDueNow(item: BandableItem): boolean {
  return item.days_late >= 0;
}

/** The nav badge count: unresolved items due today plus everything still
 *  needing an outcome. Forward-dated rows are advance notice and must not
 *  inflate a number the agent is meant to act on -- a badge that never
 *  reaches zero is decoration. */
export function dueNowCount(items: readonly BandableItem[]): number {
  return items.filter(isDueNow).length;
}

export interface BandedQueue<T extends BandableItem> {
  /** The single most urgent item, featured above the queue. Null when
   *  nothing is actionable yet, so the "nothing due today" empty state
   *  survives a queue that contains only future rows. */
  featured: T | null;
  /** Every other row, in band order. Bands with no rows are omitted. */
  bands: { id: BandId; items: T[] }[];
}

/**
 * Splits the queue into the featured item and the bands below it.
 *
 * The featured row is removed from its band rather than repeated, so a
 * band's count always describes what is actually rendered underneath it.
 * Input order is preserved within each band -- `my_followups` already
 * sorts by due date, then by slot -- so this never re-ranks, it only
 * groups.
 */
export function bandQueue<T extends BandableItem>(items: readonly T[], nowMs: number): BandedQueue<T> {
  const byBand = new Map<BandId, T[]>();
  for (const item of items) {
    const id = bandFor(item, nowMs);
    const bucket = byBand.get(id);
    if (bucket) bucket.push(item);
    else byBand.set(id, [item]);
  }

  // Pick the featured row from the most urgent band that has one, but only
  // among bands that are actionable now -- a "tomorrow" row must never be
  // promoted into a card whose whole purpose is "do this next".
  let featured: T | null = null;
  for (const id of BAND_ORDER) {
    if (id === 'tomorrow' || id === 'later') break;
    const bucket = byBand.get(id);
    if (bucket && bucket.length > 0) {
      featured = bucket.shift()!;
      if (bucket.length === 0) byBand.delete(id);
      break;
    }
  }

  const bands = BAND_ORDER.flatMap((id) => {
    const items = byBand.get(id);
    return items && items.length > 0 ? [{ id, items }] : [];
  });

  return { featured, bands };
}
