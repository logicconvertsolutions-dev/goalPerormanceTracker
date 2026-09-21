'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { findOrCreateContact } from '@/lib/contacts';
import { todayIso, isoToDateInZone } from '@/lib/dates';
import { APPT_TYPES } from '@/lib/appointment-types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../../types/database';

const CALL_SOURCES = [
  'warm_market',
  'referral',
  'cold',
  'social_media',
  'friend',
  'other',
  'existing_client',
  'existing_recruit',
] as const;

const CALL_OUTCOMES = [
  'connected',
  'voicemail',
  'no_answer',
  'appointment_set',
  'not_interested',
] as const;

// Derived from the shared picklist rather than restated, so adding a type
// in one place can't leave the call form rejecting it.
const APPT_TYPE_VALUES = APPT_TYPES.map((t) => t.value) as unknown as [string, ...string[]];
const DEFAULT_APPT_TYPE = 'follow_up';

const logCallSchema = z
  .object({
    contactName: z.string().min(1, 'Enter who you called.').max(200),
    contactId: z.string().uuid().optional(),
    callDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date.'),
    source: z.enum(CALL_SOURCES),
    outcome: z.enum(CALL_OUTCOMES),
    notes: z.string().max(2000).optional(),
    followUpOn: z.string().optional(),
    // ISO instant (client combines the date+time pickers in the browser's own
    // zone before submitting) -- required when outcome is "appointment_set",
    // see the .refine() below. Outcome "appointment_set" asks for this
    // instead of a follow-up date (P23): the appointment itself is the thing
    // to come back to, not a separate reminder.
    appointmentAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date/time.').optional(),
    // P25 C1 / decision D5: the call form gets appointment type as an
    // OPTIONAL select defaulting to "Follow Up". /appointments/new keeps it
    // required; the call form is the hot path (~40 uses a day) and the
    // "type required before marking held" guard already forces the answer
    // at the moment it actually matters. Optional also means an offline
    // replay of a pre-C1 payload, which carries no apptType at all, still
    // validates (E15).
    apptType: z.enum(APPT_TYPE_VALUES).default(DEFAULT_APPT_TYPE),
    clientRequestId: z.string().optional(),
  })
  .refine((data) => data.outcome !== 'appointment_set' || !!data.appointmentAt, {
    message: 'Enter the appointment date and time.',
    path: ['appointmentAt'],
  });

// Postgres unique-violation error code.
const UNIQUE_VIOLATION = '23505';

export async function logCallAction(formData: FormData) {
  // Fetched before validation so the callDate fallback below (when a
  // request somehow omits it) uses the agent's own local today, not the
  // server's UTC one.
  const session = await requireAgent();

  const parsed = logCallSchema.safeParse({
    contactName: formData.get('contactName'),
    contactId: formData.get('contactId') || undefined,
    callDate: formData.get('callDate') || todayIso(session.agent!.time_zone),
    source: formData.get('source'),
    outcome: formData.get('outcome'),
    notes: formData.get('notes') || undefined,
    followUpOn: formData.get('followUpOn') || undefined,
    appointmentAt: formData.get('appointmentAt') || undefined,
    apptType: formData.get('apptType') || undefined,
    clientRequestId: formData.get('clientRequestId') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const agentId = session.agent!.id;
  // Non-null: only associates/leaders reach this action (admin has no org).
  const orgId = session.agent!.org_id!;
  const supabase = await createClient();

  // 04-security.md: rate limit the log mutation path. Generous enough for
  // legitimate rapid-fire quick-logging (and an offline queue catching up
  // after reconnecting), tight enough to stop a runaway loop.
  const { data: withinLimit } = await supabase.rpc('check_rate_limit', {
    p_scope: 'log_call',
    p_limit: 60,
    p_window_seconds: 60,
  });
  if (withinLimit === false) {
    return { ok: false, error: 'Too many calls logged too quickly — wait a moment and try again.' };
  }

  const contact = await findOrCreateContact(
    supabase,
    agentId,
    orgId,
    parsed.data.contactName,
    parsed.data.contactId
  );
  if ('error' in contact) return { ok: false, error: contact.error };

  // "Appointment set" asks for the appointment's own date/time instead of a
  // follow-up date (P23) -- ignore any followUpOn a stale form might still
  // submit for that outcome, and vice versa.
  const isAppointmentSet = parsed.data.outcome === 'appointment_set';

  const { data: inserted, error } = await supabase
    .from('call_logs')
    .insert({
      agent_id: agentId,
      org_id: orgId,
      contact_id: contact.id,
      call_date: parsed.data.callDate,
      source: parsed.data.source,
      outcome: parsed.data.outcome,
      notes: parsed.data.notes || null,
      follow_up_on: isAppointmentSet ? null : parsed.data.followUpOn || null,
      // Still written for back-compat; retired in Phase E once nothing
      // reads it. The appointments row below is the record from now on.
      appointment_at: isAppointmentSet ? parsed.data.appointmentAt : null,
      client_request_id: parsed.data.clientRequestId || null,
    })
    .select('id')
    .single();

  // A duplicate client_request_id means this exact submission already
  // succeeded (offline retry) -- treat as success, not an error. The insert
  // returns no row in that case, so look the original up: P25 C1 needs its
  // id to link the appointment, and a retry may be reaching this action
  // precisely because the appointment half failed the first time round.
  let callLogId = inserted?.id;
  if (error) {
    if (error.code !== UNIQUE_VIOLATION) {
      console.error('logCallAction: insert failed', error);
      return { ok: false, error: 'Could not save the call.' };
    }
    const { data: existing } = await supabase
      .from('call_logs')
      .select('id')
      .eq('agent_id', agentId)
      .eq('client_request_id', parsed.data.clientRequestId ?? '')
      .maybeSingle();
    callLogId = existing?.id;
  }

  // P25 C1: the appointment is a row of its own, not a column on the call.
  // This is what closes F4 (recompute_day counts an appointment_set call
  // only when nothing links back to it) and F11 (an appointment booked
  // from a call had no status and could never be resolved).
  if (isAppointmentSet && callLogId) {
    const linkError = await createAppointmentForCall(supabase, {
      agentId,
      orgId,
      contactId: contact.id,
      callLogId,
      callDate: parsed.data.callDate,
      appointmentAt: parsed.data.appointmentAt!,
      apptType: parsed.data.apptType,
      clientRequestId: parsed.data.clientRequestId || null,
      timeZone: session.agent!.time_zone,
      // A call log that was just created cannot already have an
      // appointment, so skip the probe on the hot path. Only the
      // duplicate-request branch above, which found a PRE-EXISTING call,
      // has to ask.
      isNewCallLog: Boolean(inserted?.id),
    });
    if (linkError) {
      console.error('logCallAction: appointment insert failed', linkError);
      // The call itself is saved. Reporting failure is still right: every
      // retry path into this action is idempotent (the call log dedupes on
      // client_request_id, the appointment on source_call_log_id), so a
      // retry finishes the half that didn't land rather than duplicating
      // the half that did. Silently succeeding would leave the appointment
      // off My Day with nothing to tell the agent.
      return { ok: false, error: 'Call saved, but the appointment could not be created — try again.' };
    }
  }

  revalidatePath('/today');
  revalidatePath('/contacts');
  revalidatePath(`/contacts/${contact.id}`);
  revalidatePath('/logs');
  revalidatePath('/appointments');
  return { ok: true };
}

/**
 * Creates the appointments row for a call logged as "appointment set"
 * (P25 Phase C1), or does nothing if this call already has one.
 *
 * Returns the error to report, or null on success.
 *
 * Idempotent twice over, because it is reached by the offline replay queue
 * and by plain double-taps (E16): the existence check below covers the
 * common case, and `appointments_source_call_log_idx` -- unique as of the
 * C1 migration -- covers the race the check can't, surfacing as a unique
 * violation that is treated as "already done". That index is why skipping
 * the probe for a brand-new call log is safe rather than merely likely to
 * be safe.
 */
async function createAppointmentForCall(
  supabase: SupabaseClient<Database>,
  args: {
    agentId: string;
    orgId: string;
    contactId: string;
    callLogId: string;
    callDate: string;
    appointmentAt: string;
    apptType: string;
    clientRequestId: string | null;
    timeZone: string | null;
    isNewCallLog?: boolean;
  }
): Promise<{ message: string } | null> {
  if (!args.isNewCallLog) {
    const { data: alreadyLinked } = await supabase
      .from('appointments')
      .select('id')
      .eq('agent_id', args.agentId)
      .eq('source_call_log_id', args.callLogId)
      .maybeSingle();
    if (alreadyLinked) return null;
  }

  const { error } = await supabase.from('appointments').insert({
    agent_id: args.agentId,
    org_id: args.orgId,
    contact_id: args.contactId,
    source_call_log_id: args.callLogId,
    // The booking day is the day of the CALL, not the day the row reached
    // the server -- which is what fixes F14 going forward: an offline
    // submission replayed three days later still counts toward Appts Set
    // on the day the agent actually booked it. Back-dating a call
    // back-dates the booking for the same reason.
    set_on: args.callDate,
    scheduled_for: args.appointmentAt,
    // Derived, not authoritative: the Phase B identity trigger recomputes
    // appt_date from scheduled_for on the way in. Passed because the column
    // is NOT NULL and the generated Insert type requires it.
    appt_date: isoToDateInZone(args.appointmentAt, args.timeZone),
    appt_type: args.apptType,
    status: 'scheduled',
    // D6: call notes and appointment notes are different facts and are not
    // copied -- copying them creates two records that silently diverge the
    // first time either is edited.
    notes: null,
    client_request_id: args.clientRequestId,
  });

  if (error && error.code !== UNIQUE_VIOLATION) return error;
  return null;
}

const updateCallSchema = z
  .object({
    id: z.string().uuid(),
    callDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date.'),
    source: z.enum(CALL_SOURCES),
    outcome: z.enum(CALL_OUTCOMES),
    notes: z.string().max(2000).optional(),
    followUpOn: z.string().optional(),
    appointmentAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date/time.').optional(),
    apptType: z.enum(APPT_TYPE_VALUES).default(DEFAULT_APPT_TYPE),
  })
  .refine((data) => data.outcome !== 'appointment_set' || !!data.appointmentAt, {
    message: 'Enter the appointment date and time.',
    path: ['appointmentAt'],
  });

export async function updateCallAction(formData: FormData) {
  const parsed = updateCallSchema.safeParse({
    id: formData.get('id'),
    callDate: formData.get('callDate'),
    source: formData.get('source'),
    outcome: formData.get('outcome'),
    notes: formData.get('notes') || undefined,
    followUpOn: formData.get('followUpOn') || undefined,
    appointmentAt: formData.get('appointmentAt') || undefined,
    apptType: formData.get('apptType') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const session = await requireAgent();
  const supabase = await createClient();
  const isAppointmentSet = parsed.data.outcome === 'appointment_set';

  const { error } = await supabase
    .from('call_logs')
    .update({
      call_date: parsed.data.callDate,
      source: parsed.data.source,
      outcome: parsed.data.outcome,
      notes: parsed.data.notes || null,
      follow_up_on: isAppointmentSet ? null : parsed.data.followUpOn || null,
      appointment_at: isAppointmentSet ? parsed.data.appointmentAt : null,
    })
    .eq('id', parsed.data.id)
    .eq('agent_id', session.agent!.id);

  if (error) {
    console.error('updateCallAction: update failed', error);
    return { ok: false, error: 'Could not update the call.' };
  }

  // P25 C1: the call and its appointment are now one thing recorded in two
  // places, so editing the call has to carry the edit across -- otherwise
  // moving an appointment to Thursday on the call form leaves My Day and
  // /appointments both still saying Tuesday.
  const syncError = await syncAppointmentForCall(supabase, {
    agentId: session.agent!.id,
    orgId: session.agent!.org_id!,
    callLogId: parsed.data.id,
    isAppointmentSet,
    appointmentAt: parsed.data.appointmentAt ?? null,
    apptType: parsed.data.apptType,
    timeZone: session.agent!.time_zone,
  });
  if (syncError) {
    console.error('updateCallAction: appointment sync failed', syncError);
    return { ok: false, error: 'Call saved, but its appointment could not be updated — try again.' };
  }

  revalidatePath('/today');
  revalidatePath('/logs');
  revalidatePath('/appointments');
  return { ok: true };
}

/**
 * Carries an edit of a call across to the appointment that call created
 * (P25 Phase C1). Returns the error to report, or null.
 *
 * Only ever touches a row that is still `scheduled`. A resolved
 * appointment is a recorded outcome: moving its slot would undo exactly
 * the guarantee Phase B added (F8 -- "the real date/time of a held
 * appointment is unrecoverable"), and deleting it would erase a Held the
 * SMD has already seen. Editing the call behind a resolved appointment
 * therefore changes the call and leaves the appointment alone.
 *
 * `set_on` is never written here. It is immutable -- the Phase B identity
 * trigger raises on any attempt -- so back-dating a call after the fact
 * cannot move a past day's Appts Set.
 */
async function syncAppointmentForCall(
  supabase: SupabaseClient<Database>,
  args: {
    agentId: string;
    orgId: string;
    callLogId: string;
    isAppointmentSet: boolean;
    appointmentAt: string | null;
    apptType: string;
    timeZone: string | null;
  }
): Promise<{ message: string } | null> {
  const { data: linked } = await supabase
    .from('appointments')
    .select('id, status, appt_type')
    .eq('source_call_log_id', args.callLogId)
    .eq('agent_id', args.agentId)
    .maybeSingle();

  if (!args.isAppointmentSet) {
    // The outcome was changed away from "appointment set": the booking it
    // described no longer happened. Drop the row while it is still
    // pending; leave a resolved one, which records something that did.
    if (linked && linked.status === 'scheduled') {
      const { error } = await supabase
        .from('appointments')
        .delete()
        .eq('id', linked.id)
        .eq('agent_id', args.agentId);
      if (error) return error;
    }
    return null;
  }

  if (!linked) {
    // Either the outcome was just changed TO "appointment set", or this is
    // a pre-C1 call being edited for the first time. Both want a row.
    const { data: call } = await supabase
      .from('call_logs')
      .select('contact_id, call_date')
      .eq('id', args.callLogId)
      .eq('agent_id', args.agentId)
      .maybeSingle();
    if (!call) return null;

    return createAppointmentForCall(supabase, {
      agentId: args.agentId,
      orgId: args.orgId,
      contactId: call.contact_id,
      callLogId: args.callLogId,
      callDate: call.call_date,
      appointmentAt: args.appointmentAt!,
      apptType: args.apptType,
      clientRequestId: null,
      timeZone: args.timeZone,
    });
  }

  if (linked.status !== 'scheduled') return null;

  const { error } = await supabase
    .from('appointments')
    .update({
      scheduled_for: args.appointmentAt,
      appt_date: isoToDateInZone(args.appointmentAt!, args.timeZone),
      // Don't overwrite a type set later on the appointment itself with
      // the call form's default -- only fill one that was never chosen.
      appt_type: linked.appt_type || args.apptType,
    })
    .eq('id', linked.id)
    .eq('agent_id', args.agentId);

  return error ?? null;
}

/** Contact name + recent call history for prefilling the quick-log dialog when opened from a contact. */
export async function fetchLogPrefillAction(contactId: string) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { data: contact } = await supabase
    .from('contacts')
    .select('id, full_name')
    .eq('id', contactId)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!contact) return null;

  const { data: pastCalls } = await supabase
    .from('call_logs')
    .select('call_date, outcome, notes')
    .eq('contact_id', contact.id)
    .order('call_date', { ascending: false })
    .limit(3);

  return { contact, history: pastCalls ?? [] };
}

export async function deleteCallAction(id: string) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase.from('call_logs').delete().eq('id', id).eq('agent_id', session.agent!.id);

  revalidatePath('/logs');
  revalidatePath('/today');
  return { ok: !error };
}
