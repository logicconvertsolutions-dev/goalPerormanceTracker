// @vitest-environment jsdom
//
// Staging report 2026-09-22: tapping an appointment on My Day opened "Log a
// call" for the contact. Every item type did, because the tap target
// predates appointments being in the queue. A pending appointment now opens
// the appointment; everything whose next step is a call keeps the dialog.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
  snoozeAppointmentAction: vi.fn(),
  markAppointmentDoneAction: vi.fn(),
  snoozeScheduledAppointmentAction: vi.fn(),
  resolveAppointmentAction: vi.fn(),
  snoozeAppointmentFollowUpAction: vi.fn(),
  markAppointmentFollowUpDoneAction: vi.fn(),
}));
vi.mock('../appointments/actions', () => ({
  createAppointmentAction: vi.fn(),
  updateAppointmentAction: vi.fn(),
  updateAppointmentStatusAction: vi.fn(),
  deleteAppointmentAction: vi.fn(),
  resolveAppointmentHeldAction: vi.fn(),
  rescheduleAppointmentAction: vi.fn(),
  appointmentDeleteImpactAction: vi.fn(),
  appointmentResolveDefaultsAction: vi.fn(),
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
      expect(push).toHaveBeenCalledWith(`/appointments/${ID}/edit`);
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
