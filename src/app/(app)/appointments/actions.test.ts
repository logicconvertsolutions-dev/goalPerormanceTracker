// @vitest-environment node
//
// P25 Phase C2: the two outcomes that are more than a status change.
//
// Reschedule is the one worth guarding hardest. Decision D1 makes it a
// two-row operation -- terminate the original, create a successor, link
// them -- and every one of the failure modes P25 exists to remove is
// reachable here: a second Appts Set from a double-tap, an orphan
// successor from a half-completed write, a resolution stamped on the wrong
// day.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockRequireAgent = vi.fn();
vi.mock('@/lib/auth/guards', () => ({
  requireAgent: (...args: unknown[]) => mockRequireAgent(...args),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/contacts', () => ({ findOrCreateContact: vi.fn() }));

const mockCreateSaleAction = vi.fn();
vi.mock('../sales/actions', () => ({
  createSaleAction: (...args: unknown[]) => mockCreateSaleAction(...args),
  deleteSaleAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../recruiting/actions', () => ({
  deleteRecruitingLogAction: vi.fn(async () => ({ ok: true })),
}));

let mockCreateClient: ReturnType<typeof vi.fn>;
vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const {
  createAppointmentAction,
  rescheduleAppointmentAction,
  resolveAppointmentHeldAction,
  updateAppointmentAction,
  updateAppointmentStatusAction,
} = await import('./actions');

type Row = Record<string, unknown>;

// Real UUIDs: the action schemas validate `id` as one, so a readable
// placeholder like 'appt-1' fails validation before any of the behaviour
// under test runs — and every assertion below would then be passing for
// the wrong reason.
const APPT_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';
const ORG_ID = '33333333-3333-4333-8333-333333333333';
const AGENT_ID = '44444444-4444-4444-8444-444444444444';

/**
 * Records the writes each table receives so a test can assert on the rows
 * that would exist, and lets a test decide what the appointment lookup
 * returns and whether the link-back update fails.
 */
function setupSupabase({
  appointment,
  linkFails = false,
  linkedRows = [{ id: APPT_ID }],
  rereads = [],
}: {
  appointment: Row | null;
  linkFails?: boolean;
  // What a conditional update's `.select('id')` returns: the rows it
  // actually changed. Empty simulates losing a race to another request.
  linkedRows?: Row[];
  // What each LATER maybeSingle() returns, in order, after the first one
  // has returned `appointment` -- e.g. the re-read after a lost race.
  rereads?: (Row | null)[];
}) {
  const inserts: Record<string, Row[]> = { appointments: [], sales: [] };
  const updates: Row[] = [];
  const deletes: string[] = [];
  const filters: Record<string, unknown>[] = [];
  let reads = 0;

  const from = vi.fn((table: string) => {
    let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let deleteId = '';
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      insert: vi.fn((payload: Row) => {
        mode = 'insert';
        inserts[table]?.push(payload);
        return builder;
      }),
      update: vi.fn((payload: Row) => {
        mode = 'update';
        updates.push(payload);
        filters.push({});
        return builder;
      }),
      delete: vi.fn(() => {
        mode = 'delete';
        return builder;
      }),
      eq: vi.fn((col: string, value: string) => {
        if (mode === 'delete' && col === 'id') deleteId = value;
        if (mode === 'update') filters[filters.length - 1][col] = value;
        return builder;
      }),
      is: vi.fn((col: string, value: unknown) => {
        if (mode === 'update') filters[filters.length - 1][`${col} is`] = value;
        return builder;
      }),
      maybeSingle: vi.fn(() => {
        const data = reads === 0 ? appointment : rereads[reads - 1] ?? appointment;
        reads += 1;
        return Promise.resolve({ data, error: null });
      }),
      single: vi.fn(() => Promise.resolve({ data: { id: 'successor-1' }, error: null })),
      then: (resolve: (v: { data: unknown; error: unknown }) => void, reject: (e: unknown) => void) => {
        if (mode === 'delete') deletes.push(deleteId);
        const error = mode === 'update' && linkFails ? { message: 'boom' } : null;
        const data = mode === 'update' && !error ? linkedRows : null;
        return Promise.resolve({ data, error }).then(resolve, reject);
      },
    };
    return builder;
  });

  mockCreateClient.mockResolvedValue({ from });
  return { inserts, updates, deletes, filters };
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const PENDING = {
  id: APPT_ID,
  status: 'scheduled',
  appt_type: 'solutions_presentation',
  contact_id: CONTACT_ID,
  org_id: ORG_ID,
  expected_premium_cents: 120000,
  rescheduled_to_id: null,
  // A slot that has already passed, in every test's clock: 15 Sept.
  scheduled_for: '2026-09-15T18:00:00.000Z',
  appt_date: '2026-09-15',
  resolved_on: null,
  contacts: { full_name: 'Jane Doe' },
};

describe('rescheduleAppointmentAction', () => {
  beforeEach(() => {
    mockCreateClient = vi.fn();
    mockRequireAgent.mockReset();
    mockRequireAgent.mockResolvedValue({
      agent: { id: AGENT_ID, org_id: ORG_ID, time_zone: 'America/New_York' },
    });
    mockCreateSaleAction.mockReset();
    mockCreateSaleAction.mockResolvedValue({ ok: true });
  });

  it('creates a successor and terminates the original as rescheduled', async () => {
    const { inserts, updates } = setupSupabase({ appointment: PENDING });

    const result = await rescheduleAppointmentAction(
      form({ id: APPT_ID, scheduledFor: '2026-10-01T18:00:00.000Z' })
    );

    expect(result.ok).toBe(true);
    expect(inserts.appointments).toHaveLength(1);
    expect(inserts.appointments[0]).toMatchObject({
      contact_id: CONTACT_ID,
      status: 'scheduled',
      scheduled_for: '2026-10-01T18:00:00.000Z',
      appt_type: 'solutions_presentation',
    });
    expect(updates[0]).toMatchObject({
      status: 'rescheduled',
      rescheduled_to_id: 'successor-1',
    });
  });

  it('gives the successor its own booking day, not the original’s (D2)', async () => {
    // The rebooking is work that happened today. Inheriting the
    // predecessor's set_on would file it under a day that is very likely
    // already closed, and hide the activity the SMD is measuring.
    const { inserts } = setupSupabase({ appointment: { ...PENDING, set_on: '2026-08-01' } });

    await rescheduleAppointmentAction(form({ id: APPT_ID, scheduledFor: '2026-10-01T18:00:00.000Z' }));

    expect(inserts.appointments[0].set_on).not.toBe('2026-08-01');
  });

  it('carries the premium across so Open Pipeline does not drop', async () => {
    const { inserts } = setupSupabase({ appointment: PENDING });

    await rescheduleAppointmentAction(form({ id: APPT_ID, scheduledFor: '2026-10-01T18:00:00.000Z' }));

    expect(inserts.appointments[0].expected_premium_cents).toBe(120000);
  });

  it('is a no-op on a second call — one rebooking, one successor (E16/E17)', async () => {
    // A double-tap, or two devices. Without this the agent gets two
    // successors and two Appts Set events for one rebooking.
    const { inserts } = setupSupabase({
      appointment: { ...PENDING, status: 'rescheduled', rescheduled_to_id: 'successor-1' },
    });

    const result = await rescheduleAppointmentAction(
      form({ id: APPT_ID, scheduledFor: '2026-10-01T18:00:00.000Z' })
    );

    expect(result).toEqual({ ok: true, id: 'successor-1' });
    expect(inserts.appointments).toHaveLength(0);
  });

  it('refuses to reschedule an appointment that already has an outcome', async () => {
    const { inserts } = setupSupabase({ appointment: { ...PENDING, status: 'held' } });

    const result = await rescheduleAppointmentAction(
      form({ id: APPT_ID, scheduledFor: '2026-10-01T18:00:00.000Z' })
    );

    expect(result.ok).toBe(false);
    expect(inserts.appointments).toHaveLength(0);
  });

  it('rolls the successor back when the link-up fails', async () => {
    // An orphan successor is not harmless: it carries its own set_on, so
    // it would count a second Appts Set for a rebooking that never
    // completed, while the original sat in the queue still pending.
    const { deletes } = setupSupabase({ appointment: PENDING, linkFails: true });

    const result = await rescheduleAppointmentAction(
      form({ id: APPT_ID, scheduledFor: '2026-10-01T18:00:00.000Z' })
    );

    expect(result.ok).toBe(false);
    expect(deletes).toContain('successor-1');
  });
});

describe('resolveAppointmentHeldAction', () => {
  beforeEach(() => {
    mockCreateClient = vi.fn();
    mockRequireAgent.mockReset();
    mockRequireAgent.mockResolvedValue({
      agent: { id: AGENT_ID, org_id: ORG_ID, time_zone: 'America/New_York' },
    });
    mockCreateSaleAction.mockReset();
    mockCreateSaleAction.mockResolvedValue({ ok: true });
  });

  it('records the outcome with the details the meeting produced', async () => {
    const { updates } = setupSupabase({ appointment: PENDING });

    const result = await resolveAppointmentHeldAction(
      form({ id: APPT_ID, expectedPremiumCents: '90000', referralsGiven: '3', notes: 'Bring the quote' })
    );

    expect(result.ok).toBe(true);
    expect(updates[0]).toMatchObject({
      status: 'held',
      expected_premium_cents: 90000,
      referrals_given: 3,
      notes: 'Bring the quote',
    });
    // E6: the day the outcome was RECORDED.
    expect(updates[0].resolved_on).toBeTruthy();
  });

  it('does not move the resolution day of an already-resolved appointment', async () => {
    // Re-recording the details of a held appointment is a correction to
    // the same outcome event. Restamping it would drag a past day's Appts
    // Held onto today.
    const { updates } = setupSupabase({ appointment: { ...PENDING, status: 'held' } });

    await resolveAppointmentHeldAction(form({ id: APPT_ID, expectedPremiumCents: '90000' }));

    expect(updates[0]).not.toHaveProperty('resolved_on');
  });

  it('refuses to mark Held an appointment that was already moved to a successor (N2)', async () => {
    const { updates } = setupSupabase({
      appointment: { ...PENDING, status: 'rescheduled', rescheduled_to_id: '66666666-6666-4666-8666-666666666666' },
    });

    const result = await resolveAppointmentHeldAction(form({ id: APPT_ID }));

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('refuses without a type, since Held is what makes type required', async () => {
    const { updates } = setupSupabase({ appointment: { ...PENDING, appt_type: null } });

    const result = await resolveAppointmentHeldAction(form({ id: APPT_ID }));

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('logs the sale when asked, for an Application', async () => {
    setupSupabase({ appointment: { ...PENDING, appt_type: 'application' } });

    await resolveAppointmentHeldAction(
      form({ id: APPT_ID, apptType: 'application', expectedPremiumCents: '250000', logAsSale: 'true', saleProductType: 'term_life' })
    );

    expect(mockCreateSaleAction).toHaveBeenCalledTimes(1);
    const saleForm = mockCreateSaleAction.mock.calls[0][0] as FormData;
    expect(saleForm.get('appointmentId')).toBe(APPT_ID);
    expect(saleForm.get('premiumCents')).toBe('250000');
    expect(saleForm.get('productType')).toBe('term_life');
  });

  it('never logs a sale for a type that is not an Application', async () => {
    setupSupabase({ appointment: PENDING });

    await resolveAppointmentHeldAction(
      form({ id: APPT_ID, apptType: 'follow_up', logAsSale: 'true' })
    );

    expect(mockCreateSaleAction).not.toHaveBeenCalled();
  });

  it('still reports the outcome saved when only the sale fails', async () => {
    // The appointment IS held. A flat failure would leave the sheet open
    // over a recorded outcome and invite recording it twice.
    setupSupabase({ appointment: { ...PENDING, appt_type: 'application' } });
    mockCreateSaleAction.mockResolvedValue({ ok: false, error: 'Sale date cannot be in the future.' });

    const result = await resolveAppointmentHeldAction(
      form({ id: APPT_ID, apptType: 'application', logAsSale: 'true' })
    );

    expect(result.ok).toBe(true);
    expect(result.saleWarning).toContain('future');
  });
});

// ---------------------------------------------------------------------
// Appointment-flow fixes after Phase C (N1-N4).
// ---------------------------------------------------------------------

function mockAgent() {
  mockCreateClient = vi.fn();
  mockRequireAgent.mockReset();
  mockRequireAgent.mockResolvedValue({
    agent: { id: AGENT_ID, org_id: ORG_ID, time_zone: 'America/New_York' },
  });
  mockCreateSaleAction.mockReset();
  mockCreateSaleAction.mockResolvedValue({ ok: true });
}

const SUCCESSOR_ID = '66666666-6666-4666-8666-666666666666';

describe('rescheduleAppointmentAction — two requests at once (N3, E17)', () => {
  beforeEach(mockAgent);

  it('links up only if the original is still pending and unlinked', async () => {
    const { filters } = setupSupabase({ appointment: PENDING });

    await rescheduleAppointmentAction(form({ id: APPT_ID, scheduledFor: '2026-10-01T18:00:00.000Z' }));

    expect(filters[0]).toMatchObject({ id: APPT_ID, status: 'scheduled', 'rescheduled_to_id is': null });
  });

  it('removes its own successor and returns the winner’s when it loses the race', async () => {
    // Both requests read the original as pending and both inserted a
    // successor. The other one linked first, so this link-up matches no
    // row. Keeping our successor would leave an orphan counting a second
    // Appts Set for one rebooking.
    const { deletes } = setupSupabase({
      appointment: PENDING,
      linkedRows: [],
      rereads: [{ ...PENDING, status: 'rescheduled', rescheduled_to_id: SUCCESSOR_ID }],
    });

    const result = await rescheduleAppointmentAction(
      form({ id: APPT_ID, scheduledFor: '2026-10-01T18:00:00.000Z' })
    );

    expect(result).toEqual({ ok: true, id: SUCCESSOR_ID });
    expect(deletes).toContain('successor-1');
  });

  it('removes its successor and fails if the original got another outcome meanwhile', async () => {
    const { deletes } = setupSupabase({
      appointment: PENDING,
      linkedRows: [],
      rereads: [{ ...PENDING, status: 'cancelled' }],
    });

    const result = await rescheduleAppointmentAction(
      form({ id: APPT_ID, scheduledFor: '2026-10-01T18:00:00.000Z' })
    );

    expect(result.ok).toBe(false);
    expect(deletes).toContain('successor-1');
  });
});

describe('createAppointmentAction — Rescheduled needs a new time (N2, D1)', () => {
  beforeEach(mockAgent);

  it('refuses to create an appointment that is already rescheduled', async () => {
    const { inserts } = setupSupabase({ appointment: null });

    const result = await createAppointmentAction(
      form({ contactName: 'Jane Doe', apptType: 'follow_up', status: 'rescheduled', apptDate: '2026-09-01' })
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Reschedule/);
    expect(inserts.appointments).toHaveLength(0);
  });
});

describe('updateAppointmentAction — the edit form (N1, N2)', () => {
  beforeEach(mockAgent);

  // A pending appointment whose slot was 1 Sept -- appt_date is NOT NULL
  // in the table, so a realistic row always carries one.
  const PENDING_ROW = { status: 'scheduled', rescheduled_to_id: null, scheduled_for: null, appt_date: '2026-09-01' };

  const pendingEdit = {
    id: APPT_ID,
    status: 'scheduled',
    apptType: 'follow_up',
    appointmentAt: '2026-10-02T14:30:00.000Z',
  };

  it('moves a pending appointment by writing its slot, not just appointment_at (N1)', async () => {
    // appointment_at alone is ignored on an update -- the identity trigger
    // keeps the existing scheduled_for -- so the edit used to revert.
    const { updates } = setupSupabase({ appointment: PENDING_ROW });

    const result = await updateAppointmentAction(form(pendingEdit));

    expect(result.ok).toBe(true);
    expect(updates[0]).toMatchObject({ scheduled_for: '2026-10-02T14:30:00.000Z' });
  });

  it('never writes the slot of an appointment being given an outcome (F8)', async () => {
    const { updates } = setupSupabase({ appointment: PENDING_ROW });

    await updateAppointmentAction(form({ id: APPT_ID, status: 'held', apptType: 'follow_up', apptDate: '2026-09-01' }));

    expect(updates[0]).not.toHaveProperty('scheduled_for');
  });

  it('refuses to move an appointment into Rescheduled without a new time', async () => {
    const { updates } = setupSupabase({ appointment: PENDING_ROW });

    const result = await updateAppointmentAction(
      form({ id: APPT_ID, status: 'rescheduled', apptType: 'follow_up', apptDate: '2026-09-01' })
    );

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('refuses to reopen an appointment that was moved to a successor', async () => {
    // The successor is the live appointment; reopening the original would
    // leave two pending appointments for one prospect.
    const { updates } = setupSupabase({ appointment: { status: 'rescheduled', rescheduled_to_id: SUCCESSOR_ID } });

    const result = await updateAppointmentAction(form(pendingEdit));

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('still lets a rescheduled appointment’s notes be edited', async () => {
    const { updates } = setupSupabase({ appointment: { status: 'rescheduled', rescheduled_to_id: SUCCESSOR_ID } });

    const result = await updateAppointmentAction(
      form({ id: APPT_ID, status: 'rescheduled', apptType: 'follow_up', apptDate: '2026-09-01', notes: 'Moved by client' })
    );

    expect(result.ok).toBe(true);
    expect(updates[0]).toMatchObject({ status: 'rescheduled', notes: 'Moved by client' });
  });

  it('reports a missing appointment instead of pretending to save', async () => {
    const { updates } = setupSupabase({ appointment: null });

    const result = await updateAppointmentAction(form(pendingEdit));

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });
});

describe('updateAppointmentStatusAction — the quick status change (N2, N4)', () => {
  beforeEach(mockAgent);

  it('validates its arguments before touching the database (rule 7)', async () => {
    setupSupabase({ appointment: PENDING });

    expect((await updateAppointmentStatusAction('not-a-uuid', 'held')).ok).toBe(false);
    expect((await updateAppointmentStatusAction(APPT_ID, 'done' as never)).ok).toBe(false);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('reports a missing appointment instead of success', async () => {
    const { updates } = setupSupabase({ appointment: null });

    const result = await updateAppointmentStatusAction(APPT_ID, 'no_show');

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('never sets Rescheduled directly — that is the reschedule picker’s job', async () => {
    const { updates } = setupSupabase({ appointment: { ...PENDING, status: 'held' } });

    const result = await updateAppointmentStatusAction(APPT_ID, 'rescheduled');

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('refuses to reopen an appointment that was moved to a successor', async () => {
    const { updates } = setupSupabase({
      appointment: { ...PENDING, status: 'rescheduled', rescheduled_to_id: SUCCESSOR_ID },
    });

    const result = await updateAppointmentStatusAction(APPT_ID, 'scheduled');

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('stamps the recording day when it resolves a pending appointment (E6)', async () => {
    const { updates } = setupSupabase({ appointment: PENDING });

    const result = await updateAppointmentStatusAction(APPT_ID, 'no_show');

    expect(result.ok).toBe(true);
    expect(updates[0]).toMatchObject({ status: 'no_show' });
    expect(updates[0].resolved_on).toBeTruthy();
  });

  it('says so when the database rejects the change', async () => {
    setupSupabase({ appointment: PENDING, linkFails: true });

    const result = await updateAppointmentStatusAction(APPT_ID, 'cancelled');

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------
// The outcome day is confirmed by the agent, never presumed (2026-09-22).
// Every route validates it the same way: from the appointment's own day
// (or today, if it has not arrived) up to today.
// ---------------------------------------------------------------------

describe('outcome date — every route applies the same rule', () => {
  beforeEach(() => {
    mockAgent();
    // Only Date is faked, so promises still resolve. 15:00 UTC is 11:00 in
    // New York: "today" is 22 Sept for the agent.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-22T15:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('quick status change stamps the confirmed day', async () => {
    const { updates } = setupSupabase({ appointment: PENDING });

    const result = await updateAppointmentStatusAction(APPT_ID, 'no_show', '2026-09-15');

    expect(result.ok).toBe(true);
    expect(updates[0]).toMatchObject({ status: 'no_show', resolved_on: '2026-09-15' });
  });

  it('quick status change rejects a day in the future', async () => {
    const { updates } = setupSupabase({ appointment: PENDING });

    const result = await updateAppointmentStatusAction(APPT_ID, 'cancelled', '2026-09-23');

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('quick status change rejects a day before the appointment', async () => {
    const { updates } = setupSupabase({ appointment: PENDING });

    const result = await updateAppointmentStatusAction(APPT_ID, 'no_show', '2026-09-14');

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('only allows today for an appointment that has not happened yet (cancelled in advance)', async () => {
    const future = { ...PENDING, scheduled_for: '2026-09-30T18:00:00.000Z', appt_date: '2026-09-30' };
    setupSupabase({ appointment: future });
    expect((await updateAppointmentStatusAction(APPT_ID, 'cancelled', '2026-09-21')).ok).toBe(false);

    const { updates } = setupSupabase({ appointment: future });
    expect((await updateAppointmentStatusAction(APPT_ID, 'cancelled', '2026-09-22')).ok).toBe(true);
    expect(updates[0]).toMatchObject({ resolved_on: '2026-09-22' });
  });

  it('a caller that sends no date (pre-prompt client) still records today', async () => {
    const { updates } = setupSupabase({ appointment: PENDING });

    await updateAppointmentStatusAction(APPT_ID, 'no_show');

    expect(updates[0]).toMatchObject({ resolved_on: '2026-09-22' });
  });

  it('Held sheet stamps the confirmed day, and the sale lands on it too', async () => {
    const { updates } = setupSupabase({ appointment: { ...PENDING, appt_type: 'application' } });

    const result = await resolveAppointmentHeldAction(
      form({ id: APPT_ID, apptType: 'application', logAsSale: 'true', resolvedOn: '2026-09-16' })
    );

    expect(result.ok).toBe(true);
    expect(updates[0]).toMatchObject({ status: 'held', resolved_on: '2026-09-16' });
    const saleForm = mockCreateSaleAction.mock.calls[0][0] as FormData;
    expect(saleForm.get('saleDate')).toBe('2026-09-16');
  });

  it('Held sheet rejects a day before the appointment', async () => {
    const { updates } = setupSupabase({ appointment: PENDING });

    const result = await resolveAppointmentHeldAction(form({ id: APPT_ID, resolvedOn: '2026-09-10' }));

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('edit form rejects an outcome dated before the appointment', async () => {
    const { updates } = setupSupabase({ appointment: PENDING });

    const result = await updateAppointmentAction(
      form({ id: APPT_ID, status: 'held', apptType: 'follow_up', apptDate: '2026-09-10' })
    );

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('edit form stamps the confirmed day when it records the outcome', async () => {
    const { updates } = setupSupabase({ appointment: PENDING });

    const result = await updateAppointmentAction(
      form({ id: APPT_ID, status: 'held', apptType: 'follow_up', apptDate: '2026-09-15' })
    );

    expect(result.ok).toBe(true);
    expect(updates[0]).toMatchObject({ resolved_on: '2026-09-15' });
  });
});
