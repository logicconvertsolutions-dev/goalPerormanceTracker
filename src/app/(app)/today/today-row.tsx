'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { useFollowUpActions, isResolvable, canSnooze, RESOLVE_OPTIONS, type DueItemKind } from './use-follow-up-actions';
import { ResolveAppointmentDialog, type ResolveMode } from '../appointments/resolve-appointment-dialog';
import { useLogActivityDialog } from '@/components/shell/log-activity-dialog';
import { dueItemHref } from './due-item-target';
import { formatDisplayTime } from '@/lib/dates';

/** One row in the "rest of today's queue" list, below the featured Next Up
 * card. Deliberately plain — no border/shadow of its own — so a run of these
 * inside one bordered container reads as a scannable list, not a stack of
 * cards. Covers call follow-ups and appointments due, from either table
 * (P23, P25 C1). */
export function TodayRow({
  kind,
  rowId,
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
  /** call_logs.id or appointments.id — `kind` says which (P25 C1). */
  rowId: string;
  contactId: string;
  contactName: string;
  lastNote: string | null;
  timesCalled: number;
  daysLate: number;
  appointmentAt: string | null;
  timeZone: string | null;
  overdue?: boolean;
}) {
  const { pending, handleSnooze, handleMarkDone } = useFollowUpActions(kind, rowId);
  const [resolveMode, setResolveMode] = useState<ResolveMode | null>(null);
  const { open: openLog } = useLogActivityDialog();
  const router = useRouter();
  const resolvable = isResolvable(kind);
  const subtitle = appointmentAt
    ? `Appointment · ${formatDisplayTime(appointmentAt, timeZone)}`
    : lastNote || `Called ${timesCalled}x`;

  return (
    <div className="flex items-center justify-between gap-2 py-3">
      <button
        type="button"
        onClick={() => {
          const href = dueItemHref(kind, rowId);
          if (href) router.push(href);
          else openLog({ contactId, contactName });
        }}
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
          {/* Callbacks only -- an appointment moves by Reschedule (2026-09-22). */}
          {canSnooze(kind) && (
            <>
              <DropdownMenuItem onClick={() => handleSnooze(1)}>Snooze 1 day</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSnooze(7)}>Snooze 1 week</DropdownMenuItem>
            </>
          )}
          {/* A pending appointment leaves the queue by recording what
              happened, not by being ticked off -- see useFollowUpActions.
              Every outcome opens the resolve dialog, which confirms the
              day it happened; Held also captures what the meeting
              produced, and Reschedule asks for the new slot. */}
          {resolvable ? (
            <>
              {canSnooze(kind) && <DropdownMenuSeparator />}
              <DropdownMenuItem onClick={() => setResolveMode('held')}>Held…</DropdownMenuItem>
              {RESOLVE_OPTIONS.map((o) => (
                <DropdownMenuItem key={o.value} onClick={() => setResolveMode(o.value)}>
                  {o.label}…
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
