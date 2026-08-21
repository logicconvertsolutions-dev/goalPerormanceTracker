'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { nudgeAgentAction } from './actions';

export function NudgeButton({ agentId, fullName }: { agentId: string; fullName: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await nudgeAgentAction(agentId);
          if (result.ok) {
            toast.success(`Nudged ${fullName}`);
          } else {
            toast.error(result.message ?? 'Could not nudge — try again');
          }
        })
      }
    >
      Nudge
    </Button>
  );
}
