'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setTargetAction } from './actions';

export interface TargetDefaults {
  calls_per_cycle: number;
  appts_held_per_cycle: number;
  premium_cents_per_cycle: number;
  min_calls_per_day: number;
}

/**
 * One card reproducing the workbook's gold cells (03-ui.md). `agentId` null
 * means the org default; set means a per-agent override. Insert-only: always
 * takes effect the start of the next 10-day cycle.
 */
export function TargetForm({
  agentId,
  current,
  currentGoal,
  effectiveDate,
  onSaved,
}: {
  agentId: string | null;
  current: TargetDefaults;
  currentGoal: TargetDefaults;
  effectiveDate: string;
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
        toast.success('Goal saved — applies from the next cycle');
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
          <Label htmlFor={`calls-${agentId ?? 'default'}`}>Calls Goal / Cycle</Label>
          <Input
            id={`calls-${agentId ?? 'default'}`}
            name="callsPerCycle"
            type="number"
            min={1}
            defaultValue={current.calls_per_cycle}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`appts-${agentId ?? 'default'}`}>Appts Held Goal / Cycle</Label>
          <Input
            id={`appts-${agentId ?? 'default'}`}
            name="apptsHeldPerCycle"
            type="number"
            min={1}
            defaultValue={current.appts_held_per_cycle}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`premium-${agentId ?? 'default'}`}>Premium Goal / Cycle ($)</Label>
          <Input
            id={`premium-${agentId ?? 'default'}`}
            name="premiumDollarsPerCycle"
            type="number"
            min={0}
            step="0.01"
            defaultValue={(current.premium_cents_per_cycle / 100).toFixed(2)}
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
      </div>
      <p className="text-xs text-fg-3">
        Current this cycle: {currentGoal.calls_per_cycle} calls · {currentGoal.appts_held_per_cycle} appts ·{' '}
        ${(currentGoal.premium_cents_per_cycle / 100).toFixed(2)} premium · {currentGoal.min_calls_per_day} min
        calls/day.
      </p>
      <p className="text-xs text-fg-3">
        Applies from {effectiveDate}. Past cycles keep their original goal.
      </p>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}
