// @vitest-environment jsdom
//
// P32: adding from the My Day calendar. The tapped slot's date and time
// must reach whichever form the agent picks, and each type must save through
// its existing action -- an appointment through the appointment form (so it
// counts as Appts Set like /appointments/new), not a to-do with a label.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { defaultSlotTime, minutesToSlotTime } from '@/lib/dates';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const mockCreateTask = vi.fn(async (_input: unknown) => ({ ok: true as const }));
const mockCreateReminder = vi.fn(async (_input: unknown) => ({ ok: true as const }));
vi.mock('./planner-actions', () => ({
  createTaskAction: (input: unknown) => mockCreateTask(input),
  createReminderAction: (input: unknown) => mockCreateReminder(input),
  updateReminderAction: vi.fn(),
  deleteReminderAction: vi.fn(),
  dismissReminderAction: vi.fn(),
  toggleTaskAction: vi.fn(),
  deleteTaskAction: vi.fn(),
  updateTaskAction: vi.fn(),
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
vi.mock('../sales/actions', () => ({
  createSaleAction: vi.fn(),
  syncSaleFromAppointmentAction: vi.fn(),
  deleteSaleAction: vi.fn(),
}));
vi.mock('../recruiting/actions', () => ({
  createRecruitingLogAction: vi.fn(),
  syncRecruitingLogFromAppointmentAction: vi.fn(),
  deleteRecruitingLogAction: vi.fn(),
}));
vi.mock('@/components/shell/contact-picker', () => ({ ContactPicker: () => null }));
vi.mock('@/lib/offline/submit-with-fallback', () => ({ submitWithOfflineFallback: vi.fn() }));

const { CalendarAddDialog } = await import('./calendar-add-dialog');

const TODAY = '2026-09-27';

function open(slot: { date: string; time: string }, onSaved = vi.fn(), onClose = vi.fn()) {
  render(
    <CalendarAddDialog slot={slot} onClose={onClose} onSaved={onSaved} today={TODAY} timeZone="America/Toronto" />
  );
  return { onSaved, onClose };
}

beforeEach(() => {
  mockCreateTask.mockClear();
  mockCreateReminder.mockClear();
});

describe('slot time helpers', () => {
  it('floors a tapped spot to its half hour', () => {
    expect(minutesToSlotTime(9 * 60 + 14)).toBe('09:00');
    expect(minutesToSlotTime(9 * 60 + 31)).toBe('09:30');
    expect(minutesToSlotTime(0)).toBe('00:00');
  });

  it('keeps the slot inside the day', () => {
    expect(minutesToSlotTime(-5)).toBe('00:00');
    expect(minutesToSlotTime(24 * 60 + 10)).toBe('23:30');
  });

  it('defaults to the next half hour today and 9 AM on other days', () => {
    // 14:10 in Toronto (EDT, UTC-4).
    const now = '2026-09-27T18:10:00Z';
    expect(defaultSlotTime(TODAY, TODAY, now, 'America/Toronto')).toBe('14:30');
    expect(defaultSlotTime('2026-09-30', TODAY, now, 'America/Toronto')).toBe('09:00');
    // Late evening doesn't roll into tomorrow.
    expect(defaultSlotTime(TODAY, TODAY, '2026-09-28T03:50:00Z', 'America/Toronto')).toBe('23:30');
  });
});

describe('CalendarAddDialog', () => {
  it('opens on Appointment with the tapped slot filled in', () => {
    open({ date: '2026-09-30', time: '14:30' });
    expect(screen.getByRole('radio', { name: /appointment/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Appointment date & time')).toHaveValue('2026-09-30');
    expect(document.getElementById('appointmentTime')).toHaveValue('14:30');
  });

  it('saves a task for the tapped day and time', async () => {
    const { onSaved, onClose } = open({ date: '2026-09-30', time: '10:00' });
    fireEvent.click(screen.getByRole('radio', { name: /task/i }));
    expect(screen.getByLabelText('Date')).toHaveValue('2026-09-30');
    expect(screen.getByLabelText('Time (optional)')).toHaveValue('10:00');
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Prep illustration' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    await waitFor(() =>
      expect(mockCreateTask).toHaveBeenCalledWith({
        title: 'Prep illustration',
        kind: 'task',
        dueOn: '2026-09-30',
        dueTime: '10:00',
      })
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('saves a reminder for the tapped day and time', async () => {
    open({ date: '2026-09-30', time: '16:30' });
    fireEvent.click(screen.getByRole('radio', { name: /reminder/i }));
    fireEvent.change(screen.getByLabelText('What should we remind you about?'), {
      target: { value: 'Send proposal' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }));
    await waitFor(() =>
      expect(mockCreateReminder).toHaveBeenCalledWith({
        title: 'Send proposal',
        date: '2026-09-30',
        time: '16:30',
        leadMinutes: 15,
        push: true,
      })
    );
  });

  it('moves a past slot up to today for a task, but not for an appointment', () => {
    open({ date: '2026-09-20', time: '11:00' });
    expect(screen.getByLabelText('Appointment date & time')).toHaveValue('2026-09-20');
    fireEvent.click(screen.getByRole('radio', { name: /task/i }));
    expect(screen.getByLabelText('Date')).toHaveValue(TODAY);
  });
});
