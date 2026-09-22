// @vitest-environment jsdom
//
// Staging report 2026-09-22: the /appointments list offered "Rescheduled"
// for a pending appointment (it opens the new-time picker), but its edit
// form did not offer it at all -- the same appointment answering the same
// question two ways. Both now behave the same. And an appointment already
// moved to a successor offered statuses the server then refused; its
// picker is locked instead.
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const mockResolveDefaults = vi.fn();
const mockStatusChange = vi.fn(async () => ({ ok: true }));
vi.mock('../actions', () => ({
  createAppointmentAction: vi.fn(),
  updateAppointmentAction: vi.fn(),
  updateAppointmentStatusAction: (...args: unknown[]) => mockStatusChange(...(args as [])),
  deleteAppointmentAction: vi.fn(),
  resolveAppointmentHeldAction: vi.fn(),
  rescheduleAppointmentAction: vi.fn(),
  appointmentDeleteImpactAction: vi.fn(),
  appointmentResolveDefaultsAction: (...args: unknown[]) => mockResolveDefaults(...args),
}));
vi.mock('../../sales/actions', () => ({
  createSaleAction: vi.fn(),
  syncSaleFromAppointmentAction: vi.fn(),
  deleteSaleAction: vi.fn(),
}));
vi.mock('../../recruiting/actions', () => ({
  createRecruitingLogAction: vi.fn(),
  syncRecruitingLogFromAppointmentAction: vi.fn(),
  deleteRecruitingLogAction: vi.fn(),
}));
vi.mock('@/components/shell/contact-picker', () => ({ ContactPicker: () => null }));
vi.mock('@/lib/offline/submit-with-fallback', () => ({ submitWithOfflineFallback: vi.fn() }));

const { AppointmentForm } = await import('../appointment-form');
const { AppointmentRow } = await import('../appointment-row');

// Radix Select relies on pointer capture and scrollIntoView, which jsdom
// does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const ID = '11111111-1111-4111-8111-111111111111';
const SUCCESSOR = '66666666-6666-4666-8666-666666666666';

function editValues(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    contactId: 'contact-1',
    contactName: 'Jane Doe',
    apptDate: '2026-09-25',
    apptType: 'follow_up',
    status: 'scheduled',
    expectedPremiumCents: 0,
    referralsGiven: 0,
    notes: null,
    scheduledFor: '2026-09-25T15:00:00.000Z',
    ...overrides,
  };
}

function openStatusPicker() {
  const trigger = screen.getByLabelText('Status');
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return trigger;
}

function optionLabels() {
  return screen.getAllByRole('option').map((o) => o.textContent);
}

describe('appointment edit form — status picker', () => {
  beforeEach(() => {
    mockResolveDefaults.mockReset();
    mockResolveDefaults.mockResolvedValue({
      apptType: 'follow_up',
      status: 'scheduled',
      expectedPremiumCents: 0,
      referralsGiven: 0,
      notes: null,
      scheduledFor: '2026-09-25T15:00:00.000Z',
      apptDate: '2026-09-25',
      contactName: 'Jane Doe',
      outcomeDefault: '2026-09-22',
      outcomeMin: '2026-09-22',
      outcomeMax: '2026-09-22',
    });
  });

  it('offers Rescheduled for a pending appointment, like the list does', () => {
    render(<AppointmentForm mode="edit" defaultValues={editValues()} />);
    openStatusPicker();
    expect(optionLabels()).toContain('Rescheduled');
  });

  it('opens the new-time picker when Rescheduled is chosen, instead of just changing the status', async () => {
    render(<AppointmentForm mode="edit" defaultValues={editValues()} />);
    openStatusPicker();
    fireEvent.click(screen.getByRole('option', { name: 'Rescheduled' }));

    await waitFor(() => expect(mockResolveDefaults).toHaveBeenCalledWith(ID));
    // The form's own status stays Scheduled: the reschedule is saved by the
    // picker, which books the new appointment.
    expect(screen.getByLabelText('Status')).toHaveTextContent('Scheduled');
  });

  it('does not offer Rescheduled for a new appointment — there is nothing to move yet', () => {
    render(<AppointmentForm mode="create" />);
    openStatusPicker();
    expect(optionLabels()).not.toContain('Rescheduled');
  });

  it('does not offer Rescheduled for an appointment that already has an outcome', () => {
    render(<AppointmentForm mode="edit" defaultValues={editValues({ status: 'held' })} />);
    openStatusPicker();
    expect(optionLabels()).not.toContain('Rescheduled');
  });

  it('locks the status of an appointment already moved to a new one', () => {
    render(
      <AppointmentForm mode="edit" defaultValues={editValues({ status: 'rescheduled', rescheduledToId: SUCCESSOR })} />
    );
    const trigger = screen.getByLabelText('Status');
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent('Rescheduled');
  });

  it('still lets a legacy rescheduled appointment with no successor change status', () => {
    render(<AppointmentForm mode="edit" defaultValues={editValues({ status: 'rescheduled', rescheduledToId: null })} />);
    expect(screen.getByLabelText('Status')).not.toBeDisabled();
  });
});

describe('/appointments list row — status picker', () => {
  function renderRow(props: { status: string; movedToSuccessor?: boolean }) {
    return render(
      <table>
        <tbody>
          <AppointmentRow
            id={ID}
            apptDate="2026-09-25"
            apptType="follow_up"
            expectedPremiumCents={0}
            referralsGiven={0}
            contactName="Jane Doe"
            returnTo="/appointments"
            {...props}
          />
        </tbody>
      </table>
    );
  }

  it('locks the picker for an appointment already moved to a new one', () => {
    renderRow({ status: 'rescheduled', movedToSuccessor: true });
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('leaves the picker usable for a pending appointment', () => {
    renderRow({ status: 'scheduled' });
    expect(screen.getByRole('combobox')).not.toBeDisabled();
  });
});

describe('recording an outcome asks when it happened (2026-09-22)', () => {
  beforeEach(() => {
    mockStatusChange.mockClear();
    mockResolveDefaults.mockReset();
    mockResolveDefaults.mockResolvedValue({
      apptType: 'follow_up',
      status: 'scheduled',
      expectedPremiumCents: 0,
      referralsGiven: 0,
      notes: null,
      scheduledFor: '2026-09-15T15:00:00.000Z',
      apptDate: '2026-09-15',
      contactName: 'Jane Doe',
      outcomeDefault: '2026-09-15',
      outcomeMin: '2026-09-15',
      outcomeMax: '2026-09-22',
    });
  });

  it('list: No-show on a pending appointment opens the date prompt instead of saving at once', async () => {
    render(
      <table>
        <tbody>
          <AppointmentRow
            id={ID}
            apptDate="2026-09-15"
            apptType="follow_up"
            status="scheduled"
            expectedPremiumCents={0}
            referralsGiven={0}
            contactName="Jane Doe"
            returnTo="/appointments"
          />
        </tbody>
      </table>
    );
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'No-show' }));

    expect(await screen.findByLabelText('When did this happen?')).toHaveValue('2026-09-15');
    expect(mockStatusChange).not.toHaveBeenCalled();
  });

  it('list: correcting one outcome to another on a resolved appointment stays one step', async () => {
    render(
      <table>
        <tbody>
          <AppointmentRow
            id={ID}
            apptDate="2026-09-15"
            apptType="follow_up"
            status="held"
            expectedPremiumCents={0}
            referralsGiven={0}
            contactName="Jane Doe"
            returnTo="/appointments"
          />
        </tbody>
      </table>
    );
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'No-show' }));

    await waitFor(() => expect(mockStatusChange).toHaveBeenCalledWith(ID, 'no_show'));
  });

  it('edit form: giving a pending appointment an outcome labels the date and bars earlier days', () => {
    render(<AppointmentForm mode="edit" defaultValues={editValues({ apptDate: '2026-09-15' })} />);
    openStatusPicker();
    fireEvent.click(screen.getByRole('option', { name: 'Held' }));

    const date = screen.getByLabelText('When did this happen?');
    expect(date).toHaveAttribute('min', '2026-09-15');
  });
});
