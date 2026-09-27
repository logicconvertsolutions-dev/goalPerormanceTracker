// The call the agent just started from a tap-to-call / WhatsApp button (P34),
// remembered until they come back to the app and say how it went.
//
// sessionStorage, not React state: tapping call hands the phone to the
// dialer or WhatsApp, and the browser -- iOS especially -- may freeze or
// reload the page before they return. sessionStorage survives that for this
// tab and is gone when the tab is, so a stale call never follows them into a
// new session. Every read and write is guarded: storage can throw in a
// private window or when blocked, and the prompt then simply doesn't show
// (the manual "Log a call" button still works).

export type CallChannel = 'phone' | 'whatsapp';

export interface PendingCall {
  contactId: string;
  contactName: string;
  channel: CallChannel;
  /** Date.now() at the tap. */
  tappedAt: number;
  /** The page has been hidden since the tap -- the agent actually left the
   * app. Keeps the prompt from opening before they've gone anywhere. */
  leftApp: boolean;
  /** Idempotency key for the saved log, so a retry saves one row. */
  requestId: string;
}

const KEY = 'kautis.pendingCall';

/** A prompt for a call older than this is no longer useful. */
export const PENDING_CALL_TTL_MS = 2 * 60 * 60 * 1000;

export function recordPendingCall(call: Pick<PendingCall, 'contactId' | 'contactName' | 'channel'>) {
  const pending: PendingCall = {
    ...call,
    tappedAt: Date.now(),
    leftApp: false,
    requestId: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
  };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // Storage unavailable: no automatic prompt this time.
  }
}

export function readPendingCall(now = Date.now()): PendingCall | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const call = JSON.parse(raw) as PendingCall;
    if (!call?.contactId || now - call.tappedAt > PENDING_CALL_TTL_MS) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return call;
  } catch {
    return null;
  }
}

export function markLeftApp() {
  const call = readPendingCall();
  if (!call || call.leftApp) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...call, leftApp: true }));
  } catch {
    // ignore
  }
}

export function clearPendingCall() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
