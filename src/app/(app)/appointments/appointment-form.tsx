'use client';

import { useRef, useState, useTransition } from 'react';
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
import { ContactPicker } from '@/components/shell/contact-picker';
import { todayIso, browserTimeZone, addDays, isoToLocalParts, nextMonday } from '@/lib/dates';
import { submitWithOfflineFallback } from '@/lib/offline/submit-with-fallback';
import { APPT_TYPES, APPT_STATUSES } from '@/lib/appointment-types';
import { PRODUCT_TYPES } from '@/lib/product-types';
import { createAppointmentAction, updateAppointmentAction } from './actions';
import { ResolveAppointmentDialog } from './resolve-appointment-dialog';
import { createSaleAction, syncSaleFromAppointmentAction, deleteSaleAction } from '../sales/actions';
import {
  createRecruitingLogAction,
  syncRecruitingLogFromAppointmentAction,
  deleteRecruitingLogAction,
} from '../recruiting/actions';

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
    contactId?: string;
    contactName?: string;
    apptDate: string;
    apptType: string | null;
    status: string;
    expectedPremiumCents: number;
    referralsGiven: number;
    notes: string | null;
    followUpOn?: string | null;
    appointmentAt?: string | null;
    /** P25 Phase B's immutable slot. Preferred over appointmentAt. */
    scheduledFor?: string | null;
    /** A sale/recruiting log this appointment already spawned via the
     * toggles below (sales/recruiting_logs.appointment_id) -- editing here
     * updates that record instead of creating a second one. */
    linkedSaleId?: string;
    linkedSaleProductType?: string | null;
    linkedRecruitingLogId?: string;
    /** Set when this appointment was rescheduled into a successor. */
    rescheduledToId?: string | null;
  };
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  // D1: a reschedule books a successor at a new time, which a status field
  // cannot ask for. So Rescheduled is offered only where it can work, and
  // behaves the same as the /appointments list picker:
  //   - a pending appointment being edited: choosing it opens the
  //     new-time picker (the resolve dialog), and the save happens there;
  //   - an appointment already rescheduled: shown as its own status;
  //   - a new appointment: not offered -- there is nothing yet to move.
  // An appointment already moved to a successor is locked to Rescheduled:
  // the successor is the live one, and the server refuses to reopen it.
  const movedToSuccessor = defaultValues?.status === 'rescheduled' && Boolean(defaultValues?.rescheduledToId);
  const canReschedule = mode === 'edit' && defaultValues?.status === 'scheduled';
  const statusOptions = movedToSuccessor
    ? APPT_STATUSES.filter((s) => s.value === 'rescheduled')
    : APPT_STATUSES.filter(
        (s) => s.value !== 'rescheduled' || canReschedule || defaultValues?.status === 'rescheduled'
      );
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [status, setStatus] = useState(defaultValues?.status ?? 'scheduled');
  const [apptType, setApptType] = useState(defaultValues?.apptType ?? '');
  const [premiumDollars, setPremiumDollars] = useState(
    defaultValues ? String(defaultValues.expectedPremiumCents / 100) : '0'
  );
  const [followUpOn, setFollowUpOn] = useState(defaultValues?.followUpOn ?? '');
  const [showFollowUpPicker, setShowFollowUpPicker] = useState(false);
  // The slot this appointment is for, when status is "Scheduled".
  //
  // F6: this used to fall back to TODAY whenever the row had no
  // appointment_at -- which is every imported row, and every row resolved
  // before Phase B. Opening such an appointment to fix a typo in its notes
  // and saving silently moved it to today, because appt_date is derived
  // from these inputs. It now falls back to the row's own appt_date and
  // only reaches for today when there is genuinely nothing to fall back to
  // (a brand-new appointment).
  //
  // `scheduledFor` is preferred over `appointmentAt`: Phase B's identity
  // trigger guarantees it survives resolution, which appointment_at does
  // not (F8).
  const persistedSlot = defaultValues?.scheduledFor ?? defaultValues?.appointmentAt ?? null;
  const defaultAppointment = persistedSlot ? isoToLocalParts(persistedSlot) : null;
  const [appointmentDate, setAppointmentDate] = useState(
    defaultAppointment?.date ?? defaultValues?.apptDate ?? todayIso(browserTimeZone())
  );
  const [appointmentTime, setAppointmentTime] = useState(defaultAppointment?.time ?? '');
  // "Log as a Sale" (apptType === 'application') and "Recruited?" (apptType
  // === 'marketing_presentation'). Pre-checked in edit mode when this
  // appointment already has a linked sale/recruiting log, so re-saving
  // updates that record rather than looking like a fresh, unchecked toggle.
  const [logAsSale, setLogAsSale] = useState(Boolean(defaultValues?.linkedSaleId));
  const knownSaleProductType = PRODUCT_TYPES.some((p) => p.value === defaultValues?.linkedSaleProductType);
  const [saleProductType, setSaleProductType] = useState(
    defaultValues?.linkedSaleProductType
      ? knownSaleProductType
        ? defaultValues.linkedSaleProductType
        : 'other'
      : ''
  );
  const [saleOtherProductType, setSaleOtherProductType] = useState(
    defaultValues?.linkedSaleProductType && !knownSaleProductType ? defaultValues.linkedSaleProductType : ''
  );
  const [recruited, setRecruited] = useState(Boolean(defaultValues?.linkedRecruitingLogId));
  // Gates the save when the current edit would sever an existing link
  // (type changed away from the type that created it, or its toggle got
  // unchecked) -- confirmed here rather than deleting silently.
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Client component -- the browser's own resolved zone is the correct
  // "what day is it right now" source here (todayIso() with no zone falls
  // back to UTC's calendar day).
  const tz = browserTimeZone();
  const today = todayIso(tz);
  // A "Scheduled" row's stored apptDate can be a future date (it's derived
  // from the slot) -- clamp to today for the plain "Date" field's initial
  // value if the status gets changed away from "Scheduled" here, since
  // that field's own `max` is today and a future defaultValue would start
  // it invalid.
  const initialApptDate =
    defaultValues?.apptDate && defaultValues.apptDate <= today ? defaultValues.apptDate : today;
  // F15: the Date field is uncontrolled, so its rendered default is NOT
  // what the agent may have just typed into it. syncLinkedRecords used to
  // read the constant above and stamp a linked sale with the date the page
  // happened to load with -- change the appointment's date and save, and
  // the sale silently kept the old one. The submitted value is read at
  // save time instead, from the form.
  const [apptDate, setApptDate] = useState(initialApptDate);

  const willDeleteSale = Boolean(defaultValues?.linkedSaleId) && !(apptType === 'application' && logAsSale);
  const willDeleteRecruit =
    Boolean(defaultValues?.linkedRecruitingLogId) && !(apptType === 'marketing_presentation' && recruited);

  // Reuses the same sale/recruiting-log creation, update, and delete actions
  // the Sales and Recruiting tabs use, rather than duplicating that logic
  // here. Passing along just the contact name (no id) when creating a new
  // linked record is enough -- findOrCreateContact resolves it to the exact
  // contact the appointment itself is already logged against.
  async function syncLinkedRecords(
    appointmentId: string,
    contactName: string,
    contactId: string | undefined,
    // F15: passed in from save(), read off the form at submit time. Taking
    // it from the render-time constant meant a linked sale kept whatever
    // date the page loaded with, even when the agent had just changed the
    // appointment's date in the field above it.
    linkedDate: string
  ) {
    if (apptType === 'application' && logAsSale) {
      const saleForm = new FormData();
      saleForm.set('saleDate', linkedDate);
      saleForm.set('productType', saleProductType === 'other' ? saleOtherProductType : saleProductType);
      saleForm.set('premiumCents', String(Math.round(Number(premiumDollars || 0) * 100)));
      if (defaultValues?.linkedSaleId) {
        saleForm.set('id', defaultValues.linkedSaleId);
        const result = await syncSaleFromAppointmentAction(saleForm);
        if (!result.ok) toast.error(result.error ?? 'Could not update the linked sale.');
      } else {
        saleForm.set('clientName', contactName);
        if (contactId) saleForm.set('contactId', contactId);
        saleForm.set('appointmentId', appointmentId);
        saleForm.set('clientRequestId', crypto.randomUUID());
        const result = await createSaleAction(saleForm);
        if (result.ok) {
          toast.success('Sale logged');
        } else {
          toast.error(result.error ?? 'Could not log the sale.');
        }
      }
    } else if (defaultValues?.linkedSaleId) {
      const result = await deleteSaleAction(defaultValues.linkedSaleId);
      if (!result.ok) toast.error('Could not delete the linked sale.');
    }

    if (apptType === 'marketing_presentation' && recruited) {
      if (defaultValues?.linkedRecruitingLogId) {
        const recruitForm = new FormData();
        recruitForm.set('id', defaultValues.linkedRecruitingLogId);
        recruitForm.set('logDate', linkedDate);
        recruitForm.set('status', 'recruited');
        const result = await syncRecruitingLogFromAppointmentAction(recruitForm);
        if (!result.ok) toast.error(result.error ?? 'Could not update the linked recruiting log.');
      } else {
        const recruitForm = new FormData();
        recruitForm.set('prospectName', contactName);
        recruitForm.set('logDate', linkedDate);
        recruitForm.set('status', 'recruited');
        recruitForm.set('appointmentId', appointmentId);
        recruitForm.set('clientRequestId', crypto.randomUUID());
        const result = await createRecruitingLogAction(recruitForm);
        if (result.ok) {
          toast.success('Recruiting log added');
        } else {
          toast.error(result.error ?? 'Could not save the recruiting log.');
        }
      }
    } else if (defaultValues?.linkedRecruitingLogId) {
      const result = await deleteRecruitingLogAction(defaultValues.linkedRecruitingLogId);
      if (!result.ok) toast.error('Could not delete the linked recruiting log.');
    }
  }

  function save() {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    formData.set('status', status);
    formData.set('apptType', apptType);
    if (status === 'scheduled') {
      formData.set('appointmentAt', new Date(`${appointmentDate}T${appointmentTime}`).toISOString());
    }
    // F7: this used to be in the `else` branch only, so a SCHEDULED
    // appointment could never carry a premium -- and Open Pipeline sums
    // exactly the scheduled ones, which is why it read $0 on every
    // dashboard in the product except for imported rows. The input is now
    // shown for both, and submitted for both.
    formData.set('expectedPremiumCents', String(Math.round(Number(premiumDollars || 0) * 100)));
    // F14: the day the booking was made, from the client's own calendar.
    // An offline submission replayed three days later otherwise takes the
    // sync day as its set_on and lands Appts Set on the wrong day. The
    // server clamps this -- it is a claim from the browser, not a fact.
    formData.set('bookedOn', today);
    if (NEEDS_FOLLOW_UP_STATUSES.has(status) && followUpOn) {
      formData.set('followUpOn', followUpOn);
    }

    // The date a linked sale or recruiting log inherits: the appointment's
    // own date as submitted. A scheduled appointment has no past date to
    // give (and cannot have produced a sale yet), so it falls back to
    // today -- which the linked actions would have used anyway.
    const linkedDate = status === 'scheduled' ? today : String(formData.get('apptDate') || apptDate);

    if (mode === 'edit') {
      formData.set('id', defaultValues!.id);
      startTransition(async () => {
        const result = await updateAppointmentAction(formData);
        if (!result.ok) {
          toast.error(result.error ?? 'Could not save the appointment.');
          return;
        }
        toast.success('Appointment updated');
        await syncLinkedRecords(
          defaultValues!.id,
          defaultValues?.contactName ?? '',
          defaultValues?.contactId,
          linkedDate
        );
        router.push('/appointments');
      });
      return;
    }

    formData.set('clientRequestId', crypto.randomUUID());
    startTransition(async () => {
      const result = await submitWithOfflineFallback('appointment', formData, createAppointmentAction);
      if (!result.ok) {
        toast.error(result.error ?? 'Could not save the appointment.');
        return;
      }
      toast.success(result.queued ? 'Saved offline — will sync when back online' : 'Appointment logged');
      if (!result.queued && result.id) {
        const contactName = String(formData.get('contactName') || '');
        const contactId = String(formData.get('contactId') || '') || undefined;
        await syncLinkedRecords(result.id, contactName, contactId, linkedDate);
      }
      onSuccess ? onSuccess() : router.push('/appointments');
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!apptType) {
      toast.error('Select an appointment type.');
      return;
    }
    if (willDeleteSale || willDeleteRecruit) {
      setShowDeleteConfirm(true);
      return;
    }
    save();
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      {mode === 'create' && (
        <ContactPicker
          label="Who is this with?"
          defaultName={prefillContactName ?? ''}
          defaultId={prefillContactId ?? ''}
        />
      )}
      {mode === 'edit' && defaultValues?.contactName && (
        <div className="space-y-1.5">
          <Label>Who</Label>
          <p className="text-sm text-fg">{defaultValues.contactName}</p>
        </div>
      )}

      {status === 'scheduled' ? (
        <div className="space-y-1.5">
          <Label htmlFor="appointmentDate">Appointment date &amp; time</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="appointmentDate"
              type="date"
              value={appointmentDate}
              onChange={(e) => setAppointmentDate(e.target.value)}
              className="w-auto"
              required
            />
            <Input
              id="appointmentTime"
              type="time"
              value={appointmentTime}
              onChange={(e) => setAppointmentTime(e.target.value)}
              className="w-auto"
              required
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="apptDate">Date</Label>
          <Input
            id="apptDate"
            name="apptDate"
            type="date"
            value={apptDate}
            onChange={(e) => setApptDate(e.target.value)}
            max={today}
            required
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="status">Status</Label>
        <Select
          value={status}
          disabled={movedToSuccessor}
          onValueChange={(next) => {
            if (next === 'rescheduled' && canReschedule) {
              setRescheduleOpen(true);
              return;
            }
            setStatus(next);
          }}
        >
          <SelectTrigger id="status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((s) => (
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

      {/* Expected premium is asked for at every status (F7). On a
          SCHEDULED appointment it is the opportunity's size -- the whole
          input to Open Pipeline -- and hiding it here is what made that
          dashboard tile structurally $0. Referrals only make sense once
          the meeting has happened, so that half stays behind a resolved
          status. */}
      <div
        className={
          status === 'scheduled' || apptType === 'application'
            ? 'grid grid-cols-1 gap-4'
            : 'grid grid-cols-2 gap-4'
        }
      >
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
          {status === 'scheduled' && (
            <p className="text-xs text-fg-3">What this is worth if it closes — feeds Open Pipeline.</p>
          )}
        </div>
        {status !== 'scheduled' && apptType !== 'application' && (
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

      {apptType === 'application' && (
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
          {defaultValues?.linkedSaleId && (
            <p className="text-xs text-fg-3">
              {logAsSale
                ? 'Already logged — saving here updates that sale.'
                : 'Unchecking this deletes the sale already logged from this appointment.'}
            </p>
          )}
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

      {apptType === 'marketing_presentation' && (
        <div className="space-y-1.5 rounded-sm border border-line-2 p-3">
          <div className="flex items-center gap-3">
            <Checkbox id="recruited" checked={recruited} onCheckedChange={(v) => setRecruited(v === true)} />
            <Label htmlFor="recruited" className="font-medium text-fg">
              Recruited?
            </Label>
          </div>
          {defaultValues?.linkedRecruitingLogId && (
            <p className="text-xs text-fg-3">
              {recruited
                ? 'Already logged — saving here updates that recruiting log.'
                : 'Unchecking this deletes the recruiting log already created from this appointment.'}
            </p>
          )}
        </div>
      )}

      {mode === 'edit' && (willDeleteSale || willDeleteRecruit) && (
        <p className="text-xs text-bad">
          Saving will delete the linked {willDeleteSale && willDeleteRecruit ? 'sale and recruiting log' : willDeleteSale ? 'sale' : 'recruiting log'} — you&apos;ll be asked to confirm.
        </p>
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

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete the linked {willDeleteSale && willDeleteRecruit ? 'sale and recruiting log' : willDeleteSale ? 'sale' : 'recruiting log'}?
            </DialogTitle>
            <DialogDescription>
              {willDeleteSale && 'This appointment created a sale, which will be permanently deleted. '}
              {willDeleteRecruit && 'This appointment created a recruiting log, which will be permanently deleted. '}
              This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setShowDeleteConfirm(false);
                save();
              }}
            >
              {pending ? 'Saving…' : 'Delete and save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {canReschedule && (
        <ResolveAppointmentDialog
          mode={rescheduleOpen ? 'rescheduled' : null}
          appointmentId={defaultValues!.id}
          contactName={defaultValues?.contactName ?? ''}
          onOpenChange={(open) => !open && setRescheduleOpen(false)}
          // The original is now terminal and the new appointment is the
          // live one, so this form is editing a row that just ended.
          onResolved={() => router.push('/appointments')}
        />
      )}
    </form>
  );
}
