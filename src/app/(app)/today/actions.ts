'use server';

import { revalidatePath } from 'next/cache';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { addDays, shiftZonedTimestampByDays } from '@/lib/dates';
import { updateAppointmentStatusAction } from '../appointments/actions';
import type { ResolvableStatus } from '@/lib/appointment-types';

export async function snoozeFollowUpAction(callLogId: string, days: number) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { data: row } = await supabase
    .from('call_logs')
    .select('follow_up_on')
    .eq('id', callLogId)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!row?.follow_up_on) return { ok: false, error: 'Follow-up not found.' };

  const { error } = await supabase
    .from('call_logs')
    .update({ follow_up_on: addDays(row.follow_up_on, days) })
    .eq('id', callLogId)
    .eq('agent_id', session.agent!.id);

  revalidatePath('/today');
  return { ok: !error };
}

export async function markFollowUpDoneAction(callLogId: string) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase
    .from('call_logs')
    .update({ follow_up_done_at: new Date().toISOString() })
    .eq('id', callLogId)
    .eq('agent_id', session.agent!.id);

  revalidatePath('/today');
  return { ok: !error };
}

export async function snoozeAppointmentAction(callLogId: string, days: number) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { data: row } = await supabase
    .from('call_logs')
    .select('appointment_at')
    .eq('id', callLogId)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!row?.appointment_at) return { ok: false, error: 'Appointment not found.' };

  const next = new Date(row.appointment_at);
  next.setUTCDate(next.getUTCDate() + days);

  const { error } = await supabase
    .from('call_logs')
    .update({ appointment_at: next.toISOString() })
    .eq('id', callLogId)
    .eq('agent_id', session.agent!.id);

  revalidatePath('/today');
  return { ok: !error };
}

export async function markAppointmentDoneAction(callLogId: string) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase
    .from('call_logs')
    .update({ appointment_done_at: new Date().toISOString() })
    .eq('id', callLogId)
    .eq('agent_id', session.agent!.id);

  revalidatePath('/today');
  return { ok: !error };
}

// ---------------------------------------------------------------------
// P25 Phase C1 -- the appointments table's own queue actions.
//
// The four above operate on call_logs, which is where My Day's queue used
// to live entirely. `my_followups` now also returns rows sourced from
// `appointments` (kind 'appointment' and 'appointment_follow_up'), and
// those need mutations of their own: a call log has an `appointment_at`
// column and an `appointment_done_at` stamp, an appointment has a slot and
// a status machine. The call_logs pair stays for the legacy
// 'call_appointment' rows -- appointments booked before C1, which have no
// appointments row to resolve.
// ---------------------------------------------------------------------

/**
 * Pushes a pending appointment's slot out by whole days.
 *
 * This moves the appointment itself, not a reminder: `scheduled_for` is
 * where it is, so snoozing it on My Day is the same edit as changing the
 * date on the form. Per decision D1 that is a correction, NOT a reschedule
 * -- a reschedule creates a successor row and is Phase C2's job, behind the
 * date/time picker that can ask what the new slot actually is.
 *
 * Only a `scheduled` row can move. Phase B made `scheduled_for` immutable
 * once an appointment is terminal (F8), so a resolved one is refused here
 * rather than left for the trigger to reject.
 */
export async function snoozeScheduledAppointmentAction(appointmentId: string, days: number) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { data: appt } = await supabase
    .from('appointments')
    .select('scheduled_for, appt_date, status')
    .eq('id', appointmentId)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!appt) return { ok: false, error: 'Appointment not found.' };
  if (appt.status !== 'scheduled') return { ok: false, error: 'That appointment already has an outcome.' };

  // Whole days in the AGENT's zone, so a 2:00 PM appointment snoozed across
  // a DST boundary is still at 2:00 PM (E4).
  //
  // Only scheduled_for is written: appt_date is a compatibility column the
  // Phase B identity trigger derives from it, and new code does not author
  // it (see 02-data-model.md). The exception is a legacy or imported row
  // with no scheduled_for at all, where appt_date is the only thing there
  // is to move.
  const update = appt.scheduled_for
    ? { scheduled_for: shiftZonedTimestampByDays(appt.scheduled_for, days, session.agent!.time_zone) }
    : { appt_date: addDays(appt.appt_date, days) };

  const { error } = await supabase
    .from('appointments')
    .update(update)
    .eq('id', appointmentId)
    .eq('agent_id', session.agent!.id);

  revalidatePath('/today');
  revalidatePath('/appointments');
  return { ok: !error };
}

/**
 * Records an outcome for a pending appointment straight from My Day.
 *
 * This is what closes F11: an appointment booked from a call used to offer
 * only Snooze / Mark done, with `appointment_done_at` feeding nothing at
 * all, so it could never become Held, No-show or Cancelled.
 *
 * Delegates to `updateAppointmentStatusAction` rather than writing the row
 * itself. That action is the single definition of what resolving means --
 * the appt_type guard, and the resolved_on stamp that keeps a late-recorded
 * outcome off a closed cycle (E6). Two implementations of one action is
 * precisely the shape of F8, which Phase B exists to have fixed.
 *
 * Rescheduled is deliberately absent from RESOLVABLE_STATUSES. Per D1 it
 * requires a successor row and the new slot, which needs the resolve
 * sheet's date/time picker (Phase C2).
 */
export async function resolveAppointmentAction(appointmentId: string, status: ResolvableStatus) {
  return updateAppointmentStatusAction(appointmentId, status);
}

/** Pushes out the follow-up date an appointment carries (F12). */
export async function snoozeAppointmentFollowUpAction(appointmentId: string, days: number) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { data: appt } = await supabase
    .from('appointments')
    .select('follow_up_on')
    .eq('id', appointmentId)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!appt?.follow_up_on) return { ok: false, error: 'Follow-up not found.' };

  const { error } = await supabase
    .from('appointments')
    .update({ follow_up_on: addDays(appt.follow_up_on, days) })
    .eq('id', appointmentId)
    .eq('agent_id', session.agent!.id);

  revalidatePath('/today');
  return { ok: !error };
}

/** Clears an appointment's follow-up from the queue (F12). */
export async function markAppointmentFollowUpDoneAction(appointmentId: string) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase
    .from('appointments')
    .update({ follow_up_done_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .eq('agent_id', session.agent!.id);

  revalidatePath('/today');
  return { ok: !error };
}
