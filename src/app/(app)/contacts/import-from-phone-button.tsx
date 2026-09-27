'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { phoneFromDevice } from '@/lib/phone';
import { importDeviceContactsAction } from './actions';

// Not yet in lib.dom.d.ts -- the Contact Picker API. Shipped by default on
// Android Chrome/Edge; WebKit has an experimental implementation too (behind
// Settings -> Safari -> Advanced -> Feature Flags -> "Contact Picker API",
// off by default) so a small slice of iOS users may have it on. No desktop
// browser supports it. See https://developer.mozilla.org/en-US/docs/Web/API/Contact_Picker_API.
interface DeviceContact {
  name?: string[];
  tel?: string[];
}
interface ContactsManager {
  select(properties: string[], options?: { multiple?: boolean }): Promise<DeviceContact[]>;
  getProperties?(): Promise<string[]>;
}
declare global {
  interface Navigator {
    contacts?: ContactsManager;
  }
}

/**
 * Always visible -- feature-detected against the actual method being called
 * (not a Chromium-specific global like `window.ContactsManager`), so it also
 * picks up WebKit's flag-gated implementation on the iOS devices that have
 * it on. On a browser that doesn't support the Contact Picker API, clicking
 * shows how to turn it on instead of silently doing nothing (the previous
 * behavior hid the button entirely, which looked like a bug rather than an
 * unsupported browser). No file, no template: the OS's own contact picker
 * hands back the name and (P33) phone numbers of only the contacts the agent
 * ticks -- the browser never exposes the rest of the address book. The first
 * number is kept, normalised to E.164 (a local North American number becomes
 * +1); one that can't be placed is dropped and the contact comes in by name.
 */
export function ImportFromPhoneButton() {
  const router = useRouter();
  const [supported, setSupported] = useState(false);
  const [pending, startTransition] = useTransition();
  const [showHelp, setShowHelp] = useState(false);
  const [showNotice, setShowNotice] = useState(false);

  useEffect(() => {
    setSupported(typeof navigator !== 'undefined' && typeof navigator.contacts?.select === 'function');
  }, []);

  function handlePick() {
    if (!supported) {
      setShowHelp(true);
      return;
    }
    // Say what gets saved, and who sees it, before anything is collected.
    setShowNotice(true);
  }

  // Runs from the notice's button: the picker needs a fresh tap to open.
  function runPicker() {
    setShowNotice(false);
    startTransition(async () => {
      let picked: DeviceContact[];
      try {
        // Ask for tel only where the picker offers it; an unsupported
        // property makes select() throw.
        const available = (await navigator.contacts!.getProperties?.()) ?? ['name', 'tel'];
        const properties = available.includes('tel') ? ['name', 'tel'] : ['name'];
        picked = await navigator.contacts!.select(properties, { multiple: true });
      } catch {
        // User cancelled the picker, or denied it -- not an error worth surfacing.
        return;
      }

      const contacts = picked
        .map((c) => ({ fullName: (c.name?.[0] ?? '').trim(), phoneNumber: phoneFromDevice(c.tel?.[0]) }))
        .filter((c) => c.fullName);
      const withNumber = contacts.filter((c) => c.phoneNumber).length;

      if (contacts.length === 0) {
        toast.error('None of the selected contacts had a name.');
        return;
      }

      const result = await importDeviceContactsAction(contacts);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const skipped = picked.length - contacts.length;
      toast.success(
        `Imported ${result.imported} contact${result.imported === 1 ? '' : 's'} from your phone` +
          (withNumber > 0 ? `, ${withNumber} with a phone number` : '') +
          (skipped > 0 ? ` (${skipped} skipped — missing name)` : '')
      );
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" disabled={pending} onClick={handlePick}>
        <Smartphone className="h-4 w-4" aria-hidden="true" />
        {pending ? 'Importing…' : 'Import from phone'}
      </Button>

      <Dialog open={showNotice} onOpenChange={setShowNotice}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import from your phone</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>
                  Your phone will ask which contacts to share. Only the ones you tick are imported —
                  Kautis never sees the rest of your address book.
                </p>
                <p>
                  For each one we save the <strong>name</strong> and <strong>first phone number</strong>.
                  They are visible only to you, never to your SMD or anyone else in your organization.
                </p>
                <p>
                  Only import people you have a reason to contact for your business. See the{' '}
                  <a href="/privacy" className="text-acc hover:underline">
                    privacy notice
                  </a>
                  .
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNotice(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={runPicker}>
              Choose contacts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn on contact import</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>Your browser doesn&apos;t have the contact picker turned on yet.</p>
                <p>
                  <strong>Android (Chrome or Edge):</strong> supported by default — try updating your
                  browser to the latest version and try again.
                </p>
                <p>
                  <strong>iPhone/iPad (Safari):</strong> go to Settings → Safari → Advanced → Feature
                  Flags → turn on &quot;Contact Picker API&quot;, then come back and try again.
                </p>
                <p>
                  <strong>Desktop browsers</strong> don&apos;t support this yet — use &quot;Import from
                  Excel&quot; or &quot;Add contact&quot; instead.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="primary" onClick={() => setShowHelp(false)}>
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
