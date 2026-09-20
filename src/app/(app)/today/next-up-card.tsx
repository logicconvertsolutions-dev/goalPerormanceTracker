'use client';

import { Phone, CalendarClock, MoreVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useFollowUpActions, type DueItemKind } from './use-follow-up-actions';
import { useLogActivityDialog } from '@/components/shell/log-activity-dialog';
import { formatDisplayTime } from '@/lib/dates';

/** The single most urgent item, featured above the rest of the queue —
 * answers "what should I do next" the moment the page opens. Covers both
 * call follow-ups and appointments due (P23). */
export function NextUpCard({
  kind,
  callLogId,
  contactId,
  contactName,
  lastNote,
  timesCalled,
  daysLate,
  appointmentAt,
  timeZone,
}: {
  kind: DueItemKind;
  callLogId: string;
  contactId: string;
  contactName: string;
  lastNote: string | null;
  timesCalled: number;
  daysLate: number;
  appointmentAt: string | null;
  timeZone: string | null;
}) {
  const { pending, handleSnooze, handleMarkDone } = useFollowUpActions(kind, callLogId);
  const { open: openLog } = useLogActivityDialog();
  const overdue = daysLate > 0;
  const isAppointment = kind === 'appointment';

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
            <DropdownMenuItem onClick={handleMarkDone}>Mark done</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
