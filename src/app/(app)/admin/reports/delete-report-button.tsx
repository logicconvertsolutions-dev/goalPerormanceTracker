'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { deleteReportDefinitionAction } from './actions';

export function DeleteReportButton({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-bad hover:text-bad"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await deleteReportDefinitionAction({ id });
          if (result.ok) toast.success(`${name} deleted`);
          else toast.error(result.error ?? 'Could not delete — try again');
        })
      }
    >
      Delete
    </Button>
  );
}
