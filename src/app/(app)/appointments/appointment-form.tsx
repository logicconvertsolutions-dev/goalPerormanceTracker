'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ContactPicker } from '@/components/shell/contact-picker';
import { todayIso, browserTimeZone, addDays, nextMonday } from '@/lib/dates';
import { submitWithOfflineFallback } from '@/lib/offline/submit-with-fallback';
import { APPT_TYPES, APPT_STATUSES } from '@/lib/appointment-types';
import { PRODUCT_TYPES } from '@/lib/product-types';
import { createAppointmentAction, updateAppointmentAction } from './actions';
import { createSaleAction } from '../sales/actions';
import { createRecruitingLogAction } from '../recruiting/actions';

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
  onSuccess,
  onCancel,
}: {
  mode?: 'create' | 'edit';
  prefillContactName?: string;
  prefillContactId?: string;
  /** When set (e.g. inside a modal), called instead of navigating away on success/cancel. */
  onSuccess?: () => void;
  onCancel?: () => void;
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
  const [apptType, setApptType] = useState(defaultValues?.apptType ?? '');
  const [premiumDollars, setPremiumDollars] = useState(
    defaultValues ? String(defaultValues.expectedPremiumCents / 100) : '0'
  );
  const [followUpOn, setFollowUpOn] = useState(defaultValues?.followUpOn ?? '');
  const [showFollowUpPicker, setShowFollowUpPicker] = useState(false);
  // "Log as a Sale" (apptType === 'application') and "Recruited?" (apptType
  // === 'marketing_presentation') only apply to a brand-new appointment --
  // re-saving an edited one shouldn't silently create a second sale/
  // recruiting log every time, so these only render in create mode.
  const [logAsSale, setLogAsSale] = useState(false);
  const [saleProductType, setSaleProductType] = useState('');
  const [saleOtherProductType, setSaleOtherProductType] = useState('');
  const [recruited, setRecruited] = useState(false);
  // Client component -- the browser's own resolved zone is the correct
  // "what day is it right now" source here (todayIso() with no zone falls
  // back to UTC's calendar day).
  const tz = browserTimeZone();
  const apptDate = defaultValues?.apptDate ?? todayIso(tz);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!apptType) {
      toast.error('Select an appointment type.');
      return;
    }
    const formData = new FormData(e.currentTarget);
    formData.set('status', status);
    formData.set('apptType', apptType);
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

    // Reuses the same sale/recruiting-log creation actions the Sales and
    // Recruiting tabs use, rather than duplicating their insert logic here.
    // Passing along just the contact name (no id) is enough -- findOrCreateContact
    // resolves it to the exact contact the appointment action just
    // found/created via its own case-insensitive name match.
    async function createLinkedRecords() {
      const contactName = String(formData.get('contactName') || '');
      const contactId = String(formData.get('contactId') || '') || undefined;

      if (apptType === 'application' && logAsSale) {
        const saleForm = new FormData();
        saleForm.set('clientName', contactName);
        if (contactId) saleForm.set('contactId', contactId);
        saleForm.set('saleDate', apptDate);
        saleForm.set('productType', saleProductType === 'other' ? saleOtherProductType : saleProductType);
        saleForm.set('premiumCents', String(Math.round(Number(premiumDollars || 0) * 100)));
        saleForm.set('clientRequestId', crypto.randomUUID());
        const result = await createSaleAction(saleForm);
        if (result.ok) {
          toast.success('Sale logged');
        } else {
          toast.error(result.error ?? 'Could not log the sale.');
        }
      }

      if (apptType === 'marketing_presentation' && recruited) {
        const recruitForm = new FormData();
        recruitForm.set('prospectName', contactName);
        recruitForm.set('logDate', apptDate);
        recruitForm.set('status', 'recruited');
        recruitForm.set('clientRequestId', crypto.randomUUID());
        const result = await createRecruitingLogAction(recruitForm);
        if (result.ok) {
          toast.success('Recruiting log added');
        } else {
          toast.error(result.error ?? 'Could not save the recruiting log.');
        }
      }
    }

    startTransition(async () => {
      const result = await submitWithOfflineFallback('appointment', formData, createAppointmentAction);
      if (!result.ok) {
        toast.error(result.error ?? 'Could not save the appointment.');
        return;
      }
      toast.success(result.queued ? 'Saved offline — will sync when back online' : 'Appointment logged');
      if (!result.queued) await createLinkedRecords();
      onSuccess ? onSuccess() : router.push('/appointments');
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
          max={todayIso(tz)}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="status">Status</Label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger id="status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {APPT_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="apptType">Type</Label>
        <Select value={apptType} onValueChange={setApptType}>
          <SelectTrigger id="apptType">
            <SelectValue placeholder="Select a type" />
          </SelectTrigger>
          <SelectContent>
            {APPT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
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

      <div className={apptType === 'application' ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-2 gap-4'}>
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
        {apptType !== 'application' && (
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
        )}
      </div>

      {mode === 'create' && apptType === 'application' && (
        <div className="space-y-3 rounded-sm border border-line-2 p-3">
          <div className="flex items-center gap-3">
            <Checkbox
              id="logAsSale"
              checked={logAsSale}
              onCheckedChange={(v) => setLogAsSale(v === true)}
            />
            <Label htmlFor="logAsSale" className="font-medium text-fg">
              Log as a Sale
            </Label>
          </div>
          {logAsSale && (
            <div className="space-y-1.5">
              <Label htmlFor="saleProductType">Product type</Label>
              <Select value={saleProductType} onValueChange={setSaleProductType}>
                <SelectTrigger id="saleProductType">
                  <SelectValue placeholder="Select a product type" />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_TYPES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {saleProductType === 'other' && (
                <Input
                  value={saleOtherProductType}
                  onChange={(e) => setSaleOtherProductType(e.target.value)}
                  placeholder="Product type"
                  className="mt-1.5"
                />
              )}
            </div>
          )}
        </div>
      )}

      {mode === 'create' && apptType === 'marketing_presentation' && (
        <div className="flex items-center gap-3 rounded-sm border border-line-2 p-3">
          <Checkbox id="recruited" checked={recruited} onCheckedChange={(v) => setRecruited(v === true)} />
          <Label htmlFor="recruited" className="font-medium text-fg">
            Recruited?
          </Label>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={defaultValues?.notes ?? ''} />
      </div>

      <div className="sticky bottom-0 -mb-4 flex gap-2 border-t border-line bg-panel py-4">
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          disabled={pending}
          onClick={() => (onCancel ? onCancel() : router.back())}
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
