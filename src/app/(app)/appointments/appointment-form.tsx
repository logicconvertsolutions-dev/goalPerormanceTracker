'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ContactPicker } from '@/components/shell/contact-picker';
import { todayIso, addDays, nextMonday } from '@/lib/dates';
import { submitWithOfflineFallback } from '@/lib/offline/submit-with-fallback';
import { createAppointmentAction, updateAppointmentAction } from './actions';

const STATUSES = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'held', label: 'Held' },
  { value: 'no_show', label: 'No-show' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'cancelled', label: 'Cancelled' },
];

// Statuses that describe an appointment that's done but may need another
// touch — held/no-show/rescheduled/cancelled can all need a follow-up call;
// "scheduled" doesn't (it's already the pending item).
const NEEDS_FOLLOW_UP_STATUSES = new Set(['held', 'no_show', 'rescheduled', 'cancelled']);

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-full border border-acc-line bg-acc-dim px-3 py-1.5 text-xs font-medium text-acc transition-smooth'
          : 'rounded-full border border-line-2 px-3 py-1.5 text-xs font-medium text-fg-2 transition-smooth hover:bg-hover hover:text-fg'
      }
    >
      {children}
    </button>
  );
}

export function AppointmentForm({
  mode = 'create',
  defaultValues,
  prefillContactName,
  prefillContactId,
}: {
  mode?: 'create' | 'edit';
  prefillContactName?: string;
  prefillContactId?: string;
  defaultValues?: {
    id: string;
    contactName?: string;
    apptDate: string;
    apptType: string | null;
    status: string;
    expectedPremiumCents: number;
    referralsGiven: number;
    notes: string | null;
    followUpOn?: string | null;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(defaultValues?.status ?? 'scheduled');
  const [premiumDollars, setPremiumDollars] = useState(
    defaultValues ? String(defaultValues.expectedPremiumCents / 100) : '0'
  );
  const [followUpOn, setFollowUpOn] = useState(defaultValues?.followUpOn ?? '');
  const [showFollowUpPicker, setShowFollowUpPicker] = useState(false);
  const apptDate = defaultValues?.apptDate ?? todayIso();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('status', status);
    formData.set('expectedPremiumCents', String(Math.round(Number(premiumDollars || 0) * 100)));
    if (NEEDS_FOLLOW_UP_STATUSES.has(status) && followUpOn) {
      formData.set('followUpOn', followUpOn);
    }

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
        <ContactPicker
          label="Who is this with?"
          defaultName={prefillContactName ?? ''}
          defaultId={prefillContactId ?? ''}
        />
      )}

      <div className="space-y-1.5">
        <Label htmlFor="apptDate">Date</Label>
        <Input
          id="apptDate"
          name="apptDate"
          type="date"
          defaultValue={apptDate}
          max={todayIso()}
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

      {NEEDS_FOLLOW_UP_STATUSES.has(status) && (
        <div className="space-y-1.5">
          <Label>Needs another follow-up?</Label>
          <div className="flex flex-wrap gap-2">
            <Chip active={followUpOn === addDays(apptDate, 1)} onClick={() => { setFollowUpOn(addDays(apptDate, 1)); setShowFollowUpPicker(false); }}>
              Tomorrow
            </Chip>
            <Chip active={followUpOn === nextMonday(apptDate)} onClick={() => { setFollowUpOn(nextMonday(apptDate)); setShowFollowUpPicker(false); }}>
              Monday
            </Chip>
            <Chip active={followUpOn === addDays(apptDate, 7)} onClick={() => { setFollowUpOn(addDays(apptDate, 7)); setShowFollowUpPicker(false); }}>
              Next week
            </Chip>
            <Chip active={showFollowUpPicker} onClick={() => setShowFollowUpPicker(true)}>
              Pick a date
            </Chip>
            {followUpOn && (
              <Chip active={false} onClick={() => { setFollowUpOn(''); setShowFollowUpPicker(false); }}>
                Clear
              </Chip>
            )}
          </div>
          {showFollowUpPicker && (
            <Input
              type="date"
              value={followUpOn}
              min={apptDate}
              onChange={(e) => setFollowUpOn(e.target.value)}
              className="w-auto"
            />
          )}
        </div>
      )}

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

      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          disabled={pending}
          onClick={() => router.back()}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" className="flex-1" disabled={pending}>
          {pending ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Log appointment'}
        </Button>
      </div>
    </form>
  );
}
