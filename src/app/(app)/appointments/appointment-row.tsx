'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MoreVertical } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDisplayDate } from '@/lib/dates';
import { deleteAppointmentAction, updateAppointmentStatusAction } from './actions';

const STATUSES = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'held', label: 'Held' },
  { value: 'no_show', label: 'No-show' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

export function AppointmentRow({
  id,
  apptDate,
  apptType,
  status,
  expectedPremiumCents,
  referralsGiven,
  contactName,
}: {
  id: string;
  apptDate: string;
  apptType: string | null;
  status: string;
  expectedPremiumCents: number;
  referralsGiven: number;
  contactName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleStatusChange(next: string) {
    startTransition(async () => {
      const result = await updateAppointmentStatusAction(id, next as (typeof STATUSES)[number]['value']);
      if (!result.ok) toast.error('Could not update status — try again');
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteAppointmentAction(id);
      if (result.ok) {
        toast.success('Appointment deleted');
        router.refresh();
      } else {
        toast.error('Could not delete — try again');
      }
    });
  }

  return (
    <tr className="border-t border-line hover:bg-hover">
      <td className="px-4 py-2.5 text-fg-2">{formatDisplayDate(apptDate)}</td>
      <td className="px-4 py-2.5 text-fg font-medium">{contactName}</td>
      <td className="px-4 py-2.5 text-fg-2">{apptType ?? '—'}</td>
      <td className="px-4 py-2.5">
        <Select value={status} onValueChange={handleStatusChange} disabled={pending}>
          <SelectTrigger className="h-8 w-36">
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
              <Link href={`/appointments/${id}/edit`}>Edit</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDelete} className="text-bad">
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
