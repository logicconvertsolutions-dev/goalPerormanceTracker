import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import type { NotificationKind } from './window';

// One-click unsubscribe has to work with no session (09-account-and-auth.md:
// "every one has a one-click unsubscribe that actually works"). Rather than
// a stored token, the link carries a signature the server can re-derive --
// nothing to store, expire, or leak from a table scan.
function secret(): string {
  const value = process.env.NOTIFICATIONS_UNSUB_SECRET;
  if (!value) throw new Error('NOTIFICATIONS_UNSUB_SECRET is not set');
  return value;
}

export function signUnsubscribe(agentId: string, kind: NotificationKind): string {
  return createHmac('sha256', secret()).update(`${agentId}:${kind}`).digest('hex');
}

export function verifyUnsubscribe(agentId: string, kind: string, signature: string): boolean {
  if (kind !== 'evening_nudge' && kind !== 'sunday_summary' && kind !== 'monday_digest') return false;
  const verifiedKind = kind as NotificationKind;
  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(signUnsubscribe(agentId, verifiedKind), 'hex');
    actual = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
