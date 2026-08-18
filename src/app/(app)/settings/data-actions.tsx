'use client';

import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function DataActions() {
  return (
    <div className="space-y-3">
      <div>
        <Button
          variant="secondary"
          onClick={() =>
            toast.info('Export ships in P6 — this button is a placeholder for now.')
          }
        >
          Download everything
        </Button>
        <p className="text-xs text-fg-3 mt-1">JSON and CSV of everything you&apos;ve logged.</p>
      </div>
      <div>
        <Button
          variant="destructive"
          onClick={() =>
            toast.info('Account deletion ships in P6 — this button is a placeholder for now.')
          }
        >
          Delete my account
        </Button>
        <p className="text-xs text-fg-3 mt-1">
          Deletes your contacts and notes. Your SMD keeps the anonymised daily
          counts they already saw.
        </p>
      </div>
    </div>
  );
}
