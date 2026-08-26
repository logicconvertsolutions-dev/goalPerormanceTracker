'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MoreVertical } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDisplayDate } from '@/lib/dates';
import { deleteCallAction } from './actions';

export function CallRow({
  id,
  callDate,
  contactName,
  source,
  outcome,
  notes,
}: {
  id: string;
  callDate: string;
  contactName: string;
  source: string;
  outcome: string;
  notes: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteCallAction(id);
      if (result.ok) {
        toast.success('Call deleted');
        router.refresh();
      } else {
        toast.error('Could not delete — try again');
      }
    });
  }

  return (
    <tr className="border-t border-line hover:bg-hover">
      <td className="px-4 py-2.5 text-fg-2">{formatDisplayDate(callDate)}</td>
      <td className="px-4 py-2.5 text-fg font-medium">{contactName}</td>
      <td className="px-4 py-2.5 text-fg-2">{source.replace('_', ' ')}</td>
      <td className="px-4 py-2.5">
        <Badge variant="neutral">{outcome.replace('_', ' ')}</Badge>
      </td>
      <td className="px-4 py-2.5 text-fg-3 max-w-[16rem] truncate">{notes ?? '—'}</td>
      <td className="px-4 py-2.5 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" disabled={pending} aria-label="Row actions">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/log/${id}/edit`}>Edit</Link>
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
