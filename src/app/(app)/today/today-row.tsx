'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { MoreVertical } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { snoozeFollowUpAction, markFollowUpDoneAction } from './actions';

export function TodayRow({
  callLogId,
  contactId,
  contactName,
  lastNote,
  timesCalled,
  daysLate,
  overdue = false,
}: {
  callLogId: string;
  contactId: string;
  contactName: string;
  lastNote: string | null;
  timesCalled: number;
  daysLate: number;
  overdue?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function handleSnooze(daysToAdd: number) {
    startTransition(async () => {
      const result = await snoozeFollowUpAction(callLogId, daysToAdd);
      if (result.ok) toast.success('Snoozed');
      else toast.error('Could not snooze — try again');
    });
  }

  function handleMarkDone() {
    startTransition(async () => {
      const result = await markFollowUpDoneAction(callLogId);
      if (result.ok) toast.success('Marked done');
      else toast.error('Could not update — try again');
    });
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-sm border border-line py-2.5 px-3',
        overdue && 'border-bad/40'
      )}
    >
      <Link href={`/log?contact=${contactId}`} className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium truncate', overdue ? 'text-bad' : 'text-fg')}>
          {contactName}
        </p>
        {lastNote && <p className="text-xs text-fg-3 truncate">{lastNote}</p>}
        <p className="text-xs text-fg-4">
          Called {timesCalled}x
          {daysLate > 0 && ` · ${daysLate}d overdue`}
        </p>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={pending} aria-label="Row actions">
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
