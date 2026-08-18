'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { listQueuedActions, removeQueuedAction } from '@/lib/offline/queue';
import type { QueuedAction, QueuedActionKind } from '@/lib/offline/types';
import { logCallAction } from '@/app/(app)/log/actions';
import { createAppointmentAction } from '@/app/(app)/appointments/actions';
import { createSaleAction } from '@/app/(app)/sales/actions';
import { createRecruitingLogAction } from '@/app/(app)/recruiting/actions';

const ACTIONS: Record<QueuedActionKind, (formData: FormData) => Promise<{ ok: boolean; error?: string }>> = {
  call: logCallAction,
  appointment: createAppointmentAction,
  sale: createSaleAction,
  recruiting: createRecruitingLogAction,
};

function toFormData(action: QueuedAction): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(action.fields)) {
    formData.set(key, value);
  }
  return formData;
}

/**
 * Mounted once in the app shell. Drains anything queued in IndexedDB by
 * submit-with-fallback.ts whenever the browser regains connectivity (and
 * once on mount, in case the tab was reloaded while items were still
 * pending). Each Server Action either succeeds outright or hits the
 * client_request_id unique-violation path and treats that as already-saved
 * — either way the queued entry is safe to remove.
 */
export function OfflineSync() {
  const [pendingCount, setPendingCount] = useState(0);
  const draining = useRef(false);

  async function drain() {
    if (draining.current) return;
    draining.current = true;
    try {
      const queued = await listQueuedActions();
      setPendingCount(queued.length);
      if (queued.length === 0) return;

      let synced = 0;
      for (const action of queued) {
        try {
          const result = await ACTIONS[action.kind](toFormData(action));
          if (result.ok) {
            await removeQueuedAction(action.id);
            synced += 1;
          }
          // A business-error result (validation failed server-side) is left
          // queued rather than silently dropped — surfacing that requires a
          // review UI, which is out of scope here; it will keep retrying on
          // every future reconnect without harm (idempotent by request id).
        } catch {
          // Still offline or the server is unreachable again — stop for now,
          // the next `online` event will retry the rest.
          break;
        }
      }

      const remaining = await listQueuedActions();
      setPendingCount(remaining.length);
      if (synced > 0) {
        toast.success(`Synced ${synced} offline ${synced === 1 ? 'entry' : 'entries'}`);
      }
    } finally {
      draining.current = false;
    }
  }

  useEffect(() => {
    drain();
    window.addEventListener('online', drain);
    return () => window.removeEventListener('online', drain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (pendingCount === 0) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 rounded-full border border-line-2 bg-panel-2 px-3 py-1.5 text-xs text-fg-2 shadow-lift md:bottom-4">
      {pendingCount} {pendingCount === 1 ? 'entry' : 'entries'} waiting to sync
    </div>
  );
}
