'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setTargetAction } from './actions';

export interface TargetDefaults {
  calls_per_week: number;
  appts_held_per_week: number;
  premium_cents_per_week: number;
  min_calls_per_day: number;
  md_deadline: string | null;
}

/**
 * One card reproducing the workbook's gold cells (03-ui.md). `agentId` null
 * means the org default; set means a per-agent override. Insert-only: always
 * takes effect the coming Monday.
 */
export function TargetForm({
  agentId,
  current,
  effectiveMonday,
  onSaved,
}: {
  agentId: string | null;
  current: TargetDefaults;
  effectiveMonday: string;
  onSaved?: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    if (agentId) formData.set('agentId', agentId);

    startTransition(async () => {
      const result = await setTargetAction(formData);
      if (result.ok) {
        toast.success('Target saved — applies from Monday');
        onSaved?.();
      } else {
        toast.error(result.error ?? 'Could not save — try again');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`calls-${agentId ?? 'default'}`}>Calls Target / Wk</Label>
          <Input
            id={`calls-${agentId ?? 'default'}`}
            name="callsPerWeek"
            type="number"
            min={1}
            defaultValue={current.calls_per_week}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`appts-${agentId ?? 'default'}`}>Appts Held Target / Wk</Label>
          <Input
            id={`appts-${agentId ?? 'default'}`}
            name="apptsHeldPerWeek"
            type="number"
            min={1}
            defaultValue={current.appts_held_per_week}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`premium-${agentId ?? 'default'}`}>Premium Target / Wk ($)</Label>
          <Input
            id={`premium-${agentId ?? 'default'}`}
            name="premiumDollarsPerWeek"
            type="number"
            min={0}
            step="0.01"
            defaultValue={(current.premium_cents_per_week / 100).toFixed(2)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`min-calls-${agentId ?? 'default'}`}>Min Calls / Day</Label>
          <Input
            id={`min-calls-${agentId ?? 'default'}`}
            name="minCallsPerDay"
            type="number"
            min={1}
            defaultValue={current.min_calls_per_day}
            required
          />
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label htmlFor={`md-deadline-${agentId ?? 'default'}`}>MD Deadline</Label>
          <Input
            id={`md-deadline-${agentId ?? 'default'}`}
            name="mdDeadline"
            type="date"
            defaultValue={current.md_deadline ?? ''}
          />
        </div>
      </div>
      <p className="text-xs text-fg-3">
        Applies from Monday, {effectiveMonday}. Past weeks keep their original target.
      </p>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}
