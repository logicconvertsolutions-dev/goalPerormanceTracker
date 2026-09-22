import { describe, expect, it } from 'vitest';
import { appointmentDay, defaultOutcomeDate, outcomeDateBounds, outcomeDateError } from './appointment-outcome-date';

const TODAY = '2026-09-22';

describe('appointmentDay', () => {
  it('uses the slot, in the agent’s zone', () => {
    // 02:00 UTC on the 23rd is still the evening of the 22nd in Toronto.
    expect(appointmentDay({ scheduled_for: '2026-09-23T02:00:00.000Z', appt_date: '2026-09-23' }, 'America/Toronto')).toBe(
      '2026-09-22'
    );
  });

  it('falls back to the stored date for a row with no slot (legacy/imported)', () => {
    expect(appointmentDay({ scheduled_for: null, appt_date: '2026-09-10' }, 'UTC')).toBe('2026-09-10');
  });
});

describe('outcome date — confirmed, never presumed', () => {
  it('defaults to the appointment’s own day when it has passed', () => {
    expect(defaultOutcomeDate('2026-09-15', TODAY)).toBe('2026-09-15');
  });

  it('defaults to today for an appointment that has not arrived (cancelled in advance)', () => {
    expect(defaultOutcomeDate('2026-09-30', TODAY)).toBe(TODAY);
    expect(outcomeDateBounds('2026-09-30', TODAY)).toEqual({ min: TODAY, max: TODAY });
  });

  it('accepts any day from the appointment up to today', () => {
    expect(outcomeDateError('2026-09-15', '2026-09-15', TODAY)).toBeNull();
    expect(outcomeDateError('2026-09-18', '2026-09-15', TODAY)).toBeNull();
    expect(outcomeDateError(TODAY, '2026-09-15', TODAY)).toBeNull();
  });

  it('rejects a day in the future', () => {
    expect(outcomeDateError('2026-09-23', '2026-09-15', TODAY)).toMatch(/future/);
  });

  it('rejects a day before the appointment', () => {
    expect(outcomeDateError('2026-09-14', '2026-09-15', TODAY)).toMatch(/before the appointment/);
  });

  it('rejects anything that is not a yyyy-mm-dd date', () => {
    expect(outcomeDateError('yesterday', '2026-09-15', TODAY)).toMatch(/valid/);
    expect(outcomeDateError('2026-09-22T10:00', '2026-09-15', TODAY)).toMatch(/valid/);
  });
});
