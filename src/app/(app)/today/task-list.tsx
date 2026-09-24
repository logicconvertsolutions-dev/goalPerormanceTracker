'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CalendarDays, Check, Clock, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { addDays, formatDisplayDate, formatDisplayTime, isoToTimeInZone } from '@/lib/dates';
import { playChime } from '@/lib/chime';
import { createTaskAction, deleteTaskAction, toggleTaskAction, updateTaskAction } from './planner-actions';
import { TASK_KINDS, TASK_KIND_LABEL, type TaskKind } from './planner-schemas';

// To Do building blocks (P30, split out in P31) shared by the My Day card and
// the /today/tasks page: the add form, the row list and the edit dialog.

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

function dayLabel(iso: string, today: string) {
  if (iso === today) return 'Today';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  return formatDisplayDate(iso);
}

function KindPicker({ value, onChange }: { value: TaskKind; onChange: (k: TaskKind) => void }) {
  return (
    <>
      {TASK_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          aria-pressed={value === k}
          className={cn(
            'rounded-full border px-2.5 py-1 text-[11.5px] font-bold',
            value === k ? 'border-acc bg-acc text-white' : 'border-line text-fg-2'
          )}
        >
          {TASK_KIND_LABEL[k]}
        </button>
      ))}
    </>
  );
}

/** Quick add: title, then type, day (today or later) and an optional time. */
export function AddTaskForm({ today, defaultDate }: { today: string; defaultDate?: string }) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<TaskKind>('task');
  const [dueOn, setDueOn] = useState(defaultDate ?? today);
  const [time, setTime] = useState('');
  const [pending, startTransition] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    startTransition(async () => {
      const result = await createTaskAction({ title, kind, dueOn, dueTime: time });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (dueOn !== today) toast.success(`Added for ${dayLabel(dueOn, today)}`);
      setTitle('');
      setTime('');
      setKind('task');
      setDueOn(defaultDate ?? today);
    });
  }

  return (
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
          <KindPicker value={kind} onChange={setKind} />
          <div className="ml-auto flex items-center gap-1.5">
            <label className="flex items-center gap-1 text-[11.5px] font-semibold text-fg-2">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">Day</span>
              <input
                type="date"
                value={dueOn}
                min={today}
                required
                onChange={(e) => setDueOn(e.target.value || today)}
                className="h-8 rounded-[8px] border border-line bg-panel px-1.5 text-xs text-fg"
              />
            </label>
            <label className="flex items-center gap-1 text-[11.5px] font-semibold text-fg-2">
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
        </div>
      )}
    </form>
  );
}

/**
 * Task rows with tick, edit (tap the row) and delete. `hideDone`: a ticked
 * task leaves the list after a moment (the My Day card lists open tasks only).
 * `mobileLimit`: rows past it are hidden below the lg breakpoint, so a phone
 * shows fewer than a desktop from the same list.
 */
export function TaskList({
  tasks,
  today,
  timeZone,
  hideDone = false,
  mobileLimit,
  showDate = true,
}: {
  tasks: TodoItem[];
  today: string;
  timeZone: string | null;
  hideDone?: boolean;
  mobileLimit?: number;
  showDate?: boolean;
}) {
  const [optimisticDone, setOptimisticDone] = useState<Record<string, boolean>>({});
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<TodoItem | null>(null);
  const [, startTransition] = useTransition();

  // Fresh rows from the server replace any local guesses.
  useEffect(() => {
    setOptimisticDone({});
    setLeaving(new Set());
  }, [tasks]);

  function toggle(task: TodoItem) {
    const done = !(optimisticDone[task.id] ?? task.done_at !== null);
    if (done) playChime();
    setOptimisticDone((s) => ({ ...s, [task.id]: done }));
    // Let the tick show for a moment before the row leaves the card.
    if (hideDone && done) setTimeout(() => setLeaving((s) => new Set(s).add(task.id)), 900);
    startTransition(async () => {
      const result = await toggleTaskAction({ id: task.id, done });
      if (!result.ok) {
        setOptimisticDone((s) => ({ ...s, [task.id]: !done }));
        setLeaving((s) => {
          const next = new Set(s);
          next.delete(task.id);
          return next;
        });
        toast.error(result.error);
      }
    });
  }

  function remove(task: TodoItem) {
    setLeaving((s) => new Set(s).add(task.id));
    startTransition(async () => {
      const result = await deleteTaskAction(task.id);
      if (!result.ok) {
        setLeaving((s) => {
          const next = new Set(s);
          next.delete(task.id);
          return next;
        });
        toast.error(result.error);
      }
    });
  }

  const visible = tasks.filter((t) => !leaving.has(t.id));

  return (
    <>
      <ul className="divide-y divide-line">
        {visible.map((task, index) => {
          const done = optimisticDone[task.id] ?? task.done_at !== null;
          const k = kindOf(task.kind);
          const overdue = !done && task.due_on < today;
          return (
            <li
              key={task.id}
              className={cn(
                'group flex items-center gap-3 py-2.5',
                mobileLimit !== undefined && index >= mobileLimit && 'max-lg:hidden'
              )}
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={done}
                aria-label={`Mark "${task.title}" ${done ? 'not done' : 'done'}`}
                onClick={() => toggle(task)}
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border-2 transition-smooth',
                  done ? 'border-acc bg-acc text-white' : 'border-[#C7CCD8]'
                )}
              >
                {done && <Check className="h-3 w-3" strokeWidth={3} />}
              </button>
              <button
                type="button"
                onClick={() => setEditing(task)}
                aria-label={`Edit "${task.title}"`}
                className="min-w-0 flex-1 text-left"
              >
                <p className={cn('truncate text-sm font-semibold text-fg', done && 'text-fg-3 line-through')}>
                  {task.title}
                </p>
                <p className={cn('flex items-center gap-1 text-[11.5px] text-fg-3', overdue && 'text-bad')}>
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {showDate ? dayLabel(task.due_on, today) : null}
                  {task.due_at && `${showDate ? ' · ' : ''}${formatDisplayTime(task.due_at, timeZone)}`}
                  {!showDate && !task.due_at && 'Any time'}
                  {overdue && ' · overdue'}
                </p>
              </button>
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
      <EditTaskDialog task={editing} onClose={() => setEditing(null)} timeZone={timeZone} />
    </>
  );
}

function EditTaskDialog({
  task,
  onClose,
  timeZone,
}: {
  task: TodoItem | null;
  onClose: () => void;
  timeZone: string | null;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<TaskKind>('task');
  const [dueOn, setDueOn] = useState('');
  const [time, setTime] = useState('');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setKind(kindOf(task.kind));
    setDueOn(task.due_on);
    setTime(task.due_at ? isoToTimeInZone(task.due_at, timeZone) : '');
  }, [task, timeZone]);

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!task) return;
    startTransition(async () => {
      const result = await updateTaskAction({ id: task.id, title, kind, dueOn, dueTime: time });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Task saved');
      onClose();
    });
  }

  return (
    <Dialog open={task !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[calc(100vw-32px)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-task-title">Task</Label>
            <Input
              id="edit-task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <KindPicker value={kind} onChange={setKind} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-task-date">Day</Label>
              <Input
                id="edit-task-date"
                type="date"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-task-time">Time (optional)</Label>
              <Input id="edit-task-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !title.trim() || !dueOn}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
