'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, Clock, ListChecks, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDisplayDate, formatDisplayTime } from '@/lib/dates';
import { createTaskAction, deleteTaskAction, toggleTaskAction } from './planner-actions';
import { TASK_KINDS, TASK_KIND_LABEL, type TaskKind } from './planner-schemas';

export interface TodoItem {
  id: string;
  title: string;
  kind: string;
  due_on: string;
  due_at: string | null;
  done_at: string | null;
}

const KIND_TAG: Record<TaskKind, string> = {
  call: 'bg-acc-dim text-acc',
  task: 'bg-ok-dim text-ok',
  meeting: 'bg-[#4a3aa7]/10 text-[#4a3aa7]',
  follow_up: 'bg-warn-dim text-warn',
};

function kindOf(k: string): TaskKind {
  return (TASK_KINDS as readonly string[]).includes(k) ? (k as TaskKind) : 'task';
}

/** My Day To Do (P30): today's open tasks plus anything overdue, newest
 * additions at the bottom; ticked-off items stay visible (struck through)
 * for the rest of the day. */
export function TodoCard({ tasks, today, timeZone }: { tasks: TodoItem[]; today: string; timeZone: string | null }) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<TaskKind>('task');
  const [time, setTime] = useState('');
  const [pending, startTransition] = useTransition();
  const [optimisticDone, setOptimisticDone] = useState<Record<string, boolean>>({});

  const openCount = tasks.filter((t) => !(optimisticDone[t.id] ?? t.done_at !== null)).length;

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    startTransition(async () => {
      const result = await createTaskAction({ title, kind, dueOn: today, dueTime: time });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setTitle('');
      setTime('');
      setKind('task');
    });
  }

  function toggle(task: TodoItem) {
    const done = !(optimisticDone[task.id] ?? task.done_at !== null);
    setOptimisticDone((s) => ({ ...s, [task.id]: done }));
    startTransition(async () => {
      const result = await toggleTaskAction({ id: task.id, done });
      if (!result.ok) {
        setOptimisticDone((s) => ({ ...s, [task.id]: !done }));
        toast.error(result.error);
      }
    });
  }

  function remove(task: TodoItem) {
    startTransition(async () => {
      const result = await deleteTaskAction(task.id);
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <section className="rounded-lg border border-line bg-panel p-4 shadow-card" aria-labelledby="todo-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="todo-heading" className="flex items-center gap-2 text-[17px] font-bold text-fg">
          <ListChecks className="h-[18px] w-[18px]" aria-hidden="true" />
          To Do
          <span className="text-xs font-semibold text-fg-3">
            {openCount} of {tasks.length} left
          </span>
        </h2>
      </div>

      <form onSubmit={add} className="space-y-2">
        <div className="flex items-center gap-2 rounded-sm border border-line-2 bg-sunken pl-3 pr-1.5 focus-within:border-acc-line">
          <label htmlFor="new-task" className="sr-only">
            New task
          </label>
          <input
            id="new-task"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a new task…"
            maxLength={200}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-4"
          />
          <button
            type="submit"
            disabled={pending || !title.trim()}
            aria-label="Add task"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-acc text-white disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {title.trim() && (
          <div className="flex flex-wrap items-center gap-1.5">
            {TASK_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11.5px] font-bold',
                  kind === k ? 'border-acc bg-acc text-white' : 'border-line text-fg-2'
                )}
              >
                {TASK_KIND_LABEL[k]}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1 text-[11.5px] font-semibold text-fg-2">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">Time (optional)</span>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-8 rounded-[8px] border border-line bg-panel px-1.5 text-xs text-fg"
              />
            </label>
          </div>
        )}
      </form>

      {tasks.length === 0 ? (
        <p className="mt-3 text-sm text-fg-3">No tasks yet. Add one above — it will show on your calendar too.</p>
      ) : (
        <ul className="mt-1 divide-y divide-line">
          {tasks.map((task) => {
            const done = optimisticDone[task.id] ?? task.done_at !== null;
            const k = kindOf(task.kind);
            const overdue = !done && task.due_on < today;
            return (
              <li key={task.id} className="group flex items-center gap-3 py-2.5">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={done}
                  aria-label={`Mark "${task.title}" ${done ? 'not done' : 'done'}`}
                  onClick={() => toggle(task)}
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border-2',
                    done ? 'border-acc bg-acc text-white' : 'border-[#C7CCD8]'
                  )}
                >
                  {done && <Check className="h-3 w-3" strokeWidth={3} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-sm font-semibold text-fg', done && 'text-fg-3 line-through')}>
                    {task.title}
                  </p>
                  <p className={cn('flex items-center gap-1 text-[11.5px] text-fg-3', overdue && 'text-bad')}>
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {task.due_on === today ? 'Today' : formatDisplayDate(task.due_on)}
                    {task.due_at && ` · ${formatDisplayTime(task.due_at, timeZone)}`}
                    {overdue && ' · overdue'}
                  </p>
                </div>
                <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-bold', KIND_TAG[k])}>
                  {TASK_KIND_LABEL[k]}
                </span>
                <button
                  type="button"
                  onClick={() => remove(task)}
                  aria-label={`Delete "${task.title}"`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-fg-3 hover:bg-hover hover:text-bad"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
