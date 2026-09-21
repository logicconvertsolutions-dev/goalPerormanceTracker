'use client';

import { useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useFollowUpActions, isResolvable, RESOLVE_OPTIONS, type DueItemKind } from './use-follow-up-actions';
import { ResolveAppointmentDialog, type ResolveMode } from '../appointments/resolve-appointment-dialog';
import { useLogActivityDialog } from '@/components/shell/log-activity-dialog';
import { formatDisplayTime, formatDisplayDateTime, formatDisplayDate } from '@/lib/dates';

/** One row of My Day's queue, below the featured Next Up card.
 * Deliberately plain — no border/shadow of its own — so a run of these
 * inside one band container reads as a scannable list, not a stack of
 * cards. Covers call follow-ups and appointments from either table (P23,
 * P25 C1), now due today, overdue, or up to a week out (P25 D-1). */
export function TodayRow({
  kind,
  rowId,
  contactId,
  contactName,
  lastNote,
  timesCalled,
  daysLate,
  appointmentAt,
  dueDate,
  timeZone,
  overdue = false,
}: {
  kind: DueItemKind;
  /** call_logs.id or appointments.id — `kind` says which (P25 C1). */
  rowId: string;
  contactId: string;
  contactName: string;
  lastNote: string | null;
  timesCalled: number;
  daysLate: number;
  appointmentAt: string | null;
  /** `my_followups.due_date` — the day the item is for. Only read for a
   *  forward-dated row that has no slot of its own. */
  dueDate: string | null;
  timeZone: string | null;
  overdue?: boolean;
}) {
  const { pending, handleSnooze, handleMarkDone, handleResolve } = useFollowUpActions(kind, rowId);
  const [resolveMode, setResolveMode] = useState<ResolveMode | null>(null);
  const { open: openLog } = useLogActivityDialog();
  const resolvable = isResolvable(kind);
  // P25 D-1: a row in the Tomorrow or Later band has to say WHICH day.
  // "Appointment · 2:30 PM" is a complete answer for today and an
  // unreadable one for next Thursday, and the widened window is exactly
  // what puts next Thursday in this list. A negative days_late is the
  // signal that the row is in the future (see the D-1 migration header).
  //
  // formatDisplayDateTime returns the date alone despite its name, so the
  // pair below reads "Thu, Sep 24 · 2:30 PM" — the same shape the
  // Upcoming section on /appointments already uses.
  const ahead = daysLate < 0;
  const subtitle = appointmentAt
    ? ahead
      ? `Appointment · ${formatDisplayDateTime(appointmentAt, timeZone)} · ${formatDisplayTime(appointmentAt, timeZone)}`
      : `Appointment · ${formatDisplayTime(appointmentAt, timeZone)}`
    : ahead && dueDate
      // A legacy or imported appointment has a date but no slot — say the
      // date rather than inventing a time it was never given.
      ? `Appointment · ${formatDisplayDate(dueDate)}`
      : lastNote || `Called ${timesCalled}x`;

  return (
    <div className="flex items-center justify-between gap-2 py-3">
      <button
        type="button"
        onClick={() => openLog({ contactId, contactName })}
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-[15px] font-semibold text-fg">{contactName}</p>
        <p className="truncate text-sm text-fg-3">{subtitle}</p>
      </button>

      {overdue && <Badge variant="bad">{daysLate}d overdue</Badge>}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={pending} aria-label={`Actions for ${contactName}`}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handleSnooze(1)}>Snooze 1 day</DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleSnooze(7)}>Snooze 1 week</DropdownMenuItem>
          {/* A pending appointment leaves the queue by recording what
              happened, not by being ticked off -- see useFollowUpActions.
              Held and Rescheduled open the sheet because each needs
              something a menu item cannot ask for; the other two are a
              tap, because there is nothing to ask. */}
          {resolvable ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setResolveMode('held')}>Held…</DropdownMenuItem>
              {RESOLVE_OPTIONS.map((o) => (
                <DropdownMenuItem key={o.value} onClick={() => handleResolve(o.value)}>
                  {o.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={() => setResolveMode('rescheduled')}>Reschedule…</DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onClick={handleMarkDone}>Mark done</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {resolvable && (
        <ResolveAppointmentDialog
          mode={resolveMode}
          appointmentId={rowId}
          contactName={contactName}
          onOpenChange={(open) => !open && setResolveMode(null)}
        />
      )}
    </div>
  );
}
