'use client';

import Link from 'next/link';
import { Phone, MoreVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useFollowUpActions } from './use-follow-up-actions';

/** The single most urgent follow-up, featured above the rest of the queue —
 * answers "what should I do next" the moment the page opens. */
export function NextUpCard({
  callLogId,
  contactId,
  contactName,
  lastNote,
  timesCalled,
  daysLate,
}: {
  callLogId: string;
  contactId: string;
  contactName: string;
  lastNote: string | null;
  timesCalled: number;
  daysLate: number;
}) {
  const { pending, handleSnooze, handleMarkDone } = useFollowUpActions(callLogId);
  const overdue = daysLate > 0;

  return (
    <div className="flex items-stretch gap-3 rounded-lg border border-line bg-panel pr-2 shadow-card">
      <div className={overdue ? 'w-[3px] shrink-0 rounded-l-[12px] bg-bad' : 'w-[3px] shrink-0 rounded-l-[12px] bg-gold'} />
      <Link href={`/log?contact=${contactId}`} className="flex min-w-0 flex-1 items-center gap-3 py-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-acc-dim text-acc">
          <Phone className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold text-fg">{contactName}</p>
          {lastNote ? (
            <p className="truncate text-sm text-fg-3">{lastNote}</p>
          ) : (
            <p className="truncate text-sm text-fg-3">Called {timesCalled}x</p>
          )}
        </div>
      </Link>
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
