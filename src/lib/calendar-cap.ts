import type { CalendarItem } from './calendar';

/** How many to-dos a single calendar day shows before "+N more" (P31). */
export const TODOS_PER_DAY = 3;

/**
 * Caps each day's to-dos so a long list doesn't flood the calendar. Per day,
 * open to-dos come before done ones, then the earliest-created first; the
 * rest are dropped and counted. Appointments, follow-ups and reminders are
 * never capped. Order of the kept items is unchanged.
 */
export function capTodosPerDay(
  items: CalendarItem[],
  max: number = TODOS_PER_DAY
): { items: CalendarItem[]; hiddenTodos: Map<string, number> } {
  const todosByDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    if (item.kind !== 'todo') continue;
    const list = todosByDay.get(item.date) ?? [];
    list.push(item);
    todosByDay.set(item.date, list);
  }

  const keep = new Set<CalendarItem>();
  const hiddenTodos = new Map<string, number>();
  for (const [day, todos] of todosByDay) {
    const ranked = [...todos].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (a.createdAt ?? '') < (b.createdAt ?? '') ? -1 : (a.createdAt ?? '') > (b.createdAt ?? '') ? 1 : 0;
    });
    ranked.slice(0, max).forEach((t) => keep.add(t));
    if (ranked.length > max) hiddenTodos.set(day, ranked.length - max);
  }

  return { items: items.filter((i) => i.kind !== 'todo' || keep.has(i)), hiddenTodos };
}
