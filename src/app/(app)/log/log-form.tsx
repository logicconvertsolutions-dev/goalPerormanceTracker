'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { addDays, nextMonday, todayIso } from '@/lib/dates';
import { submitWithOfflineFallback } from '@/lib/offline/submit-with-fallback';
import { logCallAction } from './actions';

const SOURCES = [
  { value: 'warm_market', label: 'Warm market' },
  { value: 'referral', label: 'Referral' },
  { value: 'cold', label: 'Cold' },
  { value: 'social_media', label: 'Social media' },
  { value: 'friend', label: 'Friend' },
  { value: 'other', label: 'Other' },
];

const OUTCOMES = [
  { value: 'connected', label: 'Connected' },
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'appointment_set', label: 'Appointment set' },
  { value: 'not_interested', label: 'Not interested' },
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
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-medium transition-smooth',
        active
          ? 'border-acc-line bg-acc-dim text-acc'
          : 'border-line-2 text-fg-2 hover:bg-hover hover:text-fg'
      )}
    >
      {children}
    </button>
  );
}

export function LogForm({
  defaultContactName = '',
  defaultCompany = '',
  defaultDate,
}: {
  defaultContactName?: string;
  defaultCompany?: string;
  defaultDate?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [callDate, setCallDate] = useState(defaultDate ?? todayIso());
  const [showDatePicker, setShowDatePicker] = useState(Boolean(defaultDate));
  const [source, setSource] = useState('warm_market');
  const [outcome, setOutcome] = useState('');
  const [followUpOn, setFollowUpOn] = useState('');
  const [showFollowUpPicker, setShowFollowUpPicker] = useState(false);

  const isToday = callDate === todayIso();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set('callDate', callDate);
    formData.set('source', source);
    formData.set('clientRequestId', crypto.randomUUID());
    if (followUpOn) formData.set('followUpOn', followUpOn);

    startTransition(async () => {
      const result = await submitWithOfflineFallback('call', formData, logCallAction);
      if (result.ok) {
        toast.success(result.queued ? 'Saved offline — will sync when back online' : 'Call logged');
        router.push('/today');
      } else {
        toast.error(result.error ?? 'Could not save the call.');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Date</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            active={isToday}
            onClick={() => {
              setCallDate(todayIso());
              setShowDatePicker(false);
            }}
          >
            Today
          </Chip>
          <Chip active={!isToday} onClick={() => setShowDatePicker(true)}>
            Back-date
          </Chip>
          {showDatePicker && (
            <Input
              type="date"
              value={callDate}
              max={todayIso()}
              onChange={(e) => setCallDate(e.target.value)}
              className="w-auto"
            />
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contactName">Who did you call?</Label>
        <Input
          id="contactName"
          name="contactName"
          defaultValue={defaultContactName}
          placeholder="Contact name"
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="company">Company (optional)</Label>
        <Input id="company" name="company" defaultValue={defaultCompany} />
      </div>

      <div className="space-y-1.5">
        <Label>Source</Label>
        <div className="flex flex-wrap gap-2">
          {SOURCES.map((s) => (
            <Chip key={s.value} active={source === s.value} onClick={() => setSource(s.value)}>
              {s.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="outcome">Outcome</Label>
        <Select name="outcome" value={outcome} onValueChange={setOutcome} required>
          <SelectTrigger id="outcome">
            <SelectValue placeholder="Select an outcome" />
          </SelectTrigger>
          <SelectContent>
            {OUTCOMES.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {outcome === 'connected' && (
        <div className="space-y-1.5">
          <Label>Call back on…</Label>
          <div className="flex flex-wrap gap-2">
            <Chip active={followUpOn === addDays(callDate, 1)} onClick={() => { setFollowUpOn(addDays(callDate, 1)); setShowFollowUpPicker(false); }}>
              Tomorrow
            </Chip>
            <Chip active={followUpOn === nextMonday(callDate)} onClick={() => { setFollowUpOn(nextMonday(callDate)); setShowFollowUpPicker(false); }}>
              Monday
            </Chip>
            <Chip active={followUpOn === addDays(callDate, 7)} onClick={() => { setFollowUpOn(addDays(callDate, 7)); setShowFollowUpPicker(false); }}>
              Next week
            </Chip>
            <Chip active={followUpOn === addDays(callDate, 30)} onClick={() => { setFollowUpOn(addDays(callDate, 30)); setShowFollowUpPicker(false); }}>
              1 month
            </Chip>
            <Chip active={showFollowUpPicker} onClick={() => setShowFollowUpPicker(true)}>
              Pick a date
            </Chip>
          </div>
          {showFollowUpPicker && (
            <Input
              type="date"
              value={followUpOn}
              min={callDate}
              onChange={(e) => setFollowUpOn(e.target.value)}
              className="w-auto"
            />
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" placeholder="What did you talk about?" />
      </div>

      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? 'Saving…' : 'Log call'}
      </Button>
    </form>
  );
}
