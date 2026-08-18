'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { todayIso } from '@/lib/dates';
import { submitWithOfflineFallback } from '@/lib/offline/submit-with-fallback';
import { createAppointmentAction, updateAppointmentAction } from './actions';

const STATUSES = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'held', label: 'Held' },
  { value: 'no_show', label: 'No-show' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function AppointmentForm({
  mode = 'create',
  defaultValues,
  prefillContactName,
  prefillCompany,
}: {
  mode?: 'create' | 'edit';
  prefillContactName?: string;
  prefillCompany?: string;
  defaultValues?: {
    id: string;
    contactName?: string;
    company?: string;
    apptDate: string;
    apptType: string | null;
    status: string;
    expectedPremiumCents: number;
    referralsGiven: number;
    notes: string | null;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(defaultValues?.status ?? 'scheduled');
  const [premiumDollars, setPremiumDollars] = useState(
    defaultValues ? String(defaultValues.expectedPremiumCents / 100) : '0'
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('status', status);
    formData.set('expectedPremiumCents', String(Math.round(Number(premiumDollars || 0) * 100)));

    if (mode === 'edit') {
      formData.set('id', defaultValues!.id);
      startTransition(async () => {
        const result = await updateAppointmentAction(formData);
        if (result.ok) {
          toast.success('Appointment updated');
          router.push('/appointments');
        } else {
          toast.error(result.error ?? 'Could not save the appointment.');
        }
      });
      return;
    }

    formData.set('clientRequestId', crypto.randomUUID());
    startTransition(async () => {
      const result = await submitWithOfflineFallback('appointment', formData, createAppointmentAction);
      if (result.ok) {
        toast.success(result.queued ? 'Saved offline — will sync when back online' : 'Appointment logged');
        router.push('/appointments');
      } else {
        toast.error(result.error ?? 'Could not save the appointment.');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {mode === 'create' && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="contactName">Who is this with?</Label>
            <Input
              id="contactName"
              name="contactName"
              defaultValue={prefillContactName ?? ''}
              placeholder="Contact name"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company">Company (optional)</Label>
            <Input id="company" name="company" defaultValue={prefillCompany ?? ''} />
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="apptDate">Date</Label>
        <Input
          id="apptDate"
          name="apptDate"
          type="date"
          defaultValue={defaultValues?.apptDate ?? todayIso()}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="apptType">Type (optional)</Label>
        <Input
          id="apptType"
          name="apptType"
          defaultValue={defaultValues?.apptType ?? ''}
          placeholder="Initial meeting"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="status">Status</Label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger id="status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="expectedPremiumDollars">Expected premium ($)</Label>
          <Input
            id="expectedPremiumDollars"
            type="number"
            min={0}
            step={1}
            value={premiumDollars}
            onChange={(e) => setPremiumDollars(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="referralsGiven">Referrals given</Label>
          <Input
            id="referralsGiven"
            name="referralsGiven"
            type="number"
            min={0}
            step={1}
            defaultValue={defaultValues?.referralsGiven ?? 0}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={defaultValues?.notes ?? ''} />
      </div>

      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Log appointment'}
      </Button>
    </form>
  );
}
