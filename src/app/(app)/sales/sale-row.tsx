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
import { formatDisplayDate } from '@/lib/dates';
import { deleteSaleAction } from './actions';

export function SaleRow({
  id,
  saleDate,
  clientName,
  productType,
  premiumCents,
}: {
  id: string;
  saleDate: string;
  clientName: string;
  productType: string | null;
  premiumCents: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteSaleAction(id);
      if (result.ok) {
        toast.success('Sale deleted');
        router.refresh();
      } else {
        toast.error('Could not delete — try again');
      }
    });
  }

  return (
    <tr className="border-t border-line hover:bg-hover">
      <td className="px-4 py-2.5 text-fg-2">{formatDisplayDate(saleDate)}</td>
      <td className="px-4 py-2.5 text-fg font-medium">{clientName}</td>
      <td className="px-4 py-2.5 text-fg-2">{productType ?? '—'}</td>
      <td className="px-4 py-2.5 text-ok font-medium">
        ${(premiumCents / 100).toLocaleString('en-CA')}
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
              <Link href={`/sales/${id}/edit`}>Edit</Link>
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
