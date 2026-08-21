// @vitest-environment node
import { describe, expect, it, beforeAll } from 'vitest';
import { signUnsubscribe, verifyUnsubscribe } from './unsubscribe-token';

beforeAll(() => {
  process.env.NOTIFICATIONS_UNSUB_SECRET = 'test-secret-do-not-use-in-production';
});

describe('unsubscribe token', () => {
  it('round-trips: a freshly signed token verifies', () => {
    const sig = signUnsubscribe('agent-1', 'evening_nudge');
    expect(verifyUnsubscribe('agent-1', 'evening_nudge', sig)).toBe(true);
  });

  it('rejects a token signed for a different agent', () => {
    const sig = signUnsubscribe('agent-1', 'evening_nudge');
    expect(verifyUnsubscribe('agent-2', 'evening_nudge', sig)).toBe(false);
  });

  it('rejects a token signed for a different kind', () => {
    const sig = signUnsubscribe('agent-1', 'evening_nudge');
    expect(verifyUnsubscribe('agent-1', 'sunday_summary', sig)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const sig = signUnsubscribe('agent-1', 'evening_nudge');
    const tampered = sig.slice(0, -1) + (sig.at(-1) === '0' ? '1' : '0');
    expect(verifyUnsubscribe('agent-1', 'evening_nudge', tampered)).toBe(false);
  });

  it('rejects garbage input without throwing', () => {
    expect(verifyUnsubscribe('agent-1', 'evening_nudge', 'not-hex-!!')).toBe(false);
    expect(verifyUnsubscribe('agent-1', 'not-a-real-kind', 'deadbeef')).toBe(false);
  });
});
