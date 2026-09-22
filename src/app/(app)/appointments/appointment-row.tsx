'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MoreVertical } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDisplayDate } from '@/lib/dates';
import { apptTypeLabel, APPT_STATUSES } from '@/lib/appointment-types';
import { withReturnTo } from '@/lib/return-to';
import {
  appointmentDeleteImpactAction,
  deleteAppointmentAction,
  updateAppointmentStatusAction,
} from './actions';
import { ResolveAppointmentDialog, type ResolveMode } from './resolve-appointment-dialog';

interface DeleteImpact {
  saleId: string | null;
  salePremiumCents: number;
  recruitingLogId: string | null;
}

function isResolveMode(value: string): value is ResolveMode {
  return value === 'held' || value === 'no_show' || value === 'cancelled' || value === 'rescheduled';
}

export function AppointmentRow({
  id,
  apptDate,
  apptType,
  status,
  movedToSuccessor = false,
  returnTo,
  expectedPremiumCents,
  referralsGiven,
  contactName,
}: {
  id: string;
  apptDate: string;
  apptType: string | null;
  status: string;
  /** Rescheduled into a successor: the successor is the live appointment,
   * so this row's status is final and the picker is locked. Offering the
   * other statuses here only produced a server refusal. */
  movedToSuccessor?: boolean;
  /** The list this row is on, so Edit → Save comes back to it. */
  returnTo: string;
  expectedPremiumCents: number;
  referralsGiven: number;
  contactName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [resolveMode, setResolveMode] = useState<ResolveMode | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<DeleteImpact | null>(null);

  function handleStatusChange(next: string) {
    // Recording an outcome on a pending appointment routes through the
    // same dialog My Day uses, rather than setting a bare status here:
    // every outcome confirms the day it happened (2026-09-22), Held also
    // captures what the meeting produced, and a reschedule creates a
    // successor row (D1). Doing it in two places differently is how F8
    // happened.
    //
    // A change between two outcomes on an already-resolved row is a
    // correction of the same event, keeps its day, and stays one step.
    if (status === 'scheduled' && isResolveMode(next)) {
      setResolveMode(next);
      return;
    }
    startTransition(async () => {
      const result = await updateAppointmentStatusAction(id, next as (typeof APPT_STATUSES)[number]['value']);
      if (!result.ok) toast.error(result.error ?? 'Could not update status — try again');
    });
  }

  // F16: find out what a delete would take with it BEFORE doing it. The FK
  // is ON DELETE SET NULL, so the default behaviour is to silently orphan
  // a sale that keeps counting toward sales_count and premium_cents with
  // nothing in this UI pointing at it any more.
  function handleDeleteClick() {
    startTransition(async () => {
      const impact = await appointmentDeleteImpactAction(id);
      if (!impact.saleId && !impact.recruitingLogId) {
        const result = await deleteAppointmentAction(id);
        if (result.ok) {
          toast.success('Appointment deleted');
          router.refresh();
        } else {
          toast.error('Could not delete — try again');
        }
        return;
      }
      setDeleteImpact(impact);
    });
  }

  function confirmDelete(deleteLinked: boolean) {
    startTransition(async () => {
      const result = await deleteAppointmentAction(id, deleteLinked);
      setDeleteImpact(null);
      if (result.ok) {
        toast.success(deleteLinked ? 'Appointment and linked records deleted' : 'Appointment deleted');
        router.refresh();
      } else {
        toast.error(result.error ?? 'Could not delete — try again');
      }
    });
  }

  const linkedLabel =
    deleteImpact?.saleId && deleteImpact?.recruitingLogId
      ? 'a sale and a recruiting log'
      : deleteImpact?.saleId
        ? 'a sale'
        : 'a recruiting log';

  return (
    <tr className="border-t border-line hover:bg-hover">
      <td className="px-4 py-2.5 text-fg-2">{formatDisplayDate(apptDate)}</td>
      <td className="px-4 py-2.5 text-fg font-medium">{contactName}</td>
      <td className="px-4 py-2.5 text-fg-2">{apptTypeLabel(apptType) ?? '—'}</td>
      <td className="px-4 py-2.5">
        <Select value={status} onValueChange={handleStatusChange} disabled={pending || movedToSuccessor}>
          <SelectTrigger className="h-8 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {APPT_STATUSES.filter(
              // Rescheduled is reachable only from a pending row, where it
              // opens the picker for the new time (D1). From any other status
              // there is no successor to book, so it isn't offered.
              (s) => s.value !== 'rescheduled' || status === 'scheduled' || status === 'rescheduled'
            ).map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-4 py-2.5 text-fg-2">
        {expectedPremiumCents > 0 ? `$${(expectedPremiumCents / 100).toLocaleString('en-CA')}` : '—'}
      </td>
      <td className="px-4 py-2.5 text-fg-2">{referralsGiven > 0 ? referralsGiven : '—'}</td>
      <td className="px-4 py-2.5 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" disabled={pending} aria-label="Row actions">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={withReturnTo(`/appointments/${id}/edit`, returnTo)}>Edit</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDeleteClick} className="text-bad">
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ResolveAppointmentDialog
          mode={resolveMode}
          appointmentId={id}
          contactName={contactName}
          onOpenChange={(open) => !open && setResolveMode(null)}
        />

        <Dialog open={deleteImpact !== null} onOpenChange={(open) => !open && setDeleteImpact(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>This appointment created {linkedLabel}</DialogTitle>
              <DialogDescription>
                {deleteImpact?.saleId ? (
                  <>
                    Deleting the appointment on its own leaves that sale
                    {deleteImpact.salePremiumCents > 0 && (
                      <> — ${(deleteImpact.salePremiumCents / 100).toLocaleString('en-CA')} of premium</>
                    )}{' '}
                    counting toward your numbers, reachable from Sales but no longer linked to anything here.{' '}
                  </>
                ) : (
                  <>
                    Deleting the appointment on its own leaves that recruiting log counting toward your numbers,
                    no longer linked to anything here.{' '}
                  </>
                )}
                Keep it if it really happened. Delete it if the appointment was logged in error.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setDeleteImpact(null)}>
                Cancel
              </Button>
              <Button type="button" variant="secondary" disabled={pending} onClick={() => confirmDelete(false)}>
                Keep {deleteImpact?.saleId && deleteImpact?.recruitingLogId ? 'them' : 'it'}
              </Button>
              <Button type="button" variant="destructive" disabled={pending} onClick={() => confirmDelete(true)}>
                Delete both
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  );
}
