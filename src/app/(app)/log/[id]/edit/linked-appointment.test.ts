import { describe, expect, it } from 'vitest';
import { callFormAppointmentAt } from './linked-appointment';

describe('callFormAppointmentAt — the slot the call edit form shows', () => {
  it('shows where the appointment is now, not where the call first booked it', () => {
    // Booked for the 18th on the call, since moved to the 20th on the
    // appointment. Showing the 18th would move it back on the next save.
    expect(callFormAppointmentAt('2026-09-18T15:00:00.000Z', { scheduled_for: '2026-09-20T15:00:00.000Z' })).toBe(
      '2026-09-20T15:00:00.000Z'
    );
  });

  it('falls back to the call’s own copy for a legacy call with no appointment row', () => {
    expect(callFormAppointmentAt('2026-09-18T15:00:00.000Z', null)).toBe('2026-09-18T15:00:00.000Z');
    expect(callFormAppointmentAt('2026-09-18T15:00:00.000Z', { scheduled_for: null })).toBe('2026-09-18T15:00:00.000Z');
  });

  it('is empty for a call that booked nothing', () => {
    expect(callFormAppointmentAt(null, undefined)).toBeNull();
  });
});
