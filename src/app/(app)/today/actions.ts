'use server';

import { revalidatePath } from 'next/cache';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { addDays } from '@/lib/dates';

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
// The three above operate on call_logs, which is where My Day's queue used
// to live entirely. `my_followups` now also returns rows sourced from
// `appointments` (kind 'appointment' and 'appointment_follow_up'), and
// those need mutations of their own: a call log has an `appointment_at`
// column and an `appointment_done_at` stamp, an appointment has a slot and
// a status machine. markAppointmentDoneAction stays for the legacy
// 'call_appointment' rows -- appointments booked before C1, which have no
// appointments row to resolve.
// ---------------------------------------------------------------------

// Snooze is deliberately absent for appointments (decided 2026-09-22).
// It moved the appointment itself without recording a reschedule, in the
// same menu as "Reschedule…", so two items that look alike did different
// things to the numbers. An appointment moves by Reschedule, or by editing
// a typo on its form. Outcomes are recorded through the resolve dialog,
// which calls updateAppointmentStatusAction directly -- the one
// definition of what resolving means.

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
