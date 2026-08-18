'use client';

import { enqueueAction } from './queue';
import type { QueuedActionKind } from './types';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Runs a Server Action; if the request never reaches the server (offline,
 * or the fetch itself throws — the failure mode Next's server-action fetch
 * hits when there's no network, as opposed to a normal {ok:false} business
 * error the action returns when it DID run), queue the submission in
 * IndexedDB instead of surfacing an error. A later `online` event drains it.
 *
 * `formData` must already carry a `clientRequestId` field — the caller is
 * responsible for generating one per logical submission, since it is also
 * the server-side dedupe key (see the client_request_id migration).
 */
export async function submitWithOfflineFallback(
  kind: QueuedActionKind,
  formData: FormData,
  action: (formData: FormData) => Promise<ActionResult>
): Promise<{ ok: true; queued: boolean } | { ok: false; error: string }> {
  const clientRequestId = formData.get('clientRequestId');
  if (typeof clientRequestId !== 'string' || !clientRequestId) {
    throw new Error('submitWithOfflineFallback: formData is missing clientRequestId');
  }

  try {
    const result = await action(formData);
    if (result.ok) return { ok: true, queued: false };
    return { ok: false, error: result.error ?? 'Could not save.' };
  } catch {
    // The action threw instead of returning — the request never got a
    // response (offline, DNS failure, server unreachable). Queue it.
    const fields: Record<string, string> = {};
    formData.forEach((value, key) => {
      if (typeof value === 'string') fields[key] = value;
    });

    await enqueueAction({
      id: clientRequestId,
      kind,
      fields,
      queuedAt: new Date().toISOString(),
    });

    return { ok: true, queued: true };
  }
}
