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
import { createRecruitingLogAction, updateRecruitingLogAction } from './actions';

const SOURCES = [
  { value: 'warm_market', label: 'Warm market' },
  { value: 'referral', label: 'Referral' },
  { value: 'cold', label: 'Cold' },
  { value: 'social_media', label: 'Social media' },
  { value: 'friend', label: 'Friend' },
  { value: 'other', label: 'Other' },
];

const STATUSES = [
  { value: 'contacted', label: 'Contacted' },
  { value: 'marketing_presented', label: 'Marketing Presented' },
  { value: 'recruited', label: 'Recruited' },
  { value: 'certified', label: 'Certified' },
  { value: 'licensed', label: 'Licensed' },
  { value: 'declined', label: 'Declined' },
];

export function RecruitingForm({
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
    prospectName?: string;
    logDate: string;
    source: string | null;
    status: string;
    notes: string | null;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(defaultValues?.status ?? 'contacted');
  const [source, setSource] = useState(defaultValues?.source ?? '');

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('status', status);
    if (source) formData.set('source', source);

    if (mode === 'edit') {
      formData.set('id', defaultValues!.id);
      startTransition(async () => {
        const result = await updateRecruitingLogAction(formData);
        if (result.ok) {
          toast.success('Recruiting log updated');
          router.push('/recruiting');
        } else {
          toast.error(result.error ?? 'Could not save.');
        }
      });
      return;
    }

    formData.set('clientRequestId', crypto.randomUUID());
    startTransition(async () => {
      const result = await submitWithOfflineFallback('recruiting', formData, createRecruitingLogAction);
      if (result.ok) {
        toast.success(result.queued ? 'Saved offline — will sync when back online' : 'Recruiting conversation logged');
        onSuccess ? onSuccess() : router.push('/recruiting');
      } else {
        toast.error(result.error ?? 'Could not save.');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {mode === 'create' && (
        <div className="space-y-1.5">
          <Label htmlFor="prospectName">Prospect name</Label>
          <Input id="prospectName" name="prospectName" placeholder="Prospect name" required />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="logDate">Date</Label>
        <Input
          id="logDate"
          name="logDate"
          type="date"
          defaultValue={defaultValues?.logDate ?? todayIso()}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="source">Source (optional)</Label>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger id="source">
            <SelectValue placeholder="Select a source" />
          </SelectTrigger>
          <SelectContent>
            {SOURCES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          onClick={() => (onCancel ? onCancel() : router.back())}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" className="flex-1" disabled={pending}>
          {pending ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Log conversation'}
        </Button>
      </div>
    </form>
  );
}
