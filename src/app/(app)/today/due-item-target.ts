import type { DueItemKind } from './use-follow-up-actions';
import { withReturnTo } from '@/lib/return-to';

/**
 * Where tapping a My Day item takes the agent.
 *
 * The queue was call follow-ups only when "tap opens the quick-log dialog"
 * was specified (08-screen-specs), and that is still right for anything
 * whose next step is a call. A pending appointment is not a call: tapping
 * it opened "Log a call" for the contact, which is not what the agent was
 * reaching for. It opens the appointment itself, where its slot, type and
 * notes are; its outcomes stay in the row menu.
 *
 *   follow_up              call        -> log a call
 *   appointment_follow_up  call        -> log a call (a callback after the
 *                                         appointment, decided 2026-09-22)
 *   call_appointment       call        -> log a call (pre-C1 legacy: there
 *                                         is no appointments row to open)
 *   appointment            appointment -> /appointments/[id]/edit (returns to My Day)
 *
 * Returns the route to open, or null to open the quick-log dialog.
 */
export function dueItemHref(kind: DueItemKind, rowId: string): string | null {
  // Saving it comes back to My Day, where the agent was working.
  return kind === 'appointment' ? withReturnTo(`/appointments/${rowId}/edit`, '/today') : null;
}
