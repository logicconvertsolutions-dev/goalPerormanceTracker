'use client';

import { useState } from 'react';
import { Phone, CalendarClock, MoreVertical } from 'lucide-react';
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
import { formatDisplayTime } from '@/lib/dates';

/** The single most urgent item, featured above the rest of the queue —
 * answers "what should I do next" the moment the page opens. Covers call
 * follow-ups and appointments due, from either table (P23, P25 C1). */
export function NextUpCard({
  kind,
  rowId,
  contactId,
  contactName,
  lastNote,
  timesCalled,
  daysLate,
  appointmentAt,
  timeZone,
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
  timeZone: string | null;
}) {
  const { pending, handleSnooze, handleMarkDone, handleResolve } = useFollowUpActions(kind, rowId);
  const [resolveMode, setResolveMode] = useState<ResolveMode | null>(null);
  const { open: openLog } = useLogActivityDialog();
  const overdue = daysLate > 0;
  const isAppointment = kind === 'appointment' || kind === 'call_appointment';
  const resolvable = isResolvable(kind);

  return (
    <div className="flex items-stretch gap-3 rounded-lg border border-line bg-panel pr-2 shadow-card">
      <div className={overdue ? 'w-[3px] shrink-0 rounded-l-[12px] bg-bad' : 'w-[3px] shrink-0 rounded-l-[12px] bg-gold'} />
      <button
        type="button"
        onClick={() => openLog({ contactId, contactName })}
        className="flex min-w-0 flex-1 items-center gap-3 py-3.5 text-left"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-acc-dim text-acc">
          {isAppointment ? (
            <CalendarClock className="h-[18px] w-[18px]" aria-hidden="true" />
          ) : (
            <Phone className="h-[18px] w-[18px]" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold text-fg">{contactName}</p>
          {isAppointment && appointmentAt ? (
            <p className="truncate text-sm text-fg-3">Appointment · {formatDisplayTime(appointmentAt, timeZone)}</p>
          ) : lastNote ? (
            <p className="truncate text-sm text-fg-3">{lastNote}</p>
          ) : (
            <p className="truncate text-sm text-fg-3">Called {timesCalled}x</p>
          )}
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1.5 self-center">
        <Badge variant={overdue ? 'bad' : 'neutral'}>
          {overdue ? `${daysLate}d overdue` : 'Due today'}
        </Badge>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" disabled={pending} aria-label="Follow-up actions">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleSnooze(1)}>Snooze 1 day</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleSnooze(7)}>Snooze 1 week</DropdownMenuItem>
            {/* See TodayRow -- a pending appointment records an outcome
                instead of being marked done (P25 C1, F11), and the two
                outcomes that need more than a tap open the sheet (C2). */}
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
      </div>

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
