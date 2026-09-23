'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Bell, BellOff, Check, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { addDays, formatDisplayDateTime, formatDisplayTime, isoToDateInZone } from '@/lib/dates';
import { createReminderAction, dismissReminderAction } from './planner-actions';
import { REMINDER_LEAD_MINUTES } from './planner-schemas';

export interface ReminderItem {
  id: string;
  title: string;
  remind_at: string;
  lead_minutes: number;
  push: boolean;
  sent_at: string | null;
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

/** My Day Reminders (P30): upcoming reminders, soonest first, each with its
 * alert setting. "+ New" opens a small sheet; the delivery job turns a due
 * reminder into a bell notification (and a push, if on). */
export function RemindersCard({
  reminders,
  today,
  timeZone,
}: {
  reminders: ReminderItem[];
  today: string;
  timeZone: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function dismiss(id: string) {
    startTransition(async () => {
      const result = await dismissReminderAction(id);
      if (!result.ok) toast.error(result.error);
    });
  }

  function whenLabel(iso: string) {
    const d = isoToDateInZone(iso, timeZone);
    const day = d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : formatDisplayDateTime(iso, timeZone);
    return `${day} · ${formatDisplayTime(iso, timeZone)}`;
  }

  return (
    <section className="rounded-lg border border-line bg-panel p-4 shadow-card" aria-labelledby="reminders-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="reminders-heading" className="flex items-center gap-2 text-[17px] font-bold text-fg">
          <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
          Reminders
        </h2>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 text-sm font-bold text-acc hover:underline"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New
        </button>
      </div>

      {reminders.length === 0 ? (
        <p className="text-sm text-fg-3">No upcoming reminders. Tap “New” to add one.</p>
      ) : (
        <ul className="space-y-2">
          {reminders.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded bg-sunken px-3 py-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-panel text-warn">
                <Bell className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">{r.title}</p>
                <p className="text-[11.5px] text-fg-3">
                  {whenLabel(r.remind_at)}
                  {r.sent_at && ' · sent'}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1 text-[10.5px] font-bold text-fg-2">
                {r.push ? (
                  <Bell className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <BellOff className="h-3 w-3" aria-hidden="true" />
                )}
                {r.push ? shortLead(r.lead_minutes) : 'Off'}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => dismiss(r.id)}
                aria-label={`Dismiss "${r.title}"`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-fg-3 hover:bg-hover hover:text-ok"
              >
                <Check className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <NewReminderDialog open={open} onOpenChange={setOpen} today={today} />
    </section>
  );
}

function NewReminderDialog({
  open,
  onOpenChange,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('09:00');
  const [lead, setLead] = useState(15);
  const [push, setPush] = useState(true);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createReminderAction({ title, date, time, leadMinutes: lead, push });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Reminder saved');
      setTitle('');
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-32px)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New reminder</DialogTitle>
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
              <Input id="reminder-date" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} required />
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
