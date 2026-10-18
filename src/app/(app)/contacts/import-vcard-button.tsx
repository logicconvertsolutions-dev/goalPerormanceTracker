'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { parseVCard, type VCardParseResult } from '@/lib/import/parse-vcard';
import { ImportPrivacyNotice } from './import-privacy-notice';
import { ImportProgressDialog, importContacts, importSummary, importingStatus } from './import-progress';

/**
 * Bulk import from a vCard (.vcf) export -- the fast path on Android, whose
 * browser contact picker only ticks contacts one at a time. The file is read
 * and parsed in the browser (see lib/import/parse-vcard.ts for why); only
 * names and normalised numbers are sent, through the same Server Action the
 * phone picker uses, so matching by name and "never overwrite an existing
 * number" behave identically.
 */
export function ImportVCardButton() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<VCardParseResult | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ title: string; detail: string } | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so picking the same file again still fires change
    if (!file) return;

    // A big export (photos included) can take a few seconds to read; say so
    // instead of showing nothing until the confirm dialog appears.
    setStatus({ title: 'Reading file…', detail: `${file.name} — this can take a few seconds for a large file.` });
    let result: VCardParseResult;
    try {
      // Let the dialog paint before the parse ties up the main thread.
      await new Promise((resolve) => setTimeout(resolve, 50));
      result = parseVCard(await file.text());
    } catch {
      toast.error('Could not read that file. Is it a .vcf contacts export?');
      return;
    } finally {
      setStatus(null);
    }
    if (result.contacts.length === 0) {
      toast.error(
        result.skippedNoName > 0
          ? 'None of the contacts in that file had a name.'
          : 'No contacts found in that file. Is it a .vcf contacts export?'
      );
      return;
    }
    setParsed(result);
  }

  function runImport(result: VCardParseResult) {
    setParsed(null);
    startTransition(async () => {
      const total = result.contacts.length;
      setStatus(importingStatus(0, total));
      const { totals, error } = await importContacts(result.contacts, (done) => setStatus(importingStatus(done, total)));
      setStatus(null);
      if (error) {
        toast.error(totals.created + totals.existing > 0 ? `${error} (${importSummary(totals)} before this.)` : error);
      } else {
        const message = importSummary(totals);
        if (totals.failed > 0) toast.warning(message);
        else toast.success(message);
      }
      router.refresh();
    });
  }

  const withNumber = parsed?.contacts.filter((c) => c.phoneNumber).length ?? 0;
  const withNotes = parsed?.contacts.filter((c) => c.notes).length ?? 0;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".vcf,.vcard,text/vcard,text/x-vcard"
        className="hidden"
        onChange={handleFile}
      />
      <ImportProgressDialog status={status} />
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => setShowHelp(true)}>
        <FileUp className="h-4 w-4" aria-hidden="true" />
        {pending ? 'Importing…' : 'Import .vcf file'}
      </Button>

      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import a contacts file (.vcf)</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>The quickest way to bring in many contacts at once.</p>
                <p>
                  <strong>Android:</strong> open the Contacts app → menu → <em>Fix &amp; manage</em> (or{' '}
                  <em>Manage contacts</em>) → <em>Export to file</em>. Then come back and choose that .vcf
                  file.
                </p>
                <p>
                  <strong>iPhone:</strong> in Contacts, open a list, tap and hold it → <em>Export</em>, and
                  save the file to Files.
                </p>
                <p>You&apos;ll see how many contacts were found before anything is saved.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowHelp(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setShowHelp(false);
                inputRef.current?.click();
              }}
            >
              Choose file
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={parsed !== null} onOpenChange={(open) => !open && setParsed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Import {parsed?.contacts.length} contact{parsed?.contacts.length === 1 ? '' : 's'}?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>
                  {withNumber} with a phone number{withNotes > 0 ? `, ${withNotes} with notes` : ''}.
                  {parsed && parsed.droppedNumbers > 0 &&
                    ` ${parsed.droppedNumbers} had a number without a country code that we couldn't place — those come in by name only.`}
                  {parsed && parsed.skippedNoName > 0 &&
                    ` ${parsed.skippedNoName} without a name will be skipped.`}{' '}
                  Contacts you already have are matched by name and never duplicated, and an existing
                  number or notes are never replaced.
                </p>
                <ImportPrivacyNotice withNotes />
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setParsed(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => parsed && runImport(parsed)}>
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
