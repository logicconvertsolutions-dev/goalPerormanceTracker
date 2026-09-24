'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Bell, BellOff, Check, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { addDays, formatDisplayDateTime, formatDisplayTime, isoToDateInZone, isoToTimeInZone } from '@/lib/dates';
import { playChime } from '@/lib/chime';
import {
  createReminderAction,
  deleteReminderAction,
  dismissReminderAction,
  updateReminderAction,
} from './planner-actions';
import { REMINDER_LEAD_MINUTES } from './planner-schemas';

// Reminders building blocks (P30, split out in P31) shared by the My Day card
// and the /today/reminders page: rows, and one dialog for new and edit.

export interface ReminderItem {
  id: string;
  title: string;
  remind_at: string;
  lead_minutes: number;
  push: boolean;
  sent_at: string | null;
  dismissed_at?: string | null;
}

function leadLabel(m: number) {
  if (m === 0) return 'At time';
  if (m < 60) return `${m} min before`;
  if (m < 1440) return `${m / 60} hr before`;
  return '1 day before';
}

/** Compact alert label for a reminder row: "On", "15m", "2h", "1d". */
function shortLead(m: number) {
  if (m === 0) return 'On';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${m / 60}h`;
  return '1d';
}

/** Rows: tap to edit, ✓ to complete (with a chime), and -- on the full page
 * -- delete. `mobileLimit` hides rows past it below the lg breakpoint. */
export function ReminderList({
  reminders,
  today,
  timeZone,
  mobileLimit,
  allowDelete = false,
}: {
  reminders: ReminderItem[];
  today: string;
  timeZone: string | null;
  mobileLimit?: number;
  allowDelete?: boolean;
}) {
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<ReminderItem | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => setLeaving(new Set()), [reminders]);

  function run(id: string, action: () => Promise<{ ok: boolean; error?: string }>) {
    setLeaving((s) => new Set(s).add(id));
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setLeaving((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
        toast.error(result.error ?? 'Something went wrong — try again.');
      }
    });
  }

  function complete(r: ReminderItem) {
    playChime();
    run(r.id, () => dismissReminderAction(r.id));
  }

  function whenLabel(iso: string) {
    const d = isoToDateInZone(iso, timeZone);
    const day = d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : formatDisplayDateTime(iso, timeZone);
    return `${day} · ${formatDisplayTime(iso, timeZone)}`;
  }

  const visible = reminders.filter((r) => !leaving.has(r.id));

  return (
    <>
      <ul className="space-y-2">
        {visible.map((r, index) => {
          const done = !!r.dismissed_at;
          return (
            <li
              key={r.id}
              className={cn(
                'flex items-center gap-3 rounded bg-sunken px-3 py-2.5',
                mobileLimit !== undefined && index >= mobileLimit && 'max-lg:hidden'
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-panel text-warn">
                <Bell className="h-4 w-4" aria-hidden="true" />
              </span>
              <button
                type="button"
                onClick={() => setEditing(r)}
                aria-label={`Edit "${r.title}"`}
                className="min-w-0 flex-1 text-left"
              >
                <p className={cn('truncate text-sm font-semibold text-fg', done && 'text-fg-3 line-through')}>
                  {r.title}
                </p>
                <p className="text-[11.5px] text-fg-3">
                  {whenLabel(r.remind_at)}
                  {done ? ' · done' : r.sent_at ? ' · sent' : ''}
                </p>
              </button>
              <span className="flex shrink-0 items-center gap-1 text-[10.5px] font-bold text-fg-2">
                {r.push ? (
                  <Bell className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <BellOff className="h-3 w-3" aria-hidden="true" />
                )}
                {r.push ? shortLead(r.lead_minutes) : 'Off'}
              </span>
              {!done && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => complete(r)}
                  aria-label={`Complete "${r.title}"`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-fg-3 hover:bg-hover hover:text-ok"
                >
                  <Check className="h-4 w-4" />
                </button>
              )}
              {allowDelete && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(r.id, () => deleteReminderAction(r.id))}
                  aria-label={`Delete "${r.title}"`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-fg-3 hover:bg-hover hover:text-bad"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <ReminderDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        today={today}
        timeZone={timeZone}
        reminder={editing}
      />
    </>
  );
}

/** "+ New" button that opens the reminder dialog. */
export function NewReminderButton({ today, timeZone }: { today: string; timeZone: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-sm font-bold text-acc hover:underline"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        New
      </button>
      <ReminderDialog open={open} onOpenChange={setOpen} today={today} timeZone={timeZone} reminder={null} />
    </>
  );
}

/** New reminder (reminder = null) or edit an existing one. Saving an edit
 * with a new time re-arms its push (reminders_rearm trigger). */
function ReminderDialog({
  open,
  onOpenChange,
  today,
  timeZone,
  reminder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  timeZone: string | null;
  reminder: ReminderItem | null;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('09:00');
  const [lead, setLead] = useState(15);
  const [push, setPush] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    if (reminder) {
      setTitle(reminder.title);
      setDate(isoToDateInZone(reminder.remind_at, timeZone));
      setTime(isoToTimeInZone(reminder.remind_at, timeZone));
      setLead(reminder.lead_minutes);
      setPush(reminder.push);
    } else {
      setTitle('');
      setDate(today);
      setTime('09:00');
      setLead(15);
      setPush(true);
    }
  }, [open, reminder, today, timeZone]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const input = { title, date, time, leadMinutes: lead, push };
      const result = reminder
        ? await updateReminderAction({ ...input, id: reminder.id })
        : await createReminderAction(input);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Reminder saved');
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-32px)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{reminder ? 'Edit reminder' : 'New reminder'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reminder-title">What should we remind you about?</Label>
            <Input
              id="reminder-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Send proposal to Prasanjit"
              maxLength={200}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="reminder-date">Date</Label>
              <Input
                id="reminder-date"
                type="date"
                value={date}
                min={reminder ? undefined : today}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reminder-time">Time</Label>
              <Input id="reminder-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reminder-lead">Alert me</Label>
            <select
              id="reminder-lead"
              value={lead}
              onChange={(e) => setLead(Number(e.target.value))}
              className="flex h-11 w-full rounded-sm border border-line-2 bg-sunken px-3 text-sm text-fg"
            >
              {REMINDER_LEAD_MINUTES.map((m) => (
                <option key={m} value={m}>
                  {leadLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2.5 text-sm text-fg">
            <input
              type="checkbox"
              checked={push}
              onChange={(e) => setPush(e.target.checked)}
              className="h-4 w-4 accent-[#0B1E3D]"
            />
            Send a push notification to my devices
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !title.trim()}>
              Save reminder
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
