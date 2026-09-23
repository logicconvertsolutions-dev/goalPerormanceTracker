'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Bell, CalendarDays, ChevronLeft, ChevronRight, ListChecks, Phone, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CalendarItem, CalendarItemKind } from '@/lib/calendar';
import {
  CALENDAR_VIEWS,
  dayStripDates,
  formatDisplayTime,
  formatMonthYear,
  formatShortDate,
  minutesIntoDayInZone,
  monthGridDates,
  stepCalendarDate,
  weekDates,
  type CalendarView,
} from '@/lib/dates';

// My Day calendar (P30). View + date live in the URL (?view=&date=), same as
// every other filter in the app, so back/forward and refresh keep your place.

const KIND_META: Record<CalendarItemKind, { label: string; icon: LucideIcon; chip: string; dot: string }> = {
  appointment: { label: 'Appointment', icon: Users, chip: 'bg-acc-dim border-acc text-acc', dot: 'bg-acc' },
  follow_up: {
    label: 'Follow-up',
    icon: Phone,
    chip: 'bg-[#2a78d6]/10 border-[#2a78d6] text-[#1f5fae]',
    dot: 'bg-[#2a78d6]',
  },
  todo: { label: 'To do', icon: ListChecks, chip: 'bg-ok-dim border-ok text-ok', dot: 'bg-ok' },
  reminder: { label: 'Reminder', icon: Bell, chip: 'bg-warn-dim border-warn text-warn', dot: 'bg-warn' },
};

const VIEW_LABEL: Record<CalendarView, string> = { day: 'Day', week: 'Week', month: 'Month' };
const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21;

function href(view: CalendarView, date: string) {
  return `/today?view=${view}&date=${date}`;
}

function dayNumber(iso: string) {
  return Number(iso.slice(8, 10));
}

function weekdayShort(iso: string) {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay(); // 0 = Sun
  return WEEKDAY_SHORT[(dow + 6) % 7];
}

function byDate(items: CalendarItem[]) {
  const map = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const list = map.get(item.date) ?? [];
    list.push(item);
    map.set(item.date, list);
  }
  return map;
}

/** Hour span to draw: the working day, widened to fit anything outside it. */
function hourSpan(items: CalendarItem[], timeZone: string | null) {
  let start = DAY_START_HOUR;
  let end = DAY_END_HOUR;
  for (const item of items) {
    if (!item.startsAt) continue;
    const h = Math.floor(minutesIntoDayInZone(item.startsAt, timeZone) / 60);
    start = Math.min(start, h);
    end = Math.max(end, h + 1);
  }
  return { start, end };
}

export function CalendarCard({
  items,
  view,
  date,
  today,
  nowIso,
  timeZone,
}: {
  items: CalendarItem[];
  view: CalendarView;
  date: string;
  today: string;
  nowIso: string;
  timeZone: string | null;
}) {
  const grouped = byDate(items);
  const title =
    view === 'week'
      ? `${formatShortDate(weekDates(date)[0])} – ${formatShortDate(weekDates(date)[6])}`
      : formatMonthYear(date);

  return (
    <section className="rounded-lg border border-line bg-panel p-4 shadow-card" aria-label="Calendar">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[17px] font-bold text-fg">
          <CalendarDays className="h-[18px] w-[18px]" aria-hidden="true" />
          Calendar
        </h2>
        <nav className="flex rounded-sm bg-sunken p-[3px]" aria-label="Calendar view">
          {CALENDAR_VIEWS.map((v) => (
            <Link
              key={v}
              href={href(v, date)}
              scroll={false}
              aria-current={v === view ? 'page' : undefined}
              className={cn(
                'rounded-[8px] px-3 py-1.5 text-xs font-bold text-fg-2 transition-smooth',
                v === view ? 'bg-acc text-white' : 'hover:text-fg'
              )}
            >
              {VIEW_LABEL[v]}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-fg">{title}</p>
        <div className="flex items-center gap-1.5">
          {date !== today && (
            <Link
              href={href(view, today)}
              scroll={false}
              className="flex h-8 items-center rounded-sm border border-line px-2.5 text-xs font-bold text-acc hover:bg-hover"
            >
              Today
            </Link>
          )}
          <Link
            href={href(view, stepCalendarDate(view, date, -1))}
            scroll={false}
            aria-label={`Previous ${view}`}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-line text-fg-2 hover:bg-hover"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link
            href={href(view, stepCalendarDate(view, date, 1))}
            scroll={false}
            aria-label={`Next ${view}`}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-line text-fg-2 hover:bg-hover"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="mt-3">
        {view === 'day' && (
          <DayView grouped={grouped} date={date} today={today} nowIso={nowIso} timeZone={timeZone} />
        )}
        {view === 'week' && (
          <WeekView grouped={grouped} date={date} today={today} nowIso={nowIso} timeZone={timeZone} />
        )}
        {view === 'month' && <MonthView grouped={grouped} date={date} today={today} timeZone={timeZone} />}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] font-semibold text-fg-2">
        {(Object.keys(KIND_META) as CalendarItemKind[]).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', KIND_META[k].dot)} aria-hidden="true" />
            {KIND_META[k].label}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Dots({ items, light }: { items: CalendarItem[] | undefined; light?: boolean }) {
  const kinds = Array.from(new Set((items ?? []).map((i) => i.kind))).slice(0, 3);
  return (
    <span className="mt-1 flex h-[5px] justify-center gap-0.5" aria-hidden="true">
      {kinds.map((k) => (
        <span
          key={k}
          className={cn('h-[5px] w-[5px] rounded-full', light && k === 'appointment' ? 'bg-white' : KIND_META[k].dot)}
        />
      ))}
    </span>
  );
}

function EventChip({ item, timeZone }: { item: CalendarItem; timeZone: string | null }) {
  const meta = KIND_META[item.kind];
  const Icon = meta.icon;
  const time = item.startsAt ? formatDisplayTime(item.startsAt, timeZone) : 'All day';
  const body = (
    <>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-white/80">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[13px] font-bold text-fg', item.done && 'text-fg-3 line-through')}>
          {meta.label} · {item.title}
        </span>
        <span className="block truncate text-[11.5px] text-fg-2">{time}</span>
      </span>
      {item.href && <ChevronRight className="h-4 w-4 shrink-0 text-fg-3" aria-hidden="true" />}
    </>
  );
  const className = cn('flex items-center gap-2.5 rounded-sm border-l-[3px] px-2.5 py-2', meta.chip);
  return item.href ? (
    <Link href={item.href} className={cn(className, 'hover:brightness-95')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

// ---------------------------------------------------------------------------
// Day
// ---------------------------------------------------------------------------

function DayView({
  grouped,
  date,
  today,
  nowIso,
  timeZone,
}: {
  grouped: Map<string, CalendarItem[]>;
  date: string;
  today: string;
  nowIso: string;
  timeZone: string | null;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const dayItems = grouped.get(date) ?? [];
  const allDay = dayItems.filter((i) => !i.startsAt);
  const timed = dayItems.filter((i) => i.startsAt);
  const { start, end } = hourSpan(timed, timeZone);
  const isToday = date === today;
  const nowMinutes = minutesIntoDayInZone(nowIso, timeZone);
  const nowHour = Math.floor(nowMinutes / 60);
  const firstStart = timed[0]?.startsAt ?? null;

  // Keep the selected day in view in the strip, and open the timeline at
  // "now" (today) or the first event (any other day).
  useEffect(() => {
    stripRef.current?.querySelector('[aria-current="date"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    const timeline = timelineRef.current;
    if (!timeline) return;
    const firstHour = isToday
      ? Math.max(start, nowHour - 1)
      : firstStart
        ? Math.floor(minutesIntoDayInZone(firstStart, timeZone) / 60)
        : start;
    const row = timeline.querySelector<HTMLElement>(`[data-hour="${firstHour}"]`);
    timeline.scrollTop = row ? row.offsetTop - 4 : 0;
    // Only when the day changes -- not on every refresh after ticking a to-do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const hours = Array.from({ length: end - start }, (_, i) => start + i);

  return (
    <div>
      <div className="relative -mx-4">
        <div ref={stripRef} className="flex snap-x gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {dayStripDates(date).map((d) => {
            const selected = d === date;
            return (
              <Link
                key={d}
                href={href('day', d)}
                scroll={false}
                aria-current={selected ? 'date' : undefined}
                aria-label={`${weekdayShort(d)} ${formatShortDate(d)}`}
                className={cn(
                  'flex w-[42px] shrink-0 snap-center flex-col items-center rounded-sm py-1.5',
                  selected ? 'bg-acc text-white' : 'hover:bg-hover',
                  d === today && !selected && 'ring-1 ring-inset ring-acc-line'
                )}
              >
                <span className={cn('text-[10.5px] font-bold uppercase', selected ? 'text-white/70' : 'text-fg-3')}>
                  {weekdayShort(d)}
                </span>
                <span className="text-[15px] font-bold leading-5">{dayNumber(d)}</span>
                <Dots items={grouped.get(d)} light={selected} />
              </Link>
            );
          })}
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-panel to-transparent"
          aria-hidden="true"
        />
      </div>

      {allDay.length > 0 && (
        <div className="mt-2 space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-fg-3">All day</p>
          {allDay.map((item) => (
            <EventChip key={`${item.kind}-${item.id}`} item={item} timeZone={timeZone} />
          ))}
        </div>
      )}

      <div className="relative mt-2 border-y border-line">
        <div ref={timelineRef} className="h-[300px] overflow-y-auto pr-1" tabIndex={0} aria-label="Day timeline">
          {hours.map((h) => {
            const inHour = timed.filter((i) => Math.floor(minutesIntoDayInZone(i.startsAt!, timeZone) / 60) === h);
            const showNow = isToday && h === nowHour;
            const before = showNow
              ? inHour.filter((i) => minutesIntoDayInZone(i.startsAt!, timeZone) <= nowMinutes)
              : inHour;
            const after = showNow ? inHour.filter((i) => !before.includes(i)) : [];
            return (
              <div key={h} data-hour={h} className="grid min-h-[48px] grid-cols-[44px_1fr] items-start">
                <span className="pt-1.5 text-[11px] font-semibold text-fg-3">{hourLabel(h)}</span>
                <div className="min-w-0 space-y-1 border-t border-dashed border-line py-1">
                  {before.map((item) => (
                    <EventChip key={`${item.kind}-${item.id}`} item={item} timeZone={timeZone} />
                  ))}
                  {showNow && (
                    <div className="relative my-1 h-0.5 bg-bad" aria-label="Now">
                      <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-bad" />
                    </div>
                  )}
                  {after.map((item) => (
                    <EventChip key={`${item.kind}-${item.id}`} item={item} timeZone={timeZone} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-panel to-transparent"
          aria-hidden="true"
        />
      </div>

      {dayItems.length === 0 && (
        <p className="mt-2 text-sm text-fg-3">Nothing scheduled. Add a to-do or reminder below.</p>
      )}
    </div>
  );
}

function hourLabel(h: number) {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

// ---------------------------------------------------------------------------
// Week
// ---------------------------------------------------------------------------

const WEEK_ROW_PX = 44;
const WEEK_BLOCK_PX = 22;

/** Places a day's timed items in the week grid. Items whose blocks would
 * overlap share the column side by side (up to 3 lanes) instead of stacking
 * on top of each other. */
function layoutWeekColumn(items: CalendarItem[], startHour: number, timeZone: string | null) {
  const placed = items
    .filter((i) => i.startsAt)
    .map((item) => ({
      item,
      top: ((minutesIntoDayInZone(item.startsAt!, timeZone) - startHour * 60) / 60) * WEEK_ROW_PX,
      lane: 0,
      lanes: 1,
    }))
    .sort((a, b) => a.top - b.top);

  let group: typeof placed = [];
  const flush = () => {
    const lanes = Math.min(3, group.length);
    group.forEach((p, i) => {
      p.lane = i % lanes;
      p.lanes = lanes;
    });
    group = [];
  };
  for (const p of placed) {
    if (group.length && p.top >= group[group.length - 1].top + WEEK_BLOCK_PX) flush();
    group.push(p);
  }
  flush();
  return placed;
}

function WeekView({
  grouped,
  date,
  today,
  nowIso,
  timeZone,
}: {
  grouped: Map<string, CalendarItem[]>;
  date: string;
  today: string;
  nowIso: string;
  timeZone: string | null;
}) {
  const hourNow = Math.floor(minutesIntoDayInZone(nowIso, timeZone) / 60);
  const days = weekDates(date);
  const all = days.flatMap((d) => grouped.get(d) ?? []);
  const { start, end } = hourSpan(all, timeZone);
  const hours = Array.from({ length: end - start }, (_, i) => start + i);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // This week: open at the current hour. Other weeks: the earliest timed item.
    const timedHours = all
      .filter((i) => i.startsAt)
      .map((i) => Math.floor(minutesIntoDayInZone(i.startsAt!, timeZone) / 60));
    const h = days.includes(today)
      ? Math.max(start, hourNow - 1)
      : timedHours.length
        ? Math.min(...timedHours)
        : start;
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (h - start) * WEEK_ROW_PX - 4);
    // Only when the week changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0]]);

  return (
    <div>
      <div className="grid grid-cols-[32px_repeat(7,1fr)] text-center">
        <span />
        {days.map((d) => (
          <Link key={d} href={href('day', d)} scroll={false} className="rounded-sm py-1 hover:bg-hover">
            <span className="block text-[10px] font-bold uppercase text-fg-3">{weekdayShort(d)}</span>
            <span
              className={cn(
                'mx-auto mt-0.5 block w-6 rounded-[7px] text-[13px] font-bold',
                d === today ? 'bg-acc text-white' : 'text-fg'
              )}
            >
              {dayNumber(d)}
            </span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-[32px_repeat(7,1fr)] border-t border-line py-1 text-center">
        <span className="text-[9.5px] font-semibold leading-5 text-fg-3">All</span>
        {days.map((d) => {
          const n = (grouped.get(d) ?? []).filter((i) => !i.startsAt).length;
          return (
            <span key={d} className="text-[10px] font-bold leading-5 text-[#1f5fae]">
              {n > 0 ? n : ''}
            </span>
          );
        })}
      </div>

      <div className="relative border-y border-line">
        <div ref={scrollRef} className="h-[260px] overflow-y-auto" tabIndex={0} aria-label="Week timeline">
          <div className="relative grid grid-cols-[32px_repeat(7,1fr)]">
            <div>
              {hours.map((h) => (
                <div key={h} style={{ height: WEEK_ROW_PX }} className="text-[9.5px] font-semibold text-fg-3">
                  {hourLabel(h).replace(' ', '')}
                </div>
              ))}
            </div>
            {days.map((d) => (
              <div key={d} className="relative border-l border-line/60">
                {hours.map((h) => (
                  <div key={h} style={{ height: WEEK_ROW_PX }} className="border-t border-dashed border-line" />
                ))}
                {layoutWeekColumn(grouped.get(d) ?? [], start, timeZone).map(({ item, top, lane, lanes }) => {
                  const meta = KIND_META[item.kind];
                  return (
                    <Link
                      key={`${item.kind}-${item.id}`}
                      href={item.href ?? href('day', d)}
                      scroll={false}
                      style={{
                        top,
                        height: WEEK_BLOCK_PX,
                        left: `calc(${(lane / lanes) * 100}% + 1px)`,
                        width: `calc(${100 / lanes}% - 2px)`,
                      }}
                      title={`${meta.label} · ${item.title} · ${formatDisplayTime(item.startsAt!, timeZone)}`}
                      className={cn(
                        'absolute z-[1] truncate rounded-[5px] border-l-2 px-0.5 text-[9px] font-bold leading-[22px]',
                        meta.chip
                      )}
                    >
                      {item.title}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-panel to-transparent"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month
// ---------------------------------------------------------------------------

function MonthView({
  grouped,
  date,
  today,
  timeZone,
}: {
  grouped: Map<string, CalendarItem[]>;
  date: string;
  today: string;
  timeZone: string | null;
}) {
  const month = date.slice(0, 7);
  const selected = grouped.get(date) ?? [];

  return (
    <div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="pb-1 text-[10px] font-bold text-fg-3">
            {d}
          </span>
        ))}
        {monthGridDates(date).map((d) => {
          const inMonth = d.slice(0, 7) === month;
          const isSelected = d === date;
          return (
            <Link
              key={d}
              href={href('month', d)}
              scroll={false}
              aria-current={isSelected ? 'date' : undefined}
              aria-label={formatShortDate(d)}
              className={cn(
                'h-10 rounded-sm pt-1 text-[13px] font-semibold',
                !inMonth && 'text-fg-4',
                isSelected ? 'bg-acc text-white' : 'hover:bg-hover',
                d === today && !isSelected && 'ring-1 ring-inset ring-acc'
              )}
            >
              {dayNumber(d)}
              {inMonth && <Dots items={grouped.get(d)} light={isSelected} />}
            </Link>
          );
        })}
      </div>

      <div className="mt-3 border-t border-line pt-2.5">
        <p className="mb-1.5 text-xs font-bold text-fg-2">
          {weekdayShort(date)}, {formatShortDate(date)} · {selected.length} {selected.length === 1 ? 'item' : 'items'}
        </p>
        {selected.length === 0 ? (
          <p className="text-sm text-fg-3">Nothing on this day.</p>
        ) : (
          <div className="space-y-1.5">
            {selected.map((item) => (
              <EventChip key={`${item.kind}-${item.id}`} item={item} timeZone={timeZone} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
