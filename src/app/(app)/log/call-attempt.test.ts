// @vitest-environment node
//
// P34: closing the post-call prompt without an outcome still saves the
// attempt -- today, no outcome, the tapped channel, the contact's last
// source -- and a retry of the same close saves nothing twice.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockRequireAgent = vi.fn();
vi.mock('@/lib/auth/guards', () => ({
  requireAgent: (...args: unknown[]) => mockRequireAgent(...args),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/contacts', () => ({ findOrCreateContact: vi.fn() }));

let mockCreateClient: ReturnType<typeof vi.fn>;
vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const { logCallAttemptAction } = await import('./actions');

const CONTACT = '11111111-1111-4111-8111-111111111111';

function setupSupabase({
  contact = { id: CONTACT } as Record<string, unknown> | null,
  lastCall = null as Record<string, unknown> | null,
  insertError = null as { code: string } | null,
} = {}) {
  const inserts: Record<string, unknown>[] = [];
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(() => Promise.resolve({ data: table === 'contacts' ? contact : lastCall, error: null })),
      insert: vi.fn((row: Record<string, unknown>) => {
        inserts.push(row);
        return Promise.resolve({ error: insertError });
      }),
    };
    return builder;
  });
  mockCreateClient = vi.fn().mockResolvedValue({ from, rpc: vi.fn().mockResolvedValue({ data: true }) });
  return { inserts };
}

beforeEach(() => {
  mockRequireAgent.mockResolvedValue({
    userId: 'agent-1',
    agent: { id: 'agent-1', org_id: 'org-1', time_zone: 'America/Toronto' },
  });
});

describe('logCallAttemptAction', () => {
  it('saves the attempt with no outcome, the channel and the last known source', async () => {
    const { inserts } = setupSupabase({ lastCall: { source: 'referral' } });
    const result = await logCallAttemptAction({ contactId: CONTACT, channel: 'whatsapp', clientRequestId: 'req-1' });
    expect(result).toEqual({ ok: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      agent_id: 'agent-1',
      org_id: 'org-1',
      contact_id: CONTACT,
      outcome: null,
      channel: 'whatsapp',
      source: 'referral',
      client_request_id: 'req-1',
    });
    expect(inserts[0].call_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses 'other' for a first call with no known source", async () => {
    const { inserts } = setupSupabase();
    await logCallAttemptAction({ contactId: CONTACT, channel: 'phone', clientRequestId: 'req-2' });
    expect(inserts[0].source).toBe('other');
  });

  it('treats a repeated close (same request id) as already saved', async () => {
    setupSupabase({ insertError: { code: '23505' } });
    expect(await logCallAttemptAction({ contactId: CONTACT, channel: 'phone', clientRequestId: 'req-1' })).toEqual({
      ok: true,
    });
  });

  it("refuses a contact that isn't the agent's", async () => {
    const { inserts } = setupSupabase({ contact: null });
    const result = await logCallAttemptAction({ contactId: CONTACT, channel: 'phone', clientRequestId: 'req-3' });
    expect(result.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it('refuses an unknown channel', async () => {
    const { inserts } = setupSupabase();
    // @ts-expect-error -- deliberately invalid
    const result = await logCallAttemptAction({ contactId: CONTACT, channel: 'sms', clientRequestId: 'req-4' });
    expect(result.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});
