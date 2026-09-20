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
import { describe, expect, it, vi, beforeEach } from 'vitest';

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

const { rescheduleAppointmentAction, resolveAppointmentHeldAction } = await import('./actions');

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
}: {
  appointment: Row | null;
  linkFails?: boolean;
}) {
  const inserts: Record<string, Row[]> = { appointments: [], sales: [] };
  const updates: Row[] = [];
  const deletes: string[] = [];

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
        return builder;
      }),
      delete: vi.fn(() => {
        mode = 'delete';
        return builder;
      }),
      eq: vi.fn((col: string, value: string) => {
        if (mode === 'delete' && col === 'id') deleteId = value;
        return builder;
      }),
      maybeSingle: vi.fn(() => Promise.resolve({ data: appointment, error: null })),
      single: vi.fn(() => Promise.resolve({ data: { id: 'successor-1' }, error: null })),
      then: (resolve: (v: { error: unknown }) => void, reject: (e: unknown) => void) => {
        if (mode === 'delete') deletes.push(deleteId);
        const error = mode === 'update' && linkFails ? { message: 'boom' } : null;
        return Promise.resolve({ error }).then(resolve, reject);
      },
    };
    return builder;
  });

  mockCreateClient.mockResolvedValue({ from });
  return { inserts, updates, deletes };
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
