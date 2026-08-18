// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';

const enqueueAction = vi.fn();
vi.mock('./queue', () => ({ enqueueAction: (...args: unknown[]) => enqueueAction(...args) }));

const { submitWithOfflineFallback } = await import('./submit-with-fallback');

function formDataWith(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('submitWithOfflineFallback', () => {
  beforeEach(() => {
    enqueueAction.mockReset();
    enqueueAction.mockResolvedValue(undefined);
  });

  it('throws if formData has no clientRequestId', async () => {
    const fd = formDataWith({ foo: 'bar' });
    await expect(submitWithOfflineFallback('call', fd, vi.fn())).rejects.toThrow(/clientRequestId/);
  });

  it('returns ok/not-queued when the action succeeds normally', async () => {
    const fd = formDataWith({ clientRequestId: 'req-1', contactName: 'Jane' });
    const action = vi.fn().mockResolvedValue({ ok: true });

    const result = await submitWithOfflineFallback('call', fd, action);

    expect(result).toEqual({ ok: true, queued: false });
    expect(enqueueAction).not.toHaveBeenCalled();
  });

  it('surfaces a business-error result without queuing (the request DID reach the server)', async () => {
    const fd = formDataWith({ clientRequestId: 'req-2', contactName: '' });
    const action = vi.fn().mockResolvedValue({ ok: false, error: 'Enter who you called.' });

    const result = await submitWithOfflineFallback('call', fd, action);

    expect(result).toEqual({ ok: false, error: 'Enter who you called.' });
    expect(enqueueAction).not.toHaveBeenCalled();
  });

  it('queues the submission when the action throws (network unreachable)', async () => {
    const fd = formDataWith({ clientRequestId: 'req-3', contactName: 'Jane', source: 'warm_market' });
    const action = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await submitWithOfflineFallback('call', fd, action);

    expect(result).toEqual({ ok: true, queued: true });
    expect(enqueueAction).toHaveBeenCalledTimes(1);
    const queued = enqueueAction.mock.calls[0][0];
    expect(queued.id).toBe('req-3');
    expect(queued.kind).toBe('call');
    expect(queued.fields).toEqual({
      clientRequestId: 'req-3',
      contactName: 'Jane',
      source: 'warm_market',
    });
    expect(typeof queued.queuedAt).toBe('string');
  });
});
