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
 * hands back name+phone pairs directly.
 */
export function ImportFromPhoneButton() {
  const router = useRouter();
  const [supported, setSupported] = useState(false);
  const [pending, startTransition] = useTransition();
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    setSupported(typeof navigator !== 'undefined' && typeof navigator.contacts?.select === 'function');
  }, []);

  function handlePick() {
    if (!supported) {
      setShowHelp(true);
      return;
    }
    startTransition(async () => {
      let picked: DeviceContact[];
      try {
        picked = await navigator.contacts!.select(['name', 'tel'], { multiple: true });
      } catch {
        // User cancelled the picker, or denied it -- not an error worth surfacing.
        return;
      }

      const contacts = picked
        .map((c) => ({ fullName: (c.name?.[0] ?? '').trim(), phone: (c.tel?.[0] ?? '').trim() }))
        .filter((c) => c.fullName && c.phone);

      if (contacts.length === 0) {
        toast.error('None of the selected contacts had both a name and a phone number.');
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
          (skipped > 0 ? ` (${skipped} skipped — missing name or phone)` : '')
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
