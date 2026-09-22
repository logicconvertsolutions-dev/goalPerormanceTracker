import { isoToDateInZone } from './dates';

/**
 * The day an appointment's outcome (Held / No-show / Cancelled) counts on.
 *
 * Decided 2026-09-22: the agent CONFIRMS it; the app does not presume it.
 * Before this, the answer depended on which button was pressed -- the
 * one-tap outcomes and the Held sheet stamped today, the edit form stamped
 * whatever its Date field held (the appointment's own day) -- so the same
 * outcome could land in two different cycles.
 *
 * Every route now asks "When did this happen?" and every route validates
 * the answer here:
 *
 *   default  the appointment's own day, or today if it has not arrived yet
 *   latest   today -- an outcome cannot be recorded for a day to come
 *   earliest the appointment's own day -- it cannot have been held before
 *            it was scheduled. For an appointment still in the future the
 *            only possible day is today (a cancellation recorded in advance).
 *
 * All dates are yyyy-mm-dd in the AGENT's zone.
 */

/** The appointment's own calendar day: its slot if it has one, else its stored date (legacy/imported rows). */
export function appointmentDay(
  appt: { scheduled_for: string | null; appt_date: string },
  timeZone: string | null
): string {
  return appt.scheduled_for ? isoToDateInZone(appt.scheduled_for, timeZone) : appt.appt_date;
}

export function outcomeDateBounds(apptDay: string, today: string): { min: string; max: string } {
  return { min: apptDay < today ? apptDay : today, max: today };
}

/** What the prompt starts with: the appointment's day, clamped to today. */
export function defaultOutcomeDate(apptDay: string, today: string): string {
  return outcomeDateBounds(apptDay, today).min;
}

/** Returns the error to show, or null when `date` is an acceptable outcome day. */
export function outcomeDateError(date: string, apptDay: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return 'Enter a valid date.';
  const { min, max } = outcomeDateBounds(apptDay, today);
  if (date > max) return 'The outcome date cannot be in the future.';
  if (date < min) return 'The outcome date cannot be before the appointment.';
  return null;
}
