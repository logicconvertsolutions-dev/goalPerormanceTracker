'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import {
  snoozeFollowUpAction,
  markFollowUpDoneAction,
  snoozeAppointmentAction,
  markAppointmentDoneAction,
  snoozeScheduledAppointmentAction,
  resolveAppointmentAction,
  snoozeAppointmentFollowUpAction,
  markAppointmentFollowUpDoneAction,
} from './actions';
import { RESOLVABLE_STATUSES, type ResolvableStatus } from '@/lib/appointment-types';

/**
 * The four row shapes `my_followups` returns, and the two tables behind
 * them. `kind` is the routing key: the RPC's `call_id` is "the id of the
 * row this item came from", which is a call_logs id for the first and
 * third and an appointments id for the other two.
 *
 *   follow_up             call_logs.follow_up_on
 *   call_appointment      call_logs.appointment_at   -- pre-P25-C1 only
 *   appointment           appointments, status='scheduled'
 *   appointment_follow_up appointments.follow_up_on  -- F12
 */
export type DueItemKind = 'follow_up' | 'call_appointment' | 'appointment' | 'appointment_follow_up';

/** Only a real appointments row can carry an outcome. */
export function isResolvable(kind: DueItemKind): boolean {
  return kind === 'appointment';
}

export const RESOLVE_OPTIONS = RESOLVABLE_STATUSES;

const SNOOZE: Record<DueItemKind, (id: string, days: number) => Promise<{ ok: boolean }>> = {
  follow_up: snoozeFollowUpAction,
  call_appointment: snoozeAppointmentAction,
  appointment: snoozeScheduledAppointmentAction,
  appointment_follow_up: snoozeAppointmentFollowUpAction,
};

const MARK_DONE: Record<DueItemKind, (id: string) => Promise<{ ok: boolean }>> = {
  follow_up: markFollowUpDoneAction,
  call_appointment: markAppointmentDoneAction,
  // A pending appointment has no "done" -- it resolves via handleResolve,
  // and the row components offer Held / No-show / Cancelled instead of
  // Mark done for it. Kept in the map so it stays exhaustive over
  // DueItemKind (a kind added later has to answer the question rather than
  // fall through to undefined), and failing loudly rather than quietly
  // writing some other column if the two ever drift apart.
  appointment: async () => ({ ok: false }),
  appointment_follow_up: markAppointmentFollowUpDoneAction,
};

/**
 * Snooze / mark-done / resolve behaviour shared by every My Day row,
 * routed by `kind` so the card and row components don't need to know which
 * table an item came from.
 *
 * Mark done and Resolve are mutually exclusive by kind: a pending
 * appointment exits the queue by recording what happened (Held / No-show /
 * Cancelled), everything else by being ticked off. That split is P25 C1
 * closing F11 -- the old "Mark done" wrote `appointment_done_at`, which
 * fed no metric and left the appointment permanently statusless.
 */
export function useFollowUpActions(kind: DueItemKind, rowId: string) {
  const [pending, startTransition] = useTransition();

  function handleSnooze(daysToAdd: number) {
    startTransition(async () => {
      const result = await SNOOZE[kind](rowId, daysToAdd);
      if (result.ok) toast.success('Snoozed');
      else toast.error('Could not snooze — try again');
    });
  }

  function handleMarkDone() {
    startTransition(async () => {
      const result = await MARK_DONE[kind](rowId);
      if (result.ok) toast.success('Marked done');
      else toast.error('Could not update — try again');
    });
  }

  function handleResolve(status: ResolvableStatus) {
    startTransition(async () => {
      const result = await resolveAppointmentAction(rowId, status);
      if (result.ok) {
        toast.success(RESOLVE_OPTIONS.find((o) => o.value === status)?.label ?? 'Updated');
      } else {
        toast.error(result.error ?? 'Could not update — try again');
      }
    });
  }

  return { pending, handleSnooze, handleMarkDone, handleResolve };
}
