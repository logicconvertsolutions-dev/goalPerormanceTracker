'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LogForm } from '@/app/(app)/log/log-form';
import { fetchLogPrefillAction } from '@/app/(app)/log/actions';
import { formatDisplayDate } from '@/lib/dates';
import type { CallChannel } from '@/lib/pending-call';

export interface CallToFinish {
  contactId: string;
  contactName: string;
  channel: CallChannel;
  /** The day the call was made, when it isn't today (a waiting call). */
  callDate?: string;
  /** Set when finishing a call from "Calls to finish" (P35). */
  pendingCallId?: string;
  /** Stable per call, so the form remounts for a different one. */
  key: string;
}

/**
 * "How did the call go?" (P34/P35) -- the log form for one tap-to-call,
 * with the contact locked, the channel shown, the source taken from the
 * contact's last call and No answer suggesting a call back tomorrow.
 *
 * The caller decides what the three ways out mean:
 * - `onSaved`: the call was logged.
 * - `onLater`: "Fill in later", ✕, or tapping outside.
 * - `onDidNotCall`: "I didn't make this call".
 */
export function CallOutcomeDialog({
  call,
  onSaved,
  onLater,
  onDidNotCall,
}: {
  call: CallToFinish | null;
  onSaved: () => void;
  onLater: () => void;
  onDidNotCall: () => void;
}) {
  // undefined = still loading the contact's last source.
  const [lastSource, setLastSource] = useState<string | null | undefined>(undefined);

  // Keyed on the call, not the object: callers may build a new object for
  // the same call on every render.
  const callKey = call?.key;
  const contactId = call?.contactId;
  useEffect(() => {
    if (!callKey || !contactId) return;
    let live = true;
    setLastSource(undefined);
    fetchLogPrefillAction(contactId)
      .then((prefill) => live && setLastSource(prefill?.lastSource ?? null))
      .catch(() => live && setLastSource(null));
    return () => {
      live = false;
    };
  }, [callKey, contactId]);

  const how = call ? (call.channel === 'whatsapp' ? 'WhatsApp' : 'Phone') : '';
  const when = call?.callDate ? ` · ${formatDisplayDate(call.callDate)}` : '';

  return (
    <Dialog open={call !== null} onOpenChange={(isOpen) => !isOpen && onLater()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>How did the call go?</DialogTitle>
          <DialogDescription>{call ? `${how} call with ${call.contactName}${when}` : ''}</DialogDescription>
        </DialogHeader>
        {call && lastSource !== undefined && (
          <LogForm
            key={call.key}
            defaultContactName={call.contactName}
            defaultContactId={call.contactId}
            defaultDate={call.callDate}
            channel={call.channel}
            lockContact
            defaultSource={lastSource}
            suggestFollowUp
            pendingCallId={call.pendingCallId}
            cancelLabel="Fill in later"
            onSuccess={onSaved}
            onCancel={onLater}
          />
        )}
        {call && lastSource === undefined && <p className="py-6 text-center text-sm text-fg-3">Loading…</p>}
        {call && (
          <button
            type="button"
            onClick={onDidNotCall}
            className="mx-auto block pt-1 text-xs font-semibold text-fg-3 hover:text-fg hover:underline"
          >
            I didn’t make this call
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
