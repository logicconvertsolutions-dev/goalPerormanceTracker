'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import {
  snoozeFollowUpAction,
  markFollowUpDoneAction,
  markAppointmentDoneAction,
  snoozeAppointmentFollowUpAction,
  markAppointmentFollowUpDoneAction,
} from './actions';
import { RESOLVABLE_STATUSES } from '@/lib/appointment-types';

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

/**
 * Snooze is for callbacks only (decided 2026-09-22). On an appointment it
 * moved the appointment itself without recording a reschedule, sitting in
 * the same menu as "Reschedule…" -- two items that look alike and do
 * different things to the numbers. An appointment moves by Reschedule.
 */
export function canSnooze(kind: DueItemKind): boolean {
  return kind === 'follow_up' || kind === 'appointment_follow_up';
}

/**
 * The outcomes a row menu offers besides Held. Every outcome opens the
 * resolve dialog, which asks when it happened (the day it counts on is
 * confirmed, never presumed); Held additionally captures what the meeting
 * produced. Rescheduled is not here -- it needs the new slot (D1).
 */
export const RESOLVE_OPTIONS = RESOLVABLE_STATUSES.filter((o) => o.value !== 'held');

type SnoozableKind = 'follow_up' | 'appointment_follow_up';

const SNOOZE: Record<SnoozableKind, (id: string, days: number) => Promise<{ ok: boolean }>> = {
  follow_up: snoozeFollowUpAction,
  appointment_follow_up: snoozeAppointmentFollowUpAction,
};

const MARK_DONE: Record<DueItemKind, (id: string) => Promise<{ ok: boolean }>> = {
  follow_up: markFollowUpDoneAction,
  call_appointment: markAppointmentDoneAction,
  // A pending appointment has no "done" -- it resolves through the resolve
  // dialog, and the row components offer its outcomes instead of Mark done.
  // Kept in the map so it stays exhaustive over DueItemKind (a kind added
  // later has to answer the question rather than fall through to
  // undefined), and failing loudly rather than quietly writing some other
  // column if the two ever drift apart.
  appointment: async () => ({ ok: false }),
  appointment_follow_up: markAppointmentFollowUpDoneAction,
};

/**
 * Snooze / mark-done behaviour shared by every My Day row, routed by
 * `kind` so the card and row components don't need to know which table an
 * item came from. Outcomes for a pending appointment go through
 * ResolveAppointmentDialog instead.
 */
export function useFollowUpActions(kind: DueItemKind, rowId: string) {
  const [pending, startTransition] = useTransition();

  function handleSnooze(daysToAdd: number) {
    if (!canSnooze(kind)) return;
    const snooze = SNOOZE[kind as SnoozableKind];
    startTransition(async () => {
      const result = await snooze(rowId, daysToAdd);
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

  return { pending, handleSnooze, handleMarkDone };
}
