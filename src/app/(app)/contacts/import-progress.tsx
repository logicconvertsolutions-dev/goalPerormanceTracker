'use client';

import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { batchContacts } from '@/lib/import/batch-contacts';
import { importDeviceContactsAction } from './actions';

export interface ImportTotals {
  created: number;
  existing: number;
  failed: number;
  skipped: number;
}

type DeviceContact = Parameters<typeof importDeviceContactsAction>[0][number];

/**
 * Sends contacts to importDeviceContactsAction in as few calls as the body
 * limit allows (lib/import/batch-contacts.ts), reporting progress after each.
 * Stops at the first call that fails, returning what earlier calls saved.
 */
export async function importContacts(
  contacts: DeviceContact[],
  onProgress: (done: number) => void
): Promise<{ totals: ImportTotals; error: string | null }> {
  const totals: ImportTotals = { created: 0, existing: 0, failed: 0, skipped: 0 };
  let done = 0;
  for (const batch of batchContacts(contacts)) {
    const outcome = await importDeviceContactsAction(batch);
    if (!outcome.ok) return { totals, error: outcome.error };
    totals.created += outcome.created;
    totals.existing += outcome.existing;
    totals.failed += outcome.failed;
    totals.skipped += outcome.skipped;
    done += batch.length;
    onProgress(done);
  }
  return { totals, error: null };
}

/** "Imported 120 new contacts · 30 already in your contacts · 2 failed" */
export function importSummary(totals: ImportTotals, extraSkipped = 0): string {
  const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  const parts = [`Imported ${plural(totals.created, 'new contact')}`];
  if (totals.existing > 0) parts.push(`${totals.existing.toLocaleString()} already in your contacts`);
  const skipped = totals.skipped + extraSkipped;
  if (skipped > 0) parts.push(`${skipped.toLocaleString()} skipped (no name)`);
  if (totals.failed > 0) parts.push(`${totals.failed.toLocaleString()} failed`);
  return parts.join(' · ');
}

/**
 * Blocking progress dialog for an import. It can't be dismissed while open:
 * closing it wouldn't stop the import, and an agent who thinks it stalled and
 * starts another only burns the hourly import limit.
 */
export function ImportProgressDialog({ status }: { status: { title: string; detail: string } | null }) {
  return (
    <Dialog open={status !== null}>
      <DialogContent
        className="[&>button:last-child]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-acc" aria-hidden="true" />
            {status?.title}
          </DialogTitle>
          <DialogDescription>{status?.detail}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

/** Progress copy shared by both import buttons. */
export function importingStatus(done: number, total: number): { title: string; detail: string } {
  return {
    title: `Importing ${total.toLocaleString()} contact${total === 1 ? '' : 's'}…`,
    detail:
      done > 0
        ? `${done.toLocaleString()} of ${total.toLocaleString()} done. Keep this screen open.`
        : 'This can take up to a minute for a large list. Keep this screen open.',
  };
}
