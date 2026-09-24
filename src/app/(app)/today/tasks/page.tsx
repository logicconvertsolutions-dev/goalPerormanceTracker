import Link from 'next/link';
import { redirect } from 'next/navigation';
import { X } from 'lucide-react';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { addDays, formatFullDisplayDate, isIsoDate, todayIso } from '@/lib/dates';
import { AddTaskForm, TaskList, type TodoItem } from '../task-list';
import { PlannerPageHeader } from '../planner-page-header';

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Completed' },
  { key: 'all', label: 'All' },
] as const;
type Filter = (typeof FILTERS)[number]['key'];

/** Enough for any real to-do list; the page is one agent's own tasks. */
const MAX_ROWS = 500;

/**
 * Every to-do (P31) -- the My Day card's "View all". Open tasks run from the
 * oldest overdue forward; completed and "all" run newest day first. `?date=`
 * narrows to one day (the calendar's "+N more to-dos" link).
 */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; date?: string }>;
}) {
  const session = await requireVerifiedAgent();
  if (session.agent!.role === 'admin') redirect('/admin/agents');
  const supabase = await createClient();
  const agentId = session.agent!.id;
  const timeZone = session.agent!.time_zone;
  const today = todayIso(timeZone);
  const params = await searchParams;
  const filter: Filter = FILTERS.some((f) => f.key === params.status) ? (params.status as Filter) : 'open';
  const date = isIsoDate(params.date) ? params.date : null;

  const base = () => {
    const q = supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('agent_id', agentId);
    return date ? q.eq('due_on', date) : q;
  };
  let list = supabase
    .from('tasks')
    .select('id, title, kind, due_on, due_at, done_at')
    .eq('agent_id', agentId)
    .order('due_on', { ascending: filter === 'open' })
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(MAX_ROWS);
  if (date) list = list.eq('due_on', date);
  if (filter === 'open') list = list.is('done_at', null);
  if (filter === 'done') list = list.not('done_at', 'is', null);

  const [{ data }, { count: open }, { count: done }, { count: all }] = await Promise.all([
    list,
    base().is('done_at', null),
    base().not('done_at', 'is', null),
    base(),
  ]);
  const tasks: TodoItem[] = data ?? [];

  // Group by due day, keeping the query's order.
  const groups: { day: string; items: TodoItem[] }[] = [];
  for (const t of tasks) {
    const last = groups[groups.length - 1];
    if (last && last.day === t.due_on) last.items.push(t);
    else groups.push({ day: t.due_on, items: [t] });
  }
  // Within a day, open tasks before completed ones (sort is stable, so time order holds).
  for (const g of groups) g.items.sort((x, y) => Number(x.done_at !== null) - Number(y.done_at !== null));
  const dateQuery = date ? `&date=${date}` : '';
  const counts: Record<Filter, number> = { open: open ?? 0, done: done ?? 0, all: all ?? 0 };

  function dayHeading(day: string) {
    if (day === today) return 'Today';
    if (day === addDays(today, 1)) return 'Tomorrow';
    if (day === addDays(today, -1)) return 'Yesterday';
    return formatFullDisplayDate(day);
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 lg:max-w-2xl">
      <PlannerPageHeader
        title="To Do"
        label="Filter tasks"
        current={filter}
        filters={FILTERS.map((f) => ({
          key: f.key,
          label: f.label,
          href: `/today/tasks?status=${f.key}${dateQuery}`,
          count: counts[f.key],
        }))}
      />

      {date && (
        <Link
          href={`/today/tasks?status=${filter}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-acc-line bg-acc-dim px-3 py-1 text-xs font-bold text-acc"
        >
          {formatFullDisplayDate(date)}
          <X className="h-3.5 w-3.5" aria-label="Show every day" />
        </Link>
      )}

      <section className="rounded-lg border border-line bg-panel p-4 shadow-card">
        <AddTaskForm today={today} defaultDate={date && date >= today ? date : undefined} />
      </section>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-line bg-panel px-4 py-4 shadow-card">
          <p className="text-sm text-fg-3">
            {filter === 'open'
              ? 'Nothing open. Nice work.'
              : filter === 'done'
                ? 'Nothing completed yet.'
                : 'No tasks yet.'}
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.day} className="rounded-lg border border-line bg-panel px-4 pt-3 shadow-card">
            <h2
              className={
                g.day < today && filter !== 'done' ? 'text-xs font-bold text-bad' : 'text-xs font-bold text-fg-2'
              }
            >
              {dayHeading(g.day)}
            </h2>
            <TaskList tasks={g.items} today={today} timeZone={timeZone} hideDone={filter === 'open'} showDate={false} />
          </section>
        ))
      )}
    </div>
  );
}
