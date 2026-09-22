// @vitest-environment jsdom
//
// Staging report 2026-09-22: tapping an appointment on My Day opened "Log a
// call" for the contact. Every item type did, because the tap target
// predates appointments being in the queue. A pending appointment now opens
// the appointment; everything whose next step is a call keeps the dialog.
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const openLog = vi.fn();
vi.mock('@/components/shell/log-activity-dialog', () => ({
  useLogActivityDialog: () => ({ open: openLog }),
}));

// The rows' menu actions are not under test.
vi.mock('./actions', () => ({
  snoozeFollowUpAction: vi.fn(),
  markFollowUpDoneAction: vi.fn(),
  markAppointmentDoneAction: vi.fn(),
  snoozeAppointmentFollowUpAction: vi.fn(),
  markAppointmentFollowUpDoneAction: vi.fn(),
}));
const mockResolveDefaults = vi.fn();
const mockStatusChange = vi.fn();
vi.mock('../appointments/actions', () => ({
  createAppointmentAction: vi.fn(),
  updateAppointmentAction: vi.fn(),
  updateAppointmentStatusAction: (...args: unknown[]) => mockStatusChange(...args),
  deleteAppointmentAction: vi.fn(),
  resolveAppointmentHeldAction: vi.fn(),
  rescheduleAppointmentAction: vi.fn(),
  appointmentDeleteImpactAction: vi.fn(),
  appointmentResolveDefaultsAction: (...args: unknown[]) => mockResolveDefaults(...args),
}));

const { TodayRow } = await import('./today-row');
const { NextUpCard } = await import('./next-up-card');

const ID = '11111111-1111-4111-8111-111111111111';
const common = {
  rowId: ID,
  contactId: 'contact-1',
  contactName: 'Jane Doe',
  lastNote: null,
  timesCalled: 0,
  daysLate: 0,
  appointmentAt: '2026-09-23T15:00:00.000Z',
  timeZone: 'UTC',
};

describe('My Day — what a tap opens', () => {
  beforeEach(() => {
    push.mockClear();
    openLog.mockClear();
  });

  for (const [name, Component] of [
    ['queue row', TodayRow],
    ['Next Up card', NextUpCard],
  ] as const) {
    it(`${name}: a pending appointment opens the appointment, not Log a call`, () => {
      render(<Component {...common} kind="appointment" />);
      fireEvent.click(screen.getByText('Jane Doe'));
      expect(push).toHaveBeenCalledWith(`/appointments/${ID}/edit?returnTo=%2Ftoday`);
      expect(openLog).not.toHaveBeenCalled();
    });

    it(`${name}: a call follow-up still opens Log a call`, () => {
      render(<Component {...common} kind="follow_up" appointmentAt={null} />);
      fireEvent.click(screen.getByText('Jane Doe'));
      expect(openLog).toHaveBeenCalledWith({ contactId: 'contact-1', contactName: 'Jane Doe' });
      expect(push).not.toHaveBeenCalled();
    });

    it(`${name}: an appointment follow-up still opens Log a call`, () => {
      render(<Component {...common} kind="appointment_follow_up" appointmentAt={null} />);
      fireEvent.click(screen.getByText('Jane Doe'));
      expect(openLog).toHaveBeenCalledTimes(1);
      expect(push).not.toHaveBeenCalled();
    });
  }
});

describe('My Day — the row menu', () => {
  beforeEach(() => {
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
    mockStatusChange.mockReset();
    mockStatusChange.mockResolvedValue({ ok: true });
  });

  // Radix menus rely on pointer capture and scrollIntoView, which jsdom
  // does not implement.
  beforeAll(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  function openMenu(name: string) {
    fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' });
  }

  for (const [label, Component, menuName] of [
    ['queue row', TodayRow, 'Actions for Jane Doe'],
    ['Next Up card', NextUpCard, 'Follow-up actions'],
  ] as const) {
    it(`${label}: an appointment offers no Snooze — it moves by Reschedule`, () => {
      render(<Component {...common} kind="appointment" />);
      openMenu(menuName);
      expect(screen.queryByText('Snooze 1 day')).toBeNull();
      expect(screen.getByText('Reschedule…')).toBeInTheDocument();
    });

    it(`${label}: a call follow-up keeps Snooze`, () => {
      render(<Component {...common} kind="follow_up" appointmentAt={null} />);
      openMenu(menuName);
      expect(screen.getByText('Snooze 1 day')).toBeInTheDocument();
    });

    it(`${label}: No-show asks when it happened before recording anything`, async () => {
      render(<Component {...common} kind="appointment" />);
      openMenu(menuName);
      fireEvent.click(screen.getByText('No-show…'));

      const date = await screen.findByLabelText('When did this happen?');
      expect(date).toHaveValue('2026-09-15');
      expect(mockStatusChange).not.toHaveBeenCalled();

      fireEvent.change(date, { target: { value: '2026-09-16' } });
      fireEvent.click(screen.getByRole('button', { name: 'Mark no-show' }));
      await waitFor(() => expect(mockStatusChange).toHaveBeenCalledWith(ID, 'no_show', '2026-09-16'));
    });
  }
});
