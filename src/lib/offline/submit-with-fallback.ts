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
export async function submitWithOfflineFallback<T extends ActionResult>(
  kind: QueuedActionKind,
  formData: FormData,
  action: (formData: FormData) => Promise<T>
): Promise<(T & { queued: false }) | { ok: true; queued: true } | { ok: false; error: string }> {
  const clientRequestId = formData.get('clientRequestId');
  if (typeof clientRequestId !== 'string' || !clientRequestId) {
    throw new Error('submitWithOfflineFallback: formData is missing clientRequestId');
  }

  try {
    const result = await action(formData);
    // Spread rather than a fixed { ok: true, queued: false } literal so a
    // caller whose action returns extra fields (e.g. the created row's id)
    // gets them back too -- queued:false only ever applies once the action
    // has actually run, so those fields are always real at that point.
    if (result.ok) return { ...result, queued: false };
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
