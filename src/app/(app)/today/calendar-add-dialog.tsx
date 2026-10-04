'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Bell, ListChecks, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatShortDate } from '@/lib/dates';
import { AppointmentForm } from '../appointments/appointment-form';
import { createTaskAction } from './planner-actions';
import { type TaskKind } from './planner-schemas';
import { KindPicker } from './task-list';
import { ReminderForm } from './reminder-list';

// "Add to calendar" sheet (P32): opened by tapping an empty slot on the My
// Day calendar, a selected month day, or the calendar's Add button. Each
// type saves through the flow it already has everywhere else -- the
// appointment form (so it counts as Appts Set exactly like /appointments/new),
// the To Do action, and the reminder form -- so there is no second way to
// create any of them.

export type CalendarAddKind = 'appointment' | 'task' | 'reminder';

const KINDS: { value: CalendarAddKind; label: string; icon: LucideIcon }[] = [
  { value: 'appointment', label: 'Appointment', icon: Users },
  { value: 'task', label: 'Task', icon: ListChecks },
  { value: 'reminder', label: 'Reminder', icon: Bell },
];

export interface CalendarSlot {
  date: string;
  /** "HH:MM" */
  time: string;
}

export function CalendarAddDialog({
  slot,
  onClose,
  onSaved,
  today,
  timeZone,
}: {
  /** null = closed. */
  slot: CalendarSlot | null;
  onClose: () => void;
  onSaved: () => void;
  today: string;
  timeZone: string | null;
}) {
  const [kind, setKind] = useState<CalendarAddKind>('appointment');
  // To-dos and reminders can't be set in the past; an appointment can (it
  // may be logging one that already happened), so only those two move a
  // past slot up to today.
  const futureDate = slot && slot.date < today ? today : slot?.date;

  function saved() {
    onSaved();
    onClose();
  }

  return (
    <Dialog open={slot !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-[calc(100vw-32px)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to calendar</DialogTitle>
          <DialogDescription>{slot ? formatShortDate(slot.date) : ''}</DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="What are you adding?" className="grid grid-cols-3 gap-1 rounded-sm bg-sunken p-[3px]">
          {KINDS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => setKind(value)}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-[8px] px-2 py-2 text-xs font-bold text-fg-2 transition-smooth',
                kind === value ? 'bg-acc text-on-acc' : 'hover:text-fg'
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        {slot && kind === 'appointment' && (
          <AppointmentForm mode="create" prefillSlot={slot} onSuccess={saved} onCancel={onClose} />
        )}
        {slot && kind === 'task' && (
          <TaskForm today={today} date={futureDate!} time={slot.time} onSaved={saved} onCancel={onClose} />
        )}
        {slot && kind === 'reminder' && (
          <ReminderForm
            today={today}
            timeZone={timeZone}
            reminder={null}
            initialDate={futureDate}
            initialTime={slot.time}
            onSaved={saved}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A To Do with its day and time already filled in from the tapped slot. */
function TaskForm({
  today,
  date,
  time,
  onSaved,
  onCancel,
}: {
  today: string;
  date: string;
  time: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [taskKind, setTaskKind] = useState<TaskKind>('task');
  const [dueOn, setDueOn] = useState(date);
  const [dueTime, setDueTime] = useState(time);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createTaskAction({ title, kind: taskKind, dueOn, dueTime });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Task added');
      onSaved();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="calendar-task-title">Task</Label>
        <Input
          id="calendar-task-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Prepare illustration for Maria"
          maxLength={200}
          required
        />
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Type">
        <KindPicker value={taskKind} onChange={setTaskKind} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="calendar-task-date">Date</Label>
          <Input
            id="calendar-task-date"
            type="date"
            value={dueOn}
            min={today}
            onChange={(e) => setDueOn(e.target.value || today)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="calendar-task-time">Time (optional)</Label>
          <Input id="calendar-task-time" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending || !title.trim()}>
          Add task
        </Button>
      </div>
    </form>
  );
}
