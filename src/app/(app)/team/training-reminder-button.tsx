'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { sendTrainingReminderAction } from './actions';

export function TrainingReminderButton({ agentId, fullName }: { agentId: string; fullName: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await sendTrainingReminderAction(agentId);
          if (result.ok) {
            toast.success(`Training reminder sent to ${fullName}`);
          } else {
            toast.error(result.message ?? 'Could not send reminder — try again');
          }
        })
      }
    >
      Training reminder
    </Button>
  );
}
