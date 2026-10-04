'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { savePendingCallAction } from '@/app/(app)/log/actions';
import { clearPendingCall, markLeftApp, readPendingCall, type PendingCall } from '@/lib/pending-call';
import { CallOutcomeDialog } from './call-outcome-dialog';

/**
 * "How did the call go?" (P34, P35). Mounted once in the app shell. When the
 * agent taps call or WhatsApp (ContactCallButtons records it), leaves the
 * app, and comes back, this asks how it went.
 *
 * - Save: the call is logged like any other (same action, same offline
 *   fallback, same "appointment set" handling).
 * - "Fill in later", ✕ or tapping outside: nothing is logged. The call
 *   waits in "Calls to finish" on My Day (pending_calls) until the agent
 *   adds the outcome -- which logs it on the day it was made -- or removes
 *   it (P35; P34 logged it straight away with no outcome).
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
  // Set once the prompt has been answered one way or another, so closing
  // the dialog afterwards doesn't also save it for later.
  const settled = useRef(false);

  const open = useCallback((pending: PendingCall) => {
    // Take it out of storage first: whatever happens next, this call is
    // prompted for once.
    clearPendingCall();
    settled.current = false;
    setCall(pending);
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

  function later() {
    if (!call || settled.current) return;
    const waiting = call;
    finish();
    savePendingCallAction({
      contactId: waiting.contactId,
      channel: waiting.channel,
      clientRequestId: waiting.requestId,
    }).then((result) => {
      if (result.ok) {
        toast('Saved for later', { description: 'Add the outcome from “Calls to finish” on My Day.' });
        router.refresh();
      } else {
        toast.error('Couldn’t save the call. Log it from the contact’s page.');
      }
    });
  }

  return (
    <CallOutcomeDialog
      call={
        call && {
          contactId: call.contactId,
          contactName: call.contactName,
          channel: call.channel,
          key: call.requestId,
        }
      }
      onSaved={saved}
      onLater={later}
      onDidNotCall={finish}
    />
  );
}
