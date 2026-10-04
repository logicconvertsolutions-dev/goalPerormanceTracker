import 'server-only';
import webpush from 'web-push';
import type { PushPayload } from './payload';

export interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushOutcome = 'sent' | 'gone' | 'failed';

let configured: boolean | null = null;

/**
 * True once VAPID keys are configured (server env only: VAPID_PUBLIC_KEY,
 * VAPID_PRIVATE_KEY, VAPID_SUBJECT). Like sendEmail(), environments without
 * keys (local dev, previews) skip sending instead of crashing.
 */
export function pushConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

/** Sends one push. 'gone' means the browser dropped the subscription (404/410)
 * and the caller should delete it. */
export async function sendPush(sub: StoredSubscription, payload: PushPayload): Promise<PushOutcome> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60, urgency: 'high' }
    );
    return 'sent';
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return 'gone';
    console.error('[push] send failed', status, (err as Error).message);
    return 'failed';
  }
}
