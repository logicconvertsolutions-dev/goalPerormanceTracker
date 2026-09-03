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
import { createSaleAction, updateSaleAction } from './actions';

const PRODUCT_TYPES = [
  { value: 'universal_life', label: 'Universal Life' },
  { value: 'term_life', label: 'Term Life' },
  { value: 'critical_illness', label: 'Critical Illness' },
  { value: 'disability', label: 'Disability' },
  { value: 'other', label: 'Other' },
];

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

export function SaleForm({
  mode = 'create',
  defaultValues,
  onSuccess,
  onCancel,
}: {
  mode?: 'create' | 'edit';
  /** When set (e.g. inside a modal), called instead of navigating away on success/cancel. */
  onSuccess?: () => void;
  onCancel?: () => void;
  defaultValues?: {
    id: string;
    clientName?: string;
    saleDate: string;
    productType: string | null;
    premiumCents: number;
    notes: string | null;
    followUpOn?: string | null;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [premiumDollars, setPremiumDollars] = useState(
    defaultValues ? String(defaultValues.premiumCents / 100) : '0'
  );
  const knownProductType = PRODUCT_TYPES.some((p) => p.value === defaultValues?.productType);
  const [productType, setProductType] = useState(
    defaultValues?.productType ? (knownProductType ? defaultValues.productType : 'other') : ''
  );
  const [otherProductType, setOtherProductType] = useState(
    defaultValues?.productType && !knownProductType ? defaultValues.productType : ''
  );
  const [followUpOn, setFollowUpOn] = useState(defaultValues?.followUpOn ?? '');
  const [showFollowUpPicker, setShowFollowUpPicker] = useState(false);
  // Client component -- the browser's own resolved zone is the correct
  // "what day is it right now" source here (todayIso() with no zone falls
  // back to UTC's calendar day). Same trick as time-zone-select.tsx.
  const browserTimeZone =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const saleDate = defaultValues?.saleDate ?? todayIso(browserTimeZone);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('premiumCents', String(Math.round(Number(premiumDollars || 0) * 100)));
    formData.set('productType', productType === 'other' ? otherProductType : productType);
    if (followUpOn) formData.set('followUpOn', followUpOn);

    if (mode === 'edit') {
      formData.set('id', defaultValues!.id);
      startTransition(async () => {
        const result = await updateSaleAction(formData);
        if (result.ok) {
          toast.success('Sale updated');
          router.push('/sales');
        } else {
          toast.error(result.error ?? 'Could not save the sale.');
        }
      });
      return;
    }

    formData.set('clientRequestId', crypto.randomUUID());
    startTransition(async () => {
      const result = await submitWithOfflineFallback('sale', formData, createSaleAction);
      if (result.ok) {
        toast.success(result.queued ? 'Saved offline — will sync when back online' : 'Sale logged');
        onSuccess ? onSuccess() : router.push('/sales');
      } else {
        toast.error(result.error ?? 'Could not save the sale.');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {mode === 'create' && <ContactPicker label="Client name" fieldName="clientName" />}

      <div className="space-y-1.5">
        <Label htmlFor="saleDate">Date</Label>
        <Input
          id="saleDate"
          name="saleDate"
          type="date"
          defaultValue={saleDate}
          max={todayIso(browserTimeZone)}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="productType">Product type</Label>
        <Select value={productType} onValueChange={setProductType}>
          <SelectTrigger id="productType">
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
        {productType === 'other' && (
          <Input
            value={otherProductType}
            onChange={(e) => setOtherProductType(e.target.value)}
            placeholder="Product type"
            className="mt-1.5"
          />
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="premiumDollars">Premium ($)</Label>
        <Input
          id="premiumDollars"
          type="number"
          min={0}
          step={1}
          value={premiumDollars}
          onChange={(e) => setPremiumDollars(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Follow up on… (optional)</Label>
        <div className="flex flex-wrap gap-2">
          <Chip active={followUpOn === addDays(saleDate, 1)} onClick={() => { setFollowUpOn(addDays(saleDate, 1)); setShowFollowUpPicker(false); }}>
            Tomorrow
          </Chip>
          <Chip active={followUpOn === nextMonday(saleDate)} onClick={() => { setFollowUpOn(nextMonday(saleDate)); setShowFollowUpPicker(false); }}>
            Monday
          </Chip>
          <Chip active={followUpOn === addDays(saleDate, 30)} onClick={() => { setFollowUpOn(addDays(saleDate, 30)); setShowFollowUpPicker(false); }}>
            1 month
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
            min={saleDate}
            onChange={(e) => setFollowUpOn(e.target.value)}
            className="w-auto"
          />
        )}
      </div>

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
          {pending ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Log sale'}
        </Button>
      </div>
    </form>
  );
}
