'use client';

import { MoreVertical } from 'lucide-react';
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

/** One row in the "rest of today's queue" list, below the featured Next Up
 * card. Deliberately plain — no border/shadow of its own — so a run of these
 * inside one bordered container reads as a scannable list, not a stack of
 * cards. Covers both call follow-ups and appointments due (P23). */
export function TodayRow({
  kind,
  callLogId,
  contactId,
  contactName,
  lastNote,
  timesCalled,
  daysLate,
  appointmentAt,
  timeZone,
  overdue = false,
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
  overdue?: boolean;
}) {
  const { pending, handleSnooze, handleMarkDone } = useFollowUpActions(kind, callLogId);
  const { open: openLog } = useLogActivityDialog();
  const subtitle =
    kind === 'appointment' && appointmentAt
      ? `Appointment · ${formatDisplayTime(appointmentAt, timeZone)}`
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
          <DropdownMenuItem onClick={handleMarkDone}>Mark done</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
