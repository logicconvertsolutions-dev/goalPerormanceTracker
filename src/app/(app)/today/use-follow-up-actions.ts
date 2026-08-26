'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { snoozeFollowUpAction, markFollowUpDoneAction } from './actions';

/** Snooze/mark-done behaviour shared by every follow-up row on My Day
 * (the featured "Next up" card and the plain rows below it). */
export function useFollowUpActions(callLogId: string) {
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

  return { pending, handleSnooze, handleMarkDone };
}
