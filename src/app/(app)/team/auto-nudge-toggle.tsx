'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { setAutoCallNudgesAction } from './actions';

export function AutoNudgeToggle({
  agentId,
  fullName,
  initialEnabled,
}: {
  agentId: string;
  fullName: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    const next = !enabled;
    const prev = enabled;
    setEnabled(next);
    startTransition(async () => {
      const result = await setAutoCallNudgesAction(agentId, next);
      if (!result.ok) {
        setEnabled(prev);
        toast.error(result.message ?? 'Could not update — try again');
      } else {
        toast.success(next ? `Daily reminders on for ${fullName}` : `Daily reminders off for ${fullName}`);
      }
    });
  }

  return (
    <Button
      variant={enabled ? 'soft' : 'ghost'}
      size="sm"
      disabled={pending}
      onClick={handleClick}
      title="Automatically remind this associate to log calls every weekday evening until they're logging again"
    >
      Daily reminders: {enabled ? 'On' : 'Off'}
    </Button>
  );
}
