// P30 My Day helpers: calendar ranges, zoned time conversion, greeting,
// daily quote, push payload shaping, and the To Do / Reminder input schemas.
import { describe, expect, it } from 'vitest';
import {
  calendarRange,
  dayStripDates,
  hourInZone,
  isCalendarView,
  isIsoDate,
  minutesIntoDayInZone,
  monthGridDates,
  stepCalendarDate,
  weekDates,
  zonedDateTimeToIso,
} from './dates';
import { firstName, greetingFor } from './greeting';
import { QUOTES, quoteForDate } from './quotes';
import { toPushPayload } from './push/payload';
import { createReminderSchema, createTaskSchema } from '@/app/(app)/today/planner-schemas';

describe('calendar ranges', () => {
  it('weekDates is Monday..Sunday around the date', () => {
    // 2026-09-23 is a Wednesday.
    expect(weekDates('2026-09-23')).toEqual([
      '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27',
    ]);
    // A Sunday belongs to the week that started the Monday before.
    expect(weekDates('2026-09-27')[0]).toBe('2026-09-21');
  });

  it('monthGridDates pads to whole Monday-start weeks', () => {
    const grid = monthGridDates('2026-09-15');
    expect(grid[0]).toBe('2026-08-31'); // Sep 1 2026 is a Tuesday
    expect(grid[grid.length - 1]).toBe('2026-10-04'); // Sep 30 is a Wednesday
    expect(grid.length % 7).toBe(0);
  });

  it('dayStripDates covers the week before, of and after', () => {
    const strip = dayStripDates('2026-09-23');
    expect(strip).toHaveLength(21);
    expect(strip[0]).toBe('2026-09-14');
    expect(strip[20]).toBe('2026-10-04');
  });

  it('calendarRange spans exactly what each view draws', () => {
    expect(calendarRange('day', '2026-09-23')).toEqual({ from: '2026-09-14', to: '2026-10-04' });
    expect(calendarRange('week', '2026-09-23')).toEqual({ from: '2026-09-21', to: '2026-09-27' });
    expect(calendarRange('month', '2026-09-23')).toEqual({ from: '2026-08-31', to: '2026-10-04' });
  });

  it('stepCalendarDate moves one day, week or month and clamps month-ends', () => {
    expect(stepCalendarDate('day', '2026-09-30', 1)).toBe('2026-10-01');
    expect(stepCalendarDate('week', '2026-09-23', -1)).toBe('2026-09-16');
    expect(stepCalendarDate('month', '2026-01-31', 1)).toBe('2026-02-28');
    expect(stepCalendarDate('month', '2026-03-15', -1)).toBe('2026-02-15');
  });

  it('validates URL params', () => {
    expect(isCalendarView('week')).toBe(true);
    expect(isCalendarView('year')).toBe(false);
    expect(isCalendarView(undefined)).toBe(false);
    expect(isIsoDate('2026-09-23')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('23/09/2026')).toBe(false);
  });
});

describe('zoned time', () => {
  it('zonedDateTimeToIso resolves a local wall time to the right instant', () => {
    // Toronto is UTC-4 in September (EDT).
    expect(zonedDateTimeToIso('2026-09-23', '09:30', 'America/Toronto')).toBe('2026-09-23T13:30:00.000Z');
    // Kolkata is UTC+5:30, no DST.
    expect(zonedDateTimeToIso('2026-09-23', '09:30', 'Asia/Kolkata')).toBe('2026-09-23T04:00:00.000Z');
  });

  it('zonedDateTimeToIso handles a DST switch day', () => {
    // US clocks fall back on 2026-11-01; 9 AM that day is EST (UTC-5).
    expect(zonedDateTimeToIso('2026-11-01', '09:00', 'America/New_York')).toBe('2026-11-01T14:00:00.000Z');
  });

  it('minutesIntoDayInZone and hourInZone read the local clock', () => {
    expect(minutesIntoDayInZone('2026-09-23T13:30:00Z', 'America/Toronto')).toBe(9 * 60 + 30);
    expect(hourInZone(new Date('2026-09-23T13:30:00Z'), 'America/Toronto')).toBe(9);
  });
});

describe('greeting', () => {
  it('picks the greeting from the agent’s local hour', () => {
    const at = (iso: string) => new Date(iso);
    expect(greetingFor(at('2026-09-23T13:00:00Z'), 'America/Toronto')).toBe('Good morning'); // 9 AM
    expect(greetingFor(at('2026-09-23T18:00:00Z'), 'America/Toronto')).toBe('Good afternoon'); // 2 PM
    expect(greetingFor(at('2026-09-23T23:00:00Z'), 'America/Toronto')).toBe('Good evening'); // 7 PM
  });

  it('uses the first name', () => {
    expect(firstName('Deepak Rao')).toBe('Deepak');
    expect(firstName('  Ganga  ')).toBe('Ganga');
    expect(firstName('')).toBe('there');
    expect(firstName(null)).toBe('there');
  });
});

describe('quoteForDate', () => {
  it('is stable within a day and changes the next day', () => {
    expect(quoteForDate('2026-09-23')).toBe(quoteForDate('2026-09-23'));
    expect(quoteForDate('2026-09-23')).not.toBe(quoteForDate('2026-09-24'));
  });

  it('cycles through every quote', () => {
    const seen = new Set<string>();
    for (let i = 0; i < QUOTES.length; i += 1) {
      const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      seen.add(quoteForDate(day).text);
    }
    expect(seen.size).toBe(QUOTES.length);
  });
});

describe('toPushPayload', () => {
  it('keeps in-app links and falls back to My Day', () => {
    const base = { id: 'n1', kind: 'reminder', title: 'Send proposal', body: 'Reminder for 4:00 PM' };
    expect(toPushPayload({ ...base, link: '/appointments' }).url).toBe('/appointments');
    expect(toPushPayload({ ...base, link: 'https://evil.example' }).url).toBe('/today');
    expect(toPushPayload({ ...base, link: '//evil.example' }).url).toBe('/today');
    expect(toPushPayload({ ...base, link: null }).tag).toBe('reminder:n1');
  });

  it('clips long text', () => {
    const p = toPushPayload({ id: 'n2', kind: 'reminder', title: 'x'.repeat(500), body: 'y'.repeat(900), link: null });
    expect(p.title.length).toBeLessThanOrEqual(120);
    expect(p.body.length).toBeLessThanOrEqual(300);
  });
});

describe('planner schemas', () => {
  it('accepts a quick task and trims the title', () => {
    const r = createTaskSchema.safeParse({ title: '  Call Ganga  ', dueOn: '2026-09-23', dueTime: '' });
    expect(r.success && r.data.title).toBe('Call Ganga');
    expect(r.success && r.data.kind).toBe('task');
  });

  it('rejects bad task input', () => {
    expect(createTaskSchema.safeParse({ title: '   ', dueOn: '2026-09-23' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'x', dueOn: '2026-02-30' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'x', dueOn: '2026-09-23', dueTime: '25:00' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'x', dueOn: '2026-09-23', kind: 'party' }).success).toBe(false);
  });

  it('only allows the offered reminder lead times', () => {
    const ok = { title: 'Send proposal', date: '2026-09-23', time: '16:00', leadMinutes: 15, push: true };
    expect(createReminderSchema.safeParse(ok).success).toBe(true);
    expect(createReminderSchema.safeParse({ ...ok, leadMinutes: 7 }).success).toBe(false);
    expect(createReminderSchema.safeParse({ ...ok, time: '' }).success).toBe(false);
  });
});
