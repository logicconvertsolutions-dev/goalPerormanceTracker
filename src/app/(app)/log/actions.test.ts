// @vitest-environment node
//
// P25 Phase C1: logging a call with outcome "appointment set" creates a
// real appointments row and links it back to the call. That link is what
// closes F4 (the same booking counted once instead of twice) and F11 (an
// appointment booked from a call could never be resolved, because it had
// no status to resolve).
//
// The spec's F17 finding is that P23 and P24 both shipped appointment bugs
// green because nothing asserted on them. These tests are about the SHAPE
// of what reaches the database -- which columns carry which values -- since
// that is exactly what F5/F14 got wrong by writing the right row on the
// wrong day.
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

const { logCallAction } = await import('./actions');

type Row = Record<string, unknown>;

/**
 * Minimal stand-in for the Supabase query builder: records every insert
 * per table so a test can assert on the row that would have been written.
 *
 * `callInsertError` simulates the offline-replay path — the same
 * `client_request_id` arriving twice, so the call log insert raises a
 * unique violation and the action falls back to looking the original up.
 * `existingLink` is what the "does this call already have an appointment?"
 * probe finds.
 */
function setupSupabase({
  existingLink = null,
  callInsertError = null,
}: { existingLink?: Row | null; callInsertError?: { code: string } | null } = {}) {
  const inserts: Record<string, Row[]> = { call_logs: [], appointments: [] };

  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      insert: vi.fn((payload: Row) => {
        inserts[table]?.push(payload);
        return builder;
      }),
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      // The call log insert reads its own id back, and returns no row at
      // all when the unique index rejects it.
      single: vi.fn(() =>
        Promise.resolve(
          callInsertError ? { data: null, error: callInsertError } : { data: { id: 'call-1' }, error: null }
        )
      ),
      // call_logs: the duplicate lookup. appointments: the link probe.
      maybeSingle: vi.fn(() =>
        Promise.resolve({
          data: table === 'appointments' ? existingLink : { id: 'call-1' },
          error: null,
        })
      ),
      // The appointments insert is awaited directly -- the builder itself
      // is thenable.
      then: (resolve: (v: { error: null }) => void, reject: (e: unknown) => void) =>
        Promise.resolve({ error: null }).then(resolve, reject),
    };
    return builder;
  });

  mockCreateClient.mockResolvedValue({
    from,
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  });
  return { from, inserts };
}

function callForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const fields: Record<string, string> = {
    contactName: 'Jane Doe',
    callDate: '2026-09-14',
    source: 'warm_market',
    outcome: 'appointment_set',
    appointmentAt: '2026-09-18T18:00:00.000Z',
    clientRequestId: 'req-1',
    ...overrides,
  };
  for (const [k, v] of Object.entries(fields)) if (v !== '') fd.set(k, v);
  return fd;
}

describe('logCallAction — the appointment it creates (P25 C1)', () => {
  beforeEach(() => {
    mockCreateClient = vi.fn();
    mockRequireAgent.mockReset();
    mockRequireAgent.mockResolvedValue({
      agent: { id: 'agent-1', org_id: 'org-1', time_zone: 'America/New_York' },
    });
    mockFindOrCreateContact.mockReset();
    mockFindOrCreateContact.mockResolvedValue({ id: 'contact-1' });
  });

  it('creates an appointments row linked back to the call', async () => {
    const { inserts } = setupSupabase();

    const result = await logCallAction(callForm());

    expect(result.ok).toBe(true);
    expect(inserts.appointments).toHaveLength(1);
    expect(inserts.appointments[0]).toMatchObject({
      agent_id: 'agent-1',
      org_id: 'org-1',
      contact_id: 'contact-1',
      source_call_log_id: 'call-1',
      scheduled_for: '2026-09-18T18:00:00.000Z',
      status: 'scheduled',
    });
  });

  it('buckets the booking on the day of the CALL, not the day the row is written (F14)', async () => {
    // An offline submission replayed days later still counts toward Appts
    // Set on the day the agent actually booked it. set_on is immutable
    // afterwards, so getting this wrong is not correctable.
    const { inserts } = setupSupabase();

    await logCallAction(callForm({ callDate: '2026-09-14' }));

    expect(inserts.appointments[0].set_on).toBe('2026-09-14');
  });

  it('derives appt_date from the appointment slot in the agent’s zone', async () => {
    // 18:00 UTC on the 18th is 2:00 PM in New York — same calendar day
    // here, but the conversion is what stops an evening appointment
    // landing on tomorrow for an agent west of UTC.
    const { inserts } = setupSupabase();

    await logCallAction(callForm({ appointmentAt: '2026-09-19T01:00:00.000Z' }));

    expect(inserts.appointments[0].appt_date).toBe('2026-09-18');
  });

  it('does not copy the call’s notes onto the appointment (D6)', async () => {
    const { inserts } = setupSupabase();

    await logCallAction(callForm({ notes: 'Talked about term life' }));

    expect(inserts.call_logs[0].notes).toBe('Talked about term life');
    expect(inserts.appointments[0].notes).toBeNull();
  });

  it('defaults the type to follow_up when the form omits it (D5, E15)', async () => {
    // The offline replay queue survives deploys, so this action is reached
    // by pre-C1 payloads that carry no apptType at all. Rejecting them
    // would lose an agent's queued work.
    const { inserts } = setupSupabase();

    const result = await logCallAction(callForm());

    expect(result.ok).toBe(true);
    expect(inserts.appointments[0].appt_type).toBe('follow_up');
  });

  it('uses the type the agent chose when the form supplies one', async () => {
    const { inserts } = setupSupabase();

    await logCallAction(callForm({ apptType: 'solutions_presentation' }));

    expect(inserts.appointments[0].appt_type).toBe('solutions_presentation');
  });

  it('creates no appointment for any other outcome', async () => {
    const { inserts } = setupSupabase();

    const result = await logCallAction(
      callForm({ outcome: 'voicemail', appointmentAt: '', followUpOn: '2026-09-20' })
    );

    expect(result.ok).toBe(true);
    expect(inserts.call_logs).toHaveLength(1);
    expect(inserts.appointments).toHaveLength(0);
  });

  it('does not create a second appointment when a replayed call already has one (E16)', async () => {
    // The offline queue re-submitting the same clientRequestId: the call
    // log insert is rejected as a duplicate, the action recovers the
    // original call's id, and finds it already carries an appointment. A
    // second row here would be a second appts_set event for one booking.
    const { inserts } = setupSupabase({
      callInsertError: { code: '23505' },
      existingLink: { id: 'appt-1' },
    });

    const result = await logCallAction(callForm());

    expect(result.ok).toBe(true);
    expect(inserts.appointments).toHaveLength(0);
  });

  it('finishes the appointment half when a replay finds the call but no appointment', async () => {
    // The other half of the same path: the first attempt saved the call
    // and died before the appointment. The retry must complete it rather
    // than reporting success over a booking that does not exist.
    const { inserts } = setupSupabase({ callInsertError: { code: '23505' }, existingLink: null });

    const result = await logCallAction(callForm());

    expect(result.ok).toBe(true);
    expect(inserts.appointments).toHaveLength(1);
    expect(inserts.appointments[0].source_call_log_id).toBe('call-1');
  });

  it('rejects an unknown appointment type rather than writing it through', async () => {
    setupSupabase();

    const result = await logCallAction(callForm({ apptType: 'not_a_real_type' }));

    expect(result.ok).toBe(false);
  });
});
