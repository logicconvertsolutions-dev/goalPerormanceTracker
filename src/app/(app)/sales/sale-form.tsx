'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { todayIso } from '@/lib/dates';
import { submitWithOfflineFallback } from '@/lib/offline/submit-with-fallback';
import { createSaleAction, updateSaleAction } from './actions';

export function SaleForm({
  mode = 'create',
  defaultValues,
}: {
  mode?: 'create' | 'edit';
  defaultValues?: {
    id: string;
    clientName?: string;
    saleDate: string;
    productType: string | null;
    premiumCents: number;
    notes: string | null;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [premiumDollars, setPremiumDollars] = useState(
    defaultValues ? String(defaultValues.premiumCents / 100) : '0'
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('premiumCents', String(Math.round(Number(premiumDollars || 0) * 100)));

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
        router.push('/sales');
      } else {
        toast.error(result.error ?? 'Could not save the sale.');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {mode === 'create' && (
        <div className="space-y-1.5">
          <Label htmlFor="clientName">Client name</Label>
          <Input id="clientName" name="clientName" placeholder="Client name" required />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="saleDate">Date</Label>
        <Input
          id="saleDate"
          name="saleDate"
          type="date"
          defaultValue={defaultValues?.saleDate ?? todayIso()}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="productType">Product type (optional)</Label>
        <Input
          id="productType"
          name="productType"
          defaultValue={defaultValues?.productType ?? ''}
          placeholder="Universal Life"
        />
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
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={defaultValues?.notes ?? ''} />
      </div>

      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Log sale'}
      </Button>
    </form>
  );
}
