'use client';

import { useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { saveReportDefinitionAction } from './actions';
import type { ReportTypeId } from '@/lib/reports/report-types';

export function SaveReportDialog({
  reportType,
  columns,
}: {
  reportType: ReportTypeId;
  columns: string[];
}) {
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');

  return (
    <Dialog onOpenChange={(open) => !open && setName('')}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Save this report
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save report</DialogTitle>
          <DialogDescription>
            Saves the report type, filters, and column selection, so it re-runs against live data
            each time you load it back — not a snapshot of today&apos;s rows.
          </DialogDescription>
        </DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Report name" />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              disabled={pending || !name.trim()}
              onClick={() =>
                startTransition(async () => {
                  const result = await saveReportDefinitionAction({
                    name: name.trim(),
                    reportType,
                    filters: {
                      org: searchParams.get('org') ?? undefined,
                      period: searchParams.get('period') ?? undefined,
                      from: searchParams.get('from') ?? undefined,
                      to: searchParams.get('to') ?? undefined,
                    },
                    columns,
                  });
                  if (result.ok) toast.success('Report saved');
                  else toast.error(result.error ?? 'Could not save — try again');
                })
              }
            >
              Save
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
