'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { APPT_TYPES } from '@/lib/appointment-types';
import { PRODUCT_TYPES } from '@/lib/product-types';
import { browserTimeZone, isoToLocalParts, todayIso } from '@/lib/dates';
import {
  appointmentResolveDefaultsAction,
  resolveAppointmentHeldAction,
  rescheduleAppointmentAction,
} from './actions';

/**
 * The two outcomes that need more than a tap (P25 Phase C2).
 *
 * No-show and Cancelled stay one tap on the row that owns them — there is
 * nothing to ask. These two are different:
 *
 *   held        the appointment happened, so there is now a premium, a
 *               referral count, notes, and possibly a sale
 *   rescheduled per decision D1 this TERMINATES the appointment and creates
 *               a successor, so it needs the new slot
 *
 * Built on Dialog rather than a bottom sheet: the app has no sheet
 * primitive and rule 11 says no new dependency without asking. On a phone
 * this renders as a centred modal, which is the same treatment the
 * appointment form's own delete confirmation already uses.
 */
export type ResolveMode = 'held' | 'rescheduled';

interface Defaults {
  apptType: string | null;
  expectedPremiumCents: number;
  referralsGiven: number;
  notes: string | null;
  scheduledFor: string | null;
  apptDate: string;
}

export function ResolveAppointmentDialog({
  mode,
  appointmentId,
  contactName,
  onOpenChange,
  onResolved,
}: {
  /** null closes the dialog; setting it opens in that mode. */
  mode: ResolveMode | null;
  appointmentId: string;
  contactName: string;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save, before the router refresh. */
  onResolved?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [defaults, setDefaults] = useState<Defaults | null>(null);

  const [apptType, setApptType] = useState('');
  const [premiumDollars, setPremiumDollars] = useState('0');
  const [referrals, setReferrals] = useState('0');
  const [notes, setNotes] = useState('');
  const [logAsSale, setLogAsSale] = useState(false);
  const [saleProductType, setSaleProductType] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');

  const tz = browserTimeZone();

  // Loaded when the dialog opens rather than passed down, so My Day and
  // /appointments can both raise it from a row that knows only an id.
  useEffect(() => {
    if (!mode) return;
    let cancelled = false;
    setLoading(true);
    appointmentResolveDefaultsAction(appointmentId)
      .then((d) => {
        if (cancelled || !d) return;
        setDefaults(d);
        setApptType(d.apptType ?? '');
        setPremiumDollars(String(d.expectedPremiumCents / 100));
        setReferrals(String(d.referralsGiven));
        setNotes(d.notes ?? '');
        setLogAsSale(false);
        // Prefill the picker with the slot it is moving FROM, so the agent
        // adjusts a date rather than re-entering one. Never today for a
        // row that has a real date — that is the F6 mistake.
        const slot = d.scheduledFor ? isoToLocalParts(d.scheduledFor) : null;
        setNewDate(slot?.date ?? d.apptDate ?? todayIso(tz));
        setNewTime(slot?.time ?? '');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, appointmentId, tz]);

  function close() {
    onOpenChange(false);
  }

  function submitHeld() {
    if (!apptType) {
      toast.error('Select an appointment type.');
      return;
    }
    const formData = new FormData();
    formData.set('id', appointmentId);
    formData.set('apptType', apptType);
    formData.set('expectedPremiumCents', String(Math.round(Number(premiumDollars || 0) * 100)));
    formData.set('referralsGiven', String(Math.max(0, Math.round(Number(referrals || 0)))));
    if (notes.trim()) formData.set('notes', notes.trim());
    if (apptType === 'application' && logAsSale) {
      formData.set('logAsSale', 'true');
      if (saleProductType) formData.set('saleProductType', saleProductType);
    }

    startTransition(async () => {
      const result = await resolveAppointmentHeldAction(formData);
      if (!result.ok) {
        toast.error(result.error ?? 'Could not save the outcome.');
        return;
      }
      if (result.saleWarning) {
        // The outcome saved; the sale did not. Say both, and still close --
        // leaving the sheet open over a recorded outcome invites recording
        // it twice.
        toast.warning(`Marked held, but the sale could not be logged: ${result.saleWarning}`);
      } else {
        toast.success(logAsSale && apptType === 'application' ? 'Marked held, sale logged' : 'Marked held');
      }
      close();
      onResolved?.();
      router.refresh();
    });
  }

  function submitReschedule() {
    if (!newDate || !newTime) {
      toast.error('Pick the new date and time.');
      return;
    }
    const formData = new FormData();
    formData.set('id', appointmentId);
    formData.set('scheduledFor', new Date(`${newDate}T${newTime}`).toISOString());

    startTransition(async () => {
      const result = await rescheduleAppointmentAction(formData);
      if (!result.ok) {
        toast.error(result.error ?? 'Could not reschedule.');
        return;
      }
      toast.success('Rescheduled — the new appointment is in your queue');
      close();
      onResolved?.();
      router.refresh();
    });
  }

  const isHeld = mode === 'held';

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isHeld ? `How did it go with ${contactName}?` : `Move ${contactName}’s appointment`}</DialogTitle>
          <DialogDescription>
            {isHeld
              ? 'Recorded against today — this is the day the outcome was logged, not the day the appointment was for.'
              : 'This appointment closes as Rescheduled and a new one is created for the new time. Both stay on the record, so the rebooking counts as the work it was.'}
          </DialogDescription>
        </DialogHeader>

        {loading || !defaults ? (
          <p className="py-6 text-sm text-fg-3">Loading…</p>
        ) : isHeld ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="resolveApptType">Type</Label>
              <Select value={apptType} onValueChange={setApptType}>
                <SelectTrigger id="resolveApptType">
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="resolvePremium">Expected premium ($)</Label>
                <Input
                  id="resolvePremium"
                  type="number"
                  min={0}
                  step={1}
                  value={premiumDollars}
                  onChange={(e) => setPremiumDollars(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="resolveReferrals">Referrals given</Label>
                <Input
                  id="resolveReferrals"
                  type="number"
                  min={0}
                  step={1}
                  value={referrals}
                  onChange={(e) => setReferrals(e.target.value)}
                />
              </div>
            </div>

            {apptType === 'application' && (
              <div className="space-y-3 rounded-sm border border-line-2 p-3">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="resolveLogAsSale"
                    checked={logAsSale}
                    onCheckedChange={(v) => setLogAsSale(v === true)}
                  />
                  <Label htmlFor="resolveLogAsSale" className="font-medium text-fg">
                    Log as a Sale
                  </Label>
                </div>
                {logAsSale && (
                  <div className="space-y-1.5">
                    <Label htmlFor="resolveProductType">Product type</Label>
                    <Select value={saleProductType} onValueChange={setSaleProductType}>
                      <SelectTrigger id="resolveProductType">
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
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="resolveNotes">Notes</Label>
              <Textarea id="resolveNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="rescheduleDate">New date &amp; time</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="rescheduleDate"
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-auto"
              />
              <Input
                id="rescheduleTime"
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="w-auto"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={pending || loading || !defaults}
            onClick={isHeld ? submitHeld : submitReschedule}
          >
            {pending ? 'Saving…' : isHeld ? 'Mark held' : 'Reschedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
