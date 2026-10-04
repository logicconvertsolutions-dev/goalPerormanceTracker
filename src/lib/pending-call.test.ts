// @vitest-environment jsdom
//
// P34: the call an agent started from tap-to-call is remembered across the
// trip to the dialer, for one tab, for a limited time.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PENDING_CALL_TTL_MS,
  clearPendingCall,
  markLeftApp,
  readPendingCall,
  recordPendingCall,
} from './pending-call';

beforeEach(() => sessionStorage.clear());

describe('pending call', () => {
  it('remembers the contact and channel tapped, not yet left', () => {
    recordPendingCall({ contactId: 'c1', contactName: 'Jane Doe', channel: 'whatsapp' });
    const call = readPendingCall();
    expect(call).toMatchObject({ contactId: 'c1', contactName: 'Jane Doe', channel: 'whatsapp', leftApp: false });
    expect(call?.requestId).toBeTruthy();
  });

  it('records leaving the app, keeping the same call', () => {
    recordPendingCall({ contactId: 'c1', contactName: 'Jane Doe', channel: 'phone' });
    const before = readPendingCall();
    markLeftApp();
    expect(readPendingCall()).toEqual({ ...before, leftApp: true });
  });

  it('forgets a call older than the time limit', () => {
    recordPendingCall({ contactId: 'c1', contactName: 'Jane Doe', channel: 'phone' });
    const tappedAt = readPendingCall()!.tappedAt;
    expect(readPendingCall(tappedAt + PENDING_CALL_TTL_MS + 1)).toBeNull();
    expect(readPendingCall(tappedAt)).toBeNull();
  });

  it('a new tap replaces the previous one, and clear removes it', () => {
    recordPendingCall({ contactId: 'c1', contactName: 'Jane Doe', channel: 'phone' });
    recordPendingCall({ contactId: 'c2', contactName: 'Sam Lee', channel: 'phone' });
    expect(readPendingCall()?.contactId).toBe('c2');
    clearPendingCall();
    expect(readPendingCall()).toBeNull();
  });

  it('marking left with nothing pending does nothing', () => {
    markLeftApp();
    expect(readPendingCall()).toBeNull();
  });
});
