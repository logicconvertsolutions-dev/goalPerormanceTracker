'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import {
  snoozeFollowUpAction,
  markFollowUpDoneAction,
  snoozeAppointmentAction,
  markAppointmentDoneAction,
} from './actions';

export type DueItemKind = 'follow_up' | 'appointment';

/** Snooze/mark-done behaviour shared by every My Day row -- follow-ups and
 * appointments due each have their own pair of actions (different columns
 * on call_logs), routed here by `kind` so the two card/row components don't
 * need to know which. */
export function useFollowUpActions(kind: DueItemKind, callLogId: string) {
  const [pending, startTransition] = useTransition();
  const snooze = kind === 'appointment' ? snoozeAppointmentAction : snoozeFollowUpAction;
  const markDone = kind === 'appointment' ? markAppointmentDoneAction : markFollowUpDoneAction;

  function handleSnooze(daysToAdd: number) {
    startTransition(async () => {
      const result = await snooze(callLogId, daysToAdd);
      if (result.ok) toast.success('Snoozed');
      else toast.error('Could not snooze — try again');
    });
  }

  function handleMarkDone() {
    startTransition(async () => {
      const result = await markDone(callLogId);
      if (result.ok) toast.success('Marked done');
      else toast.error('Could not update — try again');
    });
  }

  return { pending, handleSnooze, handleMarkDone };
}
