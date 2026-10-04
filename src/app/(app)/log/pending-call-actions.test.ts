// @vitest-environment node
//
// P35: "Fill in later" saves a waiting call to pending_calls -- never to
// call_logs -- on today's date; "I didn't make this call" deletes it; and
// logging a call with its pendingCallId removes it once the call is saved.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockRequireAgent = vi.fn();
vi.mock('@/lib/auth/guards', () => ({
  requireAgent: (...args: unknown[]) => mockRequireAgent(...args),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const mockFindOrCreateContact = vi.fn();
vi.mock('@/lib/contacts', () => ({
  findOrCreateContact: (...args: unknown[]) => mockFindOrCreateContact(...args),
}));

let mockCreateClient: ReturnType<typeof vi.fn>;
vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const { savePendingCallAction, deletePendingCallAction, logCallAction } = await import('./actions');

const CONTACT = '11111111-1111-4111-8111-111111111111';
const PENDING = '22222222-2222-4222-8222-222222222222';

type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][] };

function setupSupabase({
  contact = { id: CONTACT } as Record<string, unknown> | null,
  insertError = null as { code: string } | null,
} = {}) {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    const entry: Call = { table, op: 'select', filters: [] };
    calls.push(entry);
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      eq: vi.fn((col: string, val: unknown) => {
        entry.filters.push([col, val]);
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(() => Promise.resolve({ data: table === 'contacts' ? contact : { id: 'call-1' }, error: null })),
      single: vi.fn(() => Promise.resolve({ data: { id: 'call-1' }, error: null })),
      insert: vi.fn((payload: unknown) => {
        entry.op = 'insert';
        entry.payload = payload;
        return Object.assign(Promise.resolve({ error: insertError }), builder);
      }),
      delete: vi.fn(() => {
        entry.op = 'delete';
        return builder;
      }),
      then: (resolve: (v: { error: null }) => void, reject: (e: unknown) => void) =>
        Promise.resolve({ error: null }).then(resolve, reject),
    };
    return builder;
  });
  mockCreateClient = vi.fn().mockResolvedValue({ from, rpc: vi.fn().mockResolvedValue({ data: true }) });
  return { calls };
}

beforeEach(() => {
  mockRequireAgent.mockResolvedValue({
    userId: 'agent-1',
    agent: { id: 'agent-1', org_id: 'org-1', time_zone: 'America/Toronto' },
  });
  mockFindOrCreateContact.mockResolvedValue({ id: CONTACT, created: false });
});

describe('savePendingCallAction', () => {
  it('saves to pending_calls with today, the channel and the request id -- never call_logs', async () => {
    const { calls } = setupSupabase();
    expect(await savePendingCallAction({ contactId: CONTACT, channel: 'whatsapp', clientRequestId: 'req-1' })).toEqual({
      ok: true,
    });
    const inserts = calls.filter((c) => c.op === 'insert');
    expect(inserts.map((c) => c.table)).toEqual(['pending_calls']);
    expect(inserts[0].payload).toMatchObject({
      agent_id: 'agent-1',
      org_id: 'org-1',
      contact_id: CONTACT,
      channel: 'whatsapp',
      client_request_id: 'req-1',
    });
    expect((inserts[0].payload as { call_date: string }).call_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('treats the same prompt closed twice as already saved', async () => {
    setupSupabase({ insertError: { code: '23505' } });
    expect(await savePendingCallAction({ contactId: CONTACT, channel: 'phone', clientRequestId: 'req-1' })).toEqual({
      ok: true,
    });
  });

  it("refuses a contact that isn't the agent's, and an unknown channel", async () => {
    const { calls } = setupSupabase({ contact: null });
    expect((await savePendingCallAction({ contactId: CONTACT, channel: 'phone', clientRequestId: 'r' })).ok).toBe(false);
    // @ts-expect-error -- deliberately invalid
    expect((await savePendingCallAction({ contactId: CONTACT, channel: 'sms', clientRequestId: 'r' })).ok).toBe(false);
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });
});

describe('deletePendingCallAction', () => {
  it("removes the agent's own waiting call", async () => {
    const { calls } = setupSupabase();
    expect(await deletePendingCallAction(PENDING)).toEqual({ ok: true });
    const del = calls.find((c) => c.op === 'delete');
    expect(del?.table).toBe('pending_calls');
    expect(del?.filters).toEqual([
      ['id', PENDING],
      ['agent_id', 'agent-1'],
    ]);
  });
});

describe('logCallAction with a waiting call', () => {
  function form(extra: Record<string, string> = {}) {
    const fd = new FormData();
    for (const [k, v] of Object.entries({
      contactName: 'Jane Doe',
      contactId: CONTACT,
      callDate: '2026-10-01',
      source: 'cold',
      outcome: 'connected',
      channel: 'phone',
      clientRequestId: 'req-9',
      ...extra,
    }))
      fd.set(k, v);
    return fd;
  }

  it('logs the call on the day it was made, then removes the waiting call', async () => {
    const { calls } = setupSupabase();
    expect(await logCallAction(form({ pendingCallId: PENDING }))).toEqual({ ok: true });
    const logged = calls.find((c) => c.op === 'insert' && c.table === 'call_logs');
    expect(logged?.payload).toMatchObject({ call_date: '2026-10-01', outcome: 'connected', channel: 'phone' });
    const del = calls.find((c) => c.op === 'delete' && c.table === 'pending_calls');
    expect(del?.filters).toEqual([
      ['id', PENDING],
      ['agent_id', 'agent-1'],
    ]);
    expect(calls.indexOf(del!)).toBeGreaterThan(calls.indexOf(logged!));
  });

  it('an ordinary log touches no waiting call', async () => {
    const { calls } = setupSupabase();
    await logCallAction(form());
    expect(calls.some((c) => c.table === 'pending_calls')).toBe(false);
  });
});
