'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { MessageCircle, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDisplayDate } from '@/lib/dates';
import { deletePendingCallAction } from '@/app/(app)/log/actions';
import type { CallChannel } from '@/lib/pending-call';
import { CallOutcomeDialog, type CallToFinish } from './call-outcome-dialog';

export interface WaitingCall {
  id: string;
  contact_id: string;
  channel: string;
  call_date: string;
  contacts: { full_name: string } | null;
}

/**
 * "Calls to finish" (P35): tap-to-calls the agent chose to fill in later.
 * Each one is either finished -- Add outcome logs it on the day it was made
 * and removes it from here -- or removed with "I didn't make this call",
 * which leaves no trace. Until then it is not a call anywhere: not in Calls
 * logged, Activity Logs or the SMD's totals.
 *
 * `showContact` is off on a contact's own page, where every row is them.
 */
export function CallsToFinish({
  calls,
  total,
  showContact = true,
  className,
}: {
  calls: WaitingCall[];
  total: number;
  showContact?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [finishing, setFinishing] = useState<CallToFinish | null>(null);
  const [removing, startRemoving] = useTransition();

  if (total === 0) return null;

  function remove(id: string) {
    setFinishing(null);
    startRemoving(async () => {
      const result = await deletePendingCallAction(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Removed');
      router.refresh();
    });
  }

  return (
    <section
      className={cn('rounded-lg border border-warn/40 bg-warn-dim/40 p-4 shadow-card', className)}
      aria-label="Calls to finish"
    >
      <h2 className="text-[15px] font-bold text-fg">
        {total === 1 ? '1 call to finish' : `${total} calls to finish`}
      </h2>
      <p className="text-xs text-fg-2">Add how each one went. They don’t count as calls until you do.</p>
      <ul className="mt-2 divide-y divide-line">
        {calls.map((c) => {
          const Icon = c.channel === 'whatsapp' ? MessageCircle : Phone;
          const name = c.contacts?.full_name ?? 'Contact';
          return (
            <li key={c.id} className="flex items-center gap-3 py-2.5">
              <Icon className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                {showContact && <span className="block truncate text-sm font-semibold text-fg">{name}</span>}
                <span className={cn('block', showContact ? 'text-xs text-fg-3' : 'text-sm text-fg')}>
                  {formatDisplayDate(c.call_date)} · {c.channel === 'whatsapp' ? 'WhatsApp' : 'Phone'}
                </span>
              </span>
              <button
                type="button"
                disabled={removing}
                onClick={() => remove(c.id)}
                aria-label={`I didn’t make this call to ${name}`}
                className="shrink-0 text-xs font-semibold text-fg-3 hover:text-bad hover:underline disabled:opacity-50"
              >
                Didn’t call
              </button>
              <button
                type="button"
                onClick={() =>
                  setFinishing({
                    contactId: c.contact_id,
                    contactName: name,
                    channel: (c.channel === 'whatsapp' ? 'whatsapp' : 'phone') as CallChannel,
                    callDate: c.call_date,
                    pendingCallId: c.id,
                    key: c.id,
                  })
                }
                className="shrink-0 rounded-full bg-acc px-3 py-1.5 text-xs font-bold text-on-acc hover:brightness-110"
              >
                Add outcome
              </button>
            </li>
          );
        })}
      </ul>
      {total > calls.length && (
        <p className="mt-1 text-xs text-fg-3">
          Showing {calls.length} of {total}. Finish these to see the rest.
        </p>
      )}

      <CallOutcomeDialog
        call={finishing}
        onSaved={() => {
          setFinishing(null);
          router.refresh();
        }}
        // Still waiting: closing just puts it back on the list.
        onLater={() => setFinishing(null)}
        onDidNotCall={() => finishing?.pendingCallId && remove(finishing.pendingCallId)}
      />
    </section>
  );
}
