// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bandFor, bandQueue, dueNowCount, isDueNow, BAND_ORDER, type BandableItem } from './day-bands';
import type { DueItemKind } from './use-follow-up-actions';

// 2026-09-21 14:00 UTC. Every appointment_at below is expressed as an
// offset from this instant so the intent reads without mental arithmetic.
const NOW = new Date('2026-09-21T14:00:00.000Z').getTime();
const inHours = (h: number) => new Date(NOW + h * 60 * 60 * 1000).toISOString();

function item(over: Partial<BandableItem> & { kind?: DueItemKind } = {}): BandableItem {
  return { kind: 'appointment', days_late: 0, appointment_at: null, ...over };
}

describe('bandFor', () => {
  it('bands an overdue appointment as needs_outcome, not overdue', () => {
    // The distinction that matters: a pending past appointment is a
    // MISSING FACT, and every outcome-based rate is computed without it
    // until it is recorded.
    expect(bandFor(item({ kind: 'appointment', days_late: 3 }), NOW)).toBe('needs_outcome');
    expect(bandFor(item({ kind: 'call_appointment', days_late: 1 }), NOW)).toBe('needs_outcome');
  });

  it('bands an overdue follow-up as overdue', () => {
    expect(bandFor(item({ kind: 'follow_up', days_late: 3 }), NOW)).toBe('overdue');
    expect(bandFor(item({ kind: 'appointment_follow_up', days_late: 12 }), NOW)).toBe('overdue');
  });

  it('bands by relative day when nothing is late', () => {
    expect(bandFor(item({ days_late: 0 }), NOW)).toBe('today');
    expect(bandFor(item({ days_late: -1 }), NOW)).toBe('tomorrow');
    expect(bandFor(item({ days_late: -2 }), NOW)).toBe('later');
    expect(bandFor(item({ days_late: -7 }), NOW)).toBe('later');
  });

  it('pins an appointment inside the next two hours to starting_soon', () => {
    expect(bandFor(item({ days_late: 0, appointment_at: inHours(1.5) }), NOW)).toBe('starting_soon');
  });

  it('excludes an appointment beyond the two-hour window', () => {
    expect(bandFor(item({ days_late: 0, appointment_at: inHours(2.5) }), NOW)).toBe('today');
  });

  it('treats the two-hour edge as exclusive and "now" as inclusive', () => {
    expect(bandFor(item({ days_late: 0, appointment_at: inHours(2) }), NOW)).toBe('today');
    expect(bandFor(item({ days_late: 0, appointment_at: inHours(0) }), NOW)).toBe('starting_soon');
  });

  it('does not call an appointment that has already started "starting soon"', () => {
    // A 2pm appointment at 4pm stays under "today" rather than jumping to
    // a band that says it is about to begin. Same call C2's Upcoming
    // section makes: it is not overdue at 2:01 either.
    expect(bandFor(item({ days_late: 0, appointment_at: inHours(-2) }), NOW)).toBe('today');
  });

  it('catches an appointment just after local midnight while it is still yesterday', () => {
    // 23:00 now, appointment at 00:30 -- days_late is -1 because the
    // calendar day has not turned, but it genuinely starts in 90 minutes.
    expect(bandFor(item({ days_late: -1, appointment_at: inHours(1.5) }), NOW)).toBe('starting_soon');
  });

  it('never calls a follow-up "starting soon" even if it somehow carries a slot', () => {
    // A follow-up is a task with a date, not a commitment at a time.
    expect(bandFor(item({ kind: 'follow_up', days_late: 0, appointment_at: inHours(1) }), NOW)).toBe('today');
  });

  it('never promotes an already-late appointment into starting_soon', () => {
    expect(bandFor(item({ days_late: 2, appointment_at: inHours(1) }), NOW)).toBe('needs_outcome');
  });
});

describe('isDueNow / dueNowCount', () => {
  it('counts overdue and due-today items only', () => {
    const rows = [
      item({ days_late: 5 }),
      item({ days_late: 0 }),
      item({ days_late: -1 }),
      item({ days_late: -6 }),
    ];
    expect(rows.map(isDueNow)).toEqual([true, true, false, false]);
    expect(dueNowCount(rows)).toBe(2);
  });

  it('is zero for a queue containing only future rows', () => {
    // The property that keeps the nav badge honest: a badge that can never
    // reach zero is decoration, not a call to action.
    expect(dueNowCount([item({ days_late: -1 }), item({ days_late: -3 })])).toBe(0);
  });
});

describe('bandQueue', () => {
  it('features the most urgent actionable row and removes it from its band', () => {
    const rows = [
      item({ kind: 'follow_up', days_late: 9 }),
      item({ kind: 'follow_up', days_late: 2 }),
      item({ days_late: 0 }),
    ];
    const { featured, bands } = bandQueue(rows, NOW);
    expect(featured).toBe(rows[0]);
    expect(bands.find((b) => b.id === 'overdue')!.items).toEqual([rows[1]]);
    expect(bands.find((b) => b.id === 'today')!.items).toEqual([rows[2]]);
  });

  it('features a starting-soon appointment over a badly overdue follow-up', () => {
    const soon = item({ days_late: 0, appointment_at: inHours(0.5) });
    const stale = item({ kind: 'follow_up', days_late: 40 });
    expect(bandQueue([stale, soon], NOW).featured).toBe(soon);
  });

  it('features nothing when the queue holds only future rows', () => {
    // This is what preserves the "nothing due today" empty state. Before
    // D-1 the queue could not contain a future row at all, so the page
    // treated "queue is non-empty" as "something is due" -- widening the
    // window without this would have put next Friday's appointment in a
    // card badged "Due today".
    const rows = [item({ days_late: -1 }), item({ days_late: -4 })];
    const { featured, bands } = bandQueue(rows, NOW);
    expect(featured).toBeNull();
    expect(bands.map((b) => b.id)).toEqual(['tomorrow', 'later']);
    expect(bands.flatMap((b) => b.items)).toHaveLength(2);
  });

  it('omits empty bands and emits the rest in urgency order', () => {
    const rows = [
      item({ days_late: -3 }),
      item({ kind: 'follow_up', days_late: 4 }),
      item({ days_late: 6 }),
      item({ days_late: 0, appointment_at: inHours(1) }),
      item({ days_late: -1 }),
    ];
    const { bands } = bandQueue(rows, NOW);
    // starting_soon supplies the featured row and is emptied by it.
    expect(bands.map((b) => b.id)).toEqual(['needs_outcome', 'overdue', 'tomorrow', 'later']);
    expect(bands.map((b) => b.id)).toEqual(
      BAND_ORDER.filter((id) => bands.some((b) => b.id === id))
    );
  });

  it('never drops or duplicates a row', () => {
    const rows = [
      item({ days_late: 3 }),
      item({ kind: 'follow_up', days_late: 3 }),
      item({ days_late: 0 }),
      item({ days_late: 0, appointment_at: inHours(1) }),
      item({ days_late: -1 }),
      item({ days_late: -5 }),
    ];
    const { featured, bands } = bandQueue(rows, NOW);
    const seen = [...(featured ? [featured] : []), ...bands.flatMap((b) => b.items)];
    expect(seen).toHaveLength(rows.length);
    expect(new Set(seen).size).toBe(rows.length);
  });

  it('returns an empty result for an empty queue', () => {
    expect(bandQueue([], NOW)).toEqual({ featured: null, bands: [] });
  });
});
