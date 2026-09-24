// P31 My Day follow-ups: the per-day to-do cap on the calendar, the zoned
// time helper the edit dialogs use, and the new input schemas.
import { describe, expect, it } from 'vitest';
import { capTodosPerDay } from './calendar-cap';
import type { CalendarItem } from './calendar';
import { isoToTimeInZone, zonedDateTimeToIso } from './dates';
import { calendarQuerySchema, updateReminderSchema, updateTaskSchema } from '@/app/(app)/today/planner-schemas';

const ID = '00000000-0000-4000-8000-000000000031';

function item(partial: Partial<CalendarItem> & Pick<CalendarItem, 'id' | 'kind' | 'date'>): CalendarItem {
  return { title: partial.id, subtitle: null, startsAt: null, done: false, href: null, createdAt: null, ...partial };
}

describe('capTodosPerDay', () => {
  it('keeps the 3 earliest-created open to-dos per day and counts the rest', () => {
    const todos = Array.from({ length: 10 }, (_, i) =>
      item({ id: `t${i}`, kind: 'todo', date: '2026-09-24', createdAt: `2026-09-20T10:0${9 - i}:00Z` })
    );
    const { items, hiddenTodos } = capTodosPerDay(todos);
    expect(items.map((i) => i.id)).toEqual(['t7', 't8', 't9']);
    expect(hiddenTodos.get('2026-09-24')).toBe(7);
  });

  it('ranks open to-dos before done ones', () => {
    const { items } = capTodosPerDay(
      [
        item({ id: 'done-old', kind: 'todo', date: '2026-09-24', done: true, createdAt: '2026-09-01T00:00:00Z' }),
        item({ id: 'open-new', kind: 'todo', date: '2026-09-24', createdAt: '2026-09-23T00:00:00Z' }),
      ],
      1
    );
    expect(items.map((i) => i.id)).toEqual(['open-new']);
  });

  it('never caps appointments, follow-ups or reminders, and caps each day separately', () => {
    const { items, hiddenTodos } = capTodosPerDay(
      [
        ...Array.from({ length: 5 }, (_, i) => item({ id: `a${i}`, kind: 'appointment', date: '2026-09-24' })),
        item({ id: 'x1', kind: 'todo', date: '2026-09-24', createdAt: '1' }),
        item({ id: 'x2', kind: 'todo', date: '2026-09-24', createdAt: '2' }),
        item({ id: 'y1', kind: 'todo', date: '2026-09-25', createdAt: '1' }),
      ],
      1
    );
    expect(items.filter((i) => i.kind === 'appointment')).toHaveLength(5);
    expect(items.filter((i) => i.kind === 'todo').map((i) => i.id)).toEqual(['x1', 'y1']);
    expect(hiddenTodos.get('2026-09-24')).toBe(1);
    expect(hiddenTodos.has('2026-09-25')).toBe(false);
  });
});

describe('isoToTimeInZone', () => {
  it('round-trips with zonedDateTimeToIso', () => {
    for (const time of ['00:05', '09:30', '13:00', '23:59']) {
      const iso = zonedDateTimeToIso('2026-09-24', time, 'America/Toronto');
      expect(isoToTimeInZone(iso, 'America/Toronto')).toBe(time);
    }
  });
});

describe('P31 schemas', () => {
  it('updateTaskSchema accepts a future day with or without a time', () => {
    expect(
      updateTaskSchema.safeParse({ id: ID, title: 'Call Priya', kind: 'call', dueOn: '2026-10-02', dueTime: '14:30' })
        .success
    ).toBe(true);
    expect(
      updateTaskSchema.safeParse({ id: ID, title: 'Prep', kind: 'task', dueOn: '2026-10-02', dueTime: '' }).success
    ).toBe(true);
    expect(updateTaskSchema.safeParse({ id: 'nope', title: 'x', kind: 'task', dueOn: '2026-10-02' }).success).toBe(
      false
    );
  });

  it('updateReminderSchema needs an id on top of the create fields', () => {
    const base = { title: 'Send proposal', date: '2026-10-02', time: '09:00', leadMinutes: 15, push: true };
    expect(updateReminderSchema.safeParse(base).success).toBe(false);
    expect(updateReminderSchema.safeParse({ ...base, id: ID }).success).toBe(true);
  });

  it('calendarQuerySchema only takes a known view and a real date', () => {
    expect(calendarQuerySchema.safeParse({ view: 'week', date: '2026-09-24' }).success).toBe(true);
    expect(calendarQuerySchema.safeParse({ view: 'year', date: '2026-09-24' }).success).toBe(false);
    expect(calendarQuerySchema.safeParse({ view: 'day', date: '2026-02-30' }).success).toBe(false);
  });
});
