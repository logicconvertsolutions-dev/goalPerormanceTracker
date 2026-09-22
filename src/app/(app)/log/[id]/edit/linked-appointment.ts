/**
 * The appointment slot the call edit form should show.
 *
 * `call_logs.appointment_at` is the call's own copy of the slot, written
 * once when the call was logged (and kept for back-compat until P25 Phase
 * E). Since C1 the appointment row is the record: it moves when the agent
 * edits it, snoozes it on My Day, or (since P29) changes its time on the
 * appointment form -- and none of those touch the call's copy.
 *
 * Seeding the call form from the stale copy meant opening the call to fix
 * a note and saving it carried the OLD slot back across to the appointment
 * (syncAppointmentForCall), silently undoing the move. The linked row's
 * `scheduled_for` wins whenever there is one.
 */
export function callFormAppointmentAt(
  callAppointmentAt: string | null,
  linked: { scheduled_for: string | null } | null | undefined
): string | null {
  return linked?.scheduled_for ?? callAppointmentAt;
}
