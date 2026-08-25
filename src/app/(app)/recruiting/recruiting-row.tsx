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
import { deleteRecruitingLogAction, updateRecruitingStatusAction } from './actions';

const STATUSES = [
  { value: 'contacted', label: 'Contacted' },
  { value: 'marketing_presented', label: 'Marketing Presented' },
  { value: 'recruited', label: 'Recruited' },
  { value: 'certified', label: 'Certified' },
  { value: 'licensed', label: 'Licensed' },
  { value: 'declined', label: 'Declined' },
] as const;

export function RecruitingRow({
  id,
  logDate,
  prospectName,
  source,
  status,
}: {
  id: string;
  logDate: string;
  prospectName: string;
  source: string | null;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleStatusChange(next: string) {
    startTransition(async () => {
      const result = await updateRecruitingStatusAction(id, next as (typeof STATUSES)[number]['value']);
      if (!result.ok) toast.error('Could not update status — try again');
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteRecruitingLogAction(id);
      if (result.ok) {
        toast.success('Recruiting log deleted');
        router.refresh();
      } else {
        toast.error('Could not delete — try again');
      }
    });
  }

  return (
    <tr className="border-t border-line hover:bg-hover">
      <td className="px-4 py-2.5 text-fg-2">{formatDisplayDate(logDate)}</td>
      <td className="px-4 py-2.5 text-fg font-medium">{prospectName}</td>
      <td className="px-4 py-2.5 text-fg-2">{source ? source.replace('_', ' ') : '—'}</td>
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
      <td className="px-4 py-2.5 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" disabled={pending} aria-label="Row actions">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/recruiting/${id}/edit`}>Edit</Link>
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
