'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { findOrCreateContact } from '@/lib/contacts';
import { todayIso, isoToDateInZone } from '@/lib/dates';

const APPT_STATUSES = ['scheduled', 'held', 'no_show', 'rescheduled', 'cancelled'] as const;

// Base object only -- .partial()/.extend() (used below for updateSchema)
// aren't available once .refine() wraps it in a ZodEffects, so the two
// status-dependent .refine() checks are applied separately to each of
// appointmentSchema/updateSchema instead of chained on here directly.
const baseAppointmentSchema = z.object({
  contactName: z.string().min(1, 'Enter who the appointment is with.').max(200),
  contactId: z.string().uuid().optional(),
  // Optional here (required below only when status isn't "scheduled") --
  // "Cannot be in the future" for it is checked in createAppointmentAction
  // against the acting agent's own local today, not in a .refine() here,
  // since this schema is built once at module load and can't close over
  // that per-request value (the UTC "today" a refine would otherwise fall
  // back to is wrong for exactly the evening hours this check matters
  // most -- an agent logging a same-day appointment after UTC has already
  // rolled to tomorrow would get rejected).
  apptDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date.').optional(),
  // ISO instant -- required when status is "scheduled" (P24). Unlike every
  // other status, which logs an appointment that already happened as of
  // apptDate, "Scheduled" describes one that hasn't yet -- an in-person
  // appointment set for a future date/time -- so it needs its own date
  // field that's actually allowed to be in the future, plus a time.
  appointmentAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date/time.').optional(),
  apptType: z.string().min(1, 'Select an appointment type.').max(200),
  status: z.enum(APPT_STATUSES),
  expectedPremiumCents: z.coerce.number().int().min(0).default(0),
  referralsGiven: z.coerce.number().int().min(0).default(0),
  notes: z.string().max(2000).optional(),
  followUpOn: z.string().optional(),
  clientRequestId: z.string().optional(),
});

const appointmentSchema = baseAppointmentSchema
  .refine((data) => data.status !== 'scheduled' || !!data.appointmentAt, {
    message: 'Enter the appointment date and time.',
    path: ['appointmentAt'],
  })
  .refine((data) => data.status === 'scheduled' || !!data.apptDate, {
    message: 'Enter a date.',
    path: ['apptDate'],
  });

// Postgres unique-violation error code.
const UNIQUE_VIOLATION = '23505';

// P3: minimal CRUD only. Filters/summary/CSV land in P4 per docs/08-screen-specs.md.
export async function createAppointmentAction(formData: FormData) {
  // Fetched before validation (rather than the more common validate-then-auth
  // order) because the date default/bound below needs the agent's own local
  // "today", not the server's UTC one.
  const session = await requireAgent();
  const today = todayIso(session.agent!.time_zone);

  const parsed = appointmentSchema.safeParse({
    contactName: formData.get('contactName'),
    contactId: formData.get('contactId') || undefined,
    apptDate: formData.get('apptDate') || undefined,
    appointmentAt: formData.get('appointmentAt') || undefined,
    apptType: formData.get('apptType') || undefined,
    status: formData.get('status') || 'scheduled',
    expectedPremiumCents: formData.get('expectedPremiumCents') || 0,
    referralsGiven: formData.get('referralsGiven') || 0,
    notes: formData.get('notes') || undefined,
    followUpOn: formData.get('followUpOn') || undefined,
    clientRequestId: formData.get('clientRequestId') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const isScheduled = parsed.data.status === 'scheduled';
  // "Cannot be in the future" only applies to a status that logs something
  // that already happened -- "Scheduled" is the one status that's for a
  // future date/time by design, validated as a real date/time above instead.
  if (!isScheduled && parsed.data.apptDate! > today) {
    return { ok: false, error: 'Appointment date cannot be in the future.' };
  }
  // appt_date stays the source every other query buckets this row by
  // (appt_scheduled/held/no_show/etc, all keyed off it) -- for "Scheduled"
  // it's just derived from appointmentAt's own date part instead of typed
  // in directly.
  const apptDate = isScheduled
    ? isoToDateInZone(parsed.data.appointmentAt!, session.agent!.time_zone)
    : parsed.data.apptDate!;

  const agentId = session.agent!.id;
  // Non-null: only associates/leaders reach this action (admin has no org).
  const orgId = session.agent!.org_id!;
  const supabase = await createClient();

  const contact = await findOrCreateContact(
    supabase,
    agentId,
    orgId,
    parsed.data.contactName,
    parsed.data.contactId
  );
  if ('error' in contact) return { ok: false, error: contact.error };

  const { data: inserted, error } = await supabase
    .from('appointments')
    .insert({
      agent_id: agentId,
      org_id: orgId,
      contact_id: contact.id,
      appt_date: apptDate,
      // The booking day (P25 Phase B). Identical to what the identity
      // trigger would derive for an insert with no set_on, but stated here
      // because the column is NOT NULL and the generated Insert type asks
      // for it. Note this is TODAY even when apptDate is back-dated: an
      // appointment logged after the fact was still booked today, and
      // set_on is immutable from here on.
      set_on: today,
      appointment_at: isScheduled ? parsed.data.appointmentAt : null,
      appt_type: parsed.data.apptType || null,
      status: parsed.data.status,
      expected_premium_cents: parsed.data.expectedPremiumCents,
      referrals_given: parsed.data.referralsGiven,
      notes: parsed.data.notes || null,
      follow_up_on: parsed.data.followUpOn || null,
      client_request_id: parsed.data.clientRequestId || null,
    })
    .select('id')
    .single();

  // A duplicate client_request_id means this exact submission already
  // succeeded (offline retry) -- treat as success, not an error. The insert
  // above returns no row in that case, so look the original one up instead
  // -- the appointment form's "Log as a Sale"/"Recruited?" toggles need its
  // id to link a record they create against it.
  let appointmentId = inserted?.id;
  if (error) {
    if (error.code !== UNIQUE_VIOLATION) {
      console.error('createAppointmentAction: insert failed', error);
      return { ok: false, error: 'Could not save the appointment.' };
    }
    const { data: existing } = await supabase
      .from('appointments')
      .select('id')
      .eq('agent_id', agentId)
      .eq('client_request_id', parsed.data.clientRequestId ?? '')
      .maybeSingle();
    appointmentId = existing?.id;
  }

  revalidatePath('/appointments');
  revalidatePath('/logs');
  revalidatePath(`/contacts/${contact.id}`);
  return { ok: true, id: appointmentId };
}

const updateSchema = baseAppointmentSchema
  .partial({ contactName: true })
  .extend({ id: z.string().uuid() })
  .refine((data) => data.status !== 'scheduled' || !!data.appointmentAt, {
    message: 'Enter the appointment date and time.',
    path: ['appointmentAt'],
  })
  .refine((data) => data.status === 'scheduled' || !!data.apptDate, {
    message: 'Enter a date.',
    path: ['apptDate'],
  });

export async function updateAppointmentAction(formData: FormData) {
  const parsed = updateSchema.safeParse({
    id: formData.get('id'),
    apptDate: formData.get('apptDate') || undefined,
    appointmentAt: formData.get('appointmentAt') || undefined,
    apptType: formData.get('apptType') || undefined,
    status: formData.get('status'),
    expectedPremiumCents: formData.get('expectedPremiumCents') || 0,
    referralsGiven: formData.get('referralsGiven') || 0,
    notes: formData.get('notes') || undefined,
    followUpOn: formData.get('followUpOn') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const session = await requireAgent();
  const isScheduled = parsed.data.status === 'scheduled';
  if (!isScheduled && parsed.data.apptDate && parsed.data.apptDate > todayIso(session.agent!.time_zone)) {
    return { ok: false, error: 'Appointment date cannot be in the future.' };
  }
  const apptDate = isScheduled
    ? isoToDateInZone(parsed.data.appointmentAt!, session.agent!.time_zone)
    : parsed.data.apptDate!;
  const supabase = await createClient();

  const { error } = await supabase
    .from('appointments')
    .update({
      appt_date: apptDate,
      appointment_at: isScheduled ? parsed.data.appointmentAt : null,
      appt_type: parsed.data.apptType || null,
      status: parsed.data.status,
      expected_premium_cents: parsed.data.expectedPremiumCents,
      referrals_given: parsed.data.referralsGiven,
      notes: parsed.data.notes || null,
      follow_up_on: parsed.data.followUpOn || null,
    })
    .eq('id', parsed.data.id)
    .eq('agent_id', session.agent!.id);

  if (error) {
    console.error('updateAppointmentAction: update failed', error);
    return { ok: false, error: 'Could not update the appointment.' };
  }

  revalidatePath('/appointments');
  revalidatePath('/logs');
  return { ok: true };
}

export async function updateAppointmentStatusAction(id: string, status: (typeof APPT_STATUSES)[number]) {
  const session = await requireAgent();
  const supabase = await createClient();

  // The quick status-changer on the appointments table skips the full form,
  // so the "type required when held" rule (createAppointmentAction /
  // updateAppointmentAction) needs its own check here against whatever
  // appt_type is already on the row -- fetched alongside status/appt_date
  // for the resolve-a-scheduled-appointment check below.
  const { data: appt } = await supabase
    .from('appointments')
    .select('appt_type, status')
    .eq('id', id)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (status === 'held' && !appt?.appt_type) {
    return { ok: false, error: 'Set an appointment type before marking this held.' };
  }

  // P25 C1. This is the ONE definition of "resolve an appointment" -- the
  // /appointments quick status-changer calls it, and so does My Day's row
  // menu (via resolveAppointmentAction in today/actions.ts). F8 was two
  // code paths for the same action leaving two different rows; a second
  // resolve implementation for the new My Day queue would be the same
  // mistake with the columns renamed.
  //
  // Recording an outcome stamps resolved_on with the agent's TODAY, and
  // lets the Phase B identity trigger derive appt_date from it. Before
  // Phase B this action wrote appt_date directly, and only when the
  // appointment was future-dated -- so an appointment held last Tuesday
  // and recorded this morning landed its Appts Held on last Tuesday,
  // reaching back into a cycle that may already be closed. resolved_on is
  // the day the outcome was RECORDED (§7 E6), which never moves history.
  //
  // Only the scheduled -> terminal transition stamps it. A terminal row
  // changed to another terminal status is a correction to the same
  // resolution event, so it keeps the day it was first recorded on
  // (the trigger preserves old.resolved_on when none is supplied), and
  // returning a row to `scheduled` clears it in the trigger (E7).
  const isResolving = appt?.status === 'scheduled' && status !== 'scheduled';
  const update: { status: (typeof APPT_STATUSES)[number]; resolved_on?: string } = { status };
  if (isResolving) {
    update.resolved_on = todayIso(session.agent!.time_zone);
  }

  const { error } = await supabase
    .from('appointments')
    .update(update)
    .eq('id', id)
    .eq('agent_id', session.agent!.id);

  // My Day's queue is sourced from appointments since C1, so a status
  // change here removes the row from it.
  revalidatePath('/today');
  revalidatePath('/appointments');
  revalidatePath('/logs');
  return { ok: !error };
}

export async function deleteAppointmentAction(id: string) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase
    .from('appointments')
    .delete()
    .eq('id', id)
    .eq('agent_id', session.agent!.id);

  revalidatePath('/appointments');
  revalidatePath('/logs');
  return { ok: !error };
}
