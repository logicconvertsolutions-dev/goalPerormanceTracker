'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LogForm } from '@/app/(app)/log/log-form';
import { fetchLogPrefillAction, logCallAttemptAction } from '@/app/(app)/log/actions';
import {
  clearPendingCall,
  markLeftApp,
  readPendingCall,
  type PendingCall,
} from '@/lib/pending-call';

/**
 * "How did the call go?" (P34). Mounted once in the app shell. When the
 * agent taps call or WhatsApp (ContactCallButtons records it), leaves the
 * app, and comes back, this opens the log form for that contact with the
 * channel already filled in.
 *
 * - Save: the call is logged like any other (same action, same offline
 *   fallback, same "appointment set" handling).
 * - Close it any other way ("Fill in later", ✕, tap outside): the attempt is
 *   still saved, with no outcome -- "Outcome needed" on My Day and on the
 *   contact until they finish it.
 * - "I didn't make this call": nothing is saved (a mis-tap, a cancelled
 *   dialer).
 *
 * Detection is best effort: `visibilitychange` doesn't fire the same way on
 * every phone and browser (iOS can show its own "Call?" sheet without hiding
 * the page, desktop may have no dialer at all). The contact page's
 * "Log a call" button is the fallback.
 */
export function CallLogPrompt() {
  const router = useRouter();
  const [call, setCall] = useState<PendingCall | null>(null);
  const [lastSource, setLastSource] = useState<string | null | undefined>(undefined);
  // Set once the prompt has been answered one way or another, so closing
  // the dialog afterwards doesn't also save an attempt.
  const settled = useRef(false);

  const open = useCallback((pending: PendingCall) => {
    // Take it out of storage first: whatever happens next, this call is
    // prompted for once.
    clearPendingCall();
    settled.current = false;
    setLastSource(undefined);
    setCall(pending);
    fetchLogPrefillAction(pending.contactId)
      .then((prefill) => setLastSource(prefill?.lastSource ?? null))
      .catch(() => setLastSource(null));
  }, []);

  useEffect(() => {
    // A fresh page load with a call still pending that they left the app
    // for: the browser reloaded the page while the agent was in the dialer.
    // (Leaving is recorded on visibilitychange/pagehide, which fire before
    // the page is frozen or unloaded.)
    const pending = readPendingCall();
    if (pending?.leftApp) open(pending);

    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        markLeftApp();
        return;
      }
      const back = readPendingCall();
      if (back?.leftApp) open(back);
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', markLeftApp);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', markLeftApp);
    };
  }, [open]);

  function finish() {
    settled.current = true;
    setCall(null);
  }

  function saved() {
    finish();
    router.refresh();
  }

  function dismiss() {
    if (!call || settled.current) return;
    const attempt = call;
    finish();
    logCallAttemptAction({
      contactId: attempt.contactId,
      channel: attempt.channel,
      clientRequestId: attempt.requestId,
    }).then((result) => {
      if (result.ok) {
        toast('Call saved — add the outcome when you’re ready', {
          description: 'It’s under “Calls needing an outcome” on My Day.',
        });
        router.refresh();
      } else {
        toast.error('Couldn’t save the call. Log it from the contact’s page.');
      }
    });
  }

  function didNotCall() {
    finish();
  }

  return (
    <Dialog open={call !== null} onOpenChange={(isOpen) => !isOpen && dismiss()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>How did the call go?</DialogTitle>
          <DialogDescription>
            {call ? `${call.channel === 'whatsapp' ? 'WhatsApp' : 'Phone'} call with ${call.contactName}` : ''}
          </DialogDescription>
        </DialogHeader>
        {call && lastSource !== undefined && (
          <LogForm
            key={call.requestId}
            defaultContactName={call.contactName}
            defaultContactId={call.contactId}
            channel={call.channel}
            lockContact
            defaultSource={lastSource}
            suggestFollowUp
            cancelLabel="Fill in later"
            onSuccess={saved}
            onCancel={dismiss}
          />
        )}
        {call && lastSource === undefined && <p className="py-6 text-center text-sm text-fg-3">Loading…</p>}
        {call && (
          <button
            type="button"
            onClick={didNotCall}
            className="mx-auto block pt-1 text-xs font-semibold text-fg-3 hover:text-fg hover:underline"
          >
            I didn’t make this call
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
