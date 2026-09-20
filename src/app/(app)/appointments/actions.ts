'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { findOrCreateContact } from '@/lib/contacts';
import { createSaleAction, deleteSaleAction } from '../sales/actions';
import { deleteRecruitingLogAction } from '../recruiting/actions';
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
  // F14: the browser's own calendar day at the moment the agent hit save.
  // Without it an offline submission replayed days later books itself on
  // the sync day. Optional, because an offline payload queued before C2
  // carries no such field and must still replay (E15).
  bookedOn: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date.').optional(),
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
    bookedOn: formData.get('bookedOn') || undefined,
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
      // The booking day (P25 Phase B), immutable from here on.
      //
      // F14: prefer the day the CLIENT says it submitted on, so an offline
      // submission replayed three days later still books on the day the
      // agent actually did it rather than on the sync day. Clamped to the
      // server's own today, because a browser clock is a claim, not a
      // fact, and a future set_on would put an Appts Set on a day that has
      // not happened. A payload queued before C2 carries no bookedOn at
      // all and falls back to today, exactly as before (E15).
      //
      // Note this is the BOOKING day even when apptDate is back-dated: an
      // appointment logged after the fact was still booked today.
      set_on: parsed.data.bookedOn && parsed.data.bookedOn < today ? parsed.data.bookedOn : today,
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
      // P25 C2. The form's Date field is the day the outcome happened, so
      // for a terminal status it has to write resolved_on -- that is the
      // column the read model buckets by. Writing appt_date alone did
      // nothing on an already-resolved row: the Phase B trigger keeps
      // old.resolved_on when no new one is supplied, then derives
      // appt_date straight back from it. The field looked editable and
      // silently was not.
      //
      // E8 still holds: the form submits the row's existing date unless
      // the agent changes it, so editing notes alone re-writes the same
      // value and moves no bucket.
      resolved_on: isScheduled ? null : apptDate,
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

  revalidatePath('/today');
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

/**
 * F16: deleting an appointment that spawned a sale or a recruiting log
 * needs an explicit choice, because the FK is ON DELETE SET NULL and the
 * default is silence -- the sale keeps counting toward sales_count and
 * premium_cents with nothing in the appointment UI pointing at it.
 *
 * `deleteLinked` is what the agent chose in the confirm dialog, which is
 * driven by appointmentDeleteImpactAction. Both answers are legitimate: a
 * sale that really happened should outlive a mistakenly-logged
 * appointment, and one logged in error should go with it. What is not
 * legitimate is not being asked.
 */
export async function deleteAppointmentAction(id: string, deleteLinked = false) {
  const session = await requireAgent();
  const supabase = await createClient();

  if (deleteLinked) {
    // Before the appointment, so a failure here leaves both rows intact
    // and linked rather than a half-deleted pair.
    const { saleId, recruitingLogId } = await appointmentDeleteImpactAction(id);
    if (saleId) {
      const result = await deleteSaleAction(saleId);
      if (!result.ok) return { ok: false, error: 'Could not delete the linked sale.' };
    }
    if (recruitingLogId) {
      const result = await deleteRecruitingLogAction(recruitingLogId);
      if (!result.ok) return { ok: false, error: 'Could not delete the linked recruiting log.' };
    }
  }

  const { error } = await supabase
    .from('appointments')
    .delete()
    .eq('id', id)
    .eq('agent_id', session.agent!.id);

  revalidatePath('/today');
  revalidatePath('/appointments');
  revalidatePath('/sales');
  revalidatePath('/recruiting');
  revalidatePath('/logs');
  return { ok: !error };
}

// ---------------------------------------------------------------------
// P25 Phase C2 -- the resolve sheet's two actions.
//
// C1 gave My Day one-tap Held / No-show / Cancelled through
// updateAppointmentStatusAction. Two of those three stay one tap. The
// other two outcomes need more than a status:
//
//   Held        -- the appointment happened, so there is now a premium, a
//                  referral count, notes, and possibly a sale to record.
//   Rescheduled -- per decision D1 it TERMINATES this appointment and
//                  creates a successor, so it needs the new slot.
//
// Both live here rather than in today/actions.ts, for the same reason
// resolving does: one definition, called from both My Day and
// /appointments. F8 was two code paths for one action.
// ---------------------------------------------------------------------

const resolveHeldSchema = z.object({
  id: z.string().uuid(),
  apptType: z.string().min(1).max(200).optional(),
  expectedPremiumCents: z.coerce.number().int().min(0).default(0),
  referralsGiven: z.coerce.number().int().min(0).default(0),
  notes: z.string().max(2000).optional(),
  logAsSale: z.coerce.boolean().default(false),
  saleProductType: z.string().max(200).optional(),
});

/**
 * Marks a pending appointment Held, with the details the outcome produced,
 * and optionally logs the sale it produced too.
 *
 * The sale is created here rather than by the caller because the two
 * writes are one user action: a sheet that saved the appointment and then
 * failed to save the sale, from the client, would leave the agent with a
 * Held appointment and a silently missing sale.
 */
export async function resolveAppointmentHeldAction(formData: FormData) {
  const parsed = resolveHeldSchema.safeParse({
    id: formData.get('id'),
    apptType: formData.get('apptType') || undefined,
    expectedPremiumCents: formData.get('expectedPremiumCents') || 0,
    referralsGiven: formData.get('referralsGiven') || 0,
    notes: formData.get('notes') || undefined,
    logAsSale: formData.get('logAsSale') === 'true',
    saleProductType: formData.get('saleProductType') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const session = await requireAgent();
  const today = todayIso(session.agent!.time_zone);
  const supabase = await createClient();

  const { data: appt } = await supabase
    .from('appointments')
    .select('id, status, appt_type, contact_id, contacts(full_name)')
    .eq('id', parsed.data.id)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!appt) return { ok: false, error: 'Appointment not found.' };

  const apptType = parsed.data.apptType || appt.appt_type;
  // The same guard the quick status-changer applies, kept here because the
  // sheet can supply a type the row never had (legacy/imported rows).
  if (!apptType) return { ok: false, error: 'Select an appointment type before marking this held.' };

  // Only a scheduled -> terminal transition stamps the resolution day, for
  // the reason updateAppointmentStatusAction spells out: re-recording the
  // details of an already-held appointment is a correction to the same
  // outcome event, and must not move it onto today's numbers. Passing
  // undefined leaves the Phase B trigger holding old.resolved_on.
  const resolvedOn = appt.status === 'scheduled' ? today : undefined;

  const { error } = await supabase
    .from('appointments')
    .update({
      status: 'held',
      // E6 -- the day the outcome was RECORDED. Same rule as
      // updateAppointmentStatusAction; see its comment.
      ...(resolvedOn ? { resolved_on: resolvedOn } : {}),
      appt_type: apptType,
      expected_premium_cents: parsed.data.expectedPremiumCents,
      referrals_given: parsed.data.referralsGiven,
      notes: parsed.data.notes || null,
    })
    .eq('id', parsed.data.id)
    .eq('agent_id', session.agent!.id);

  if (error) {
    console.error('resolveAppointmentHeldAction: update failed', error);
    return { ok: false, error: 'Could not save the outcome.' };
  }

  // "Log as a Sale" mirrors the appointment form's own rule: offered only
  // for an Application, and routed through createSaleAction so the sale
  // has exactly one definition. `sales_appointment_uq` makes a duplicate
  // submit -- or an appointment that already produced a sale through the
  // full form -- a no-op rather than a second sale.
  let saleWarning: string | null = null;
  if (parsed.data.logAsSale && apptType === 'application') {
    const saleForm = new FormData();
    saleForm.set('clientName', (appt.contacts as { full_name: string } | null)?.full_name ?? '');
    saleForm.set('contactId', appt.contact_id);
    saleForm.set('appointmentId', parsed.data.id);
    saleForm.set('saleDate', today);
    saleForm.set('premiumCents', String(parsed.data.expectedPremiumCents));
    if (parsed.data.saleProductType) saleForm.set('productType', parsed.data.saleProductType);
    saleForm.set('clientRequestId', `appt-held:${parsed.data.id}`);

    const saleResult = await createSaleAction(saleForm);
    if (!saleResult.ok) {
      // The appointment IS held. Reporting a flat failure would leave the
      // sheet open over an outcome that is already recorded, and invite
      // the agent to record it again. Succeed, and say what else did not
      // happen.
      saleWarning = saleResult.error ?? 'the sale could not be logged';
    }
  }

  revalidatePath('/today');
  revalidatePath('/appointments');
  revalidatePath('/sales');
  revalidatePath('/logs');
  return { ok: true, saleWarning };
}

const rescheduleSchema = z.object({
  id: z.string().uuid(),
  scheduledFor: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date/time.'),
});

/**
 * Decision D1: rescheduling does NOT move the appointment's date. It ends
 * this appointment as `rescheduled` and creates a successor, linked by
 * `rescheduled_to_id`.
 *
 * Editing a pending appointment's date on the form is the other thing --
 * fixing a typo -- and deliberately stays a plain edit. The difference
 * matters because a reschedule is real re-booking work the SMD is
 * measuring: per D2 the successor carries its own `set_on` and counts as a
 * new Appts Set. Suppressing that would hide activity that happened.
 *
 * Per D3 neither row enters the no-show denominator: the predecessor was
 * continued rather than missed, and the successor has no outcome yet.
 */
export async function rescheduleAppointmentAction(formData: FormData) {
  const parsed = rescheduleSchema.safeParse({
    id: formData.get('id'),
    scheduledFor: formData.get('scheduledFor'),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const session = await requireAgent();
  const today = todayIso(session.agent!.time_zone);
  const supabase = await createClient();

  const { data: predecessor } = await supabase
    .from('appointments')
    .select('id, status, appt_type, contact_id, org_id, expected_premium_cents, rescheduled_to_id')
    .eq('id', parsed.data.id)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!predecessor) return { ok: false, error: 'Appointment not found.' };
  // Idempotent under a double-tap or an offline replay (E16/E17): the
  // first call leaves the row terminal with a successor attached, and
  // every later one finds it and stops. Without this, two taps would
  // create two successors and two Appts Set events for one rebooking.
  if (predecessor.rescheduled_to_id) return { ok: true, id: predecessor.rescheduled_to_id };
  if (predecessor.status !== 'scheduled') {
    return { ok: false, error: 'That appointment already has an outcome.' };
  }

  const { data: successor, error: insertError } = await supabase
    .from('appointments')
    .insert({
      agent_id: session.agent!.id,
      org_id: predecessor.org_id,
      contact_id: predecessor.contact_id,
      appt_type: predecessor.appt_type,
      status: 'scheduled',
      // D2: the rebooking happened today, so today is where the new Appts
      // Set event lands -- not the predecessor's original booking day.
      set_on: today,
      scheduled_for: parsed.data.scheduledFor,
      appt_date: isoToDateInZone(parsed.data.scheduledFor, session.agent!.time_zone),
      // The opportunity moved with the appointment; Open Pipeline should
      // not drop just because a prospect changed the day. Referrals and
      // notes do not carry -- those describe a meeting that did not happen.
      expected_premium_cents: predecessor.expected_premium_cents,
    })
    .select('id')
    .single();

  if (insertError || !successor) {
    console.error('rescheduleAppointmentAction: successor insert failed', insertError);
    return { ok: false, error: 'Could not create the new appointment.' };
  }

  const { error: linkError } = await supabase
    .from('appointments')
    .update({
      status: 'rescheduled',
      resolved_on: today,
      rescheduled_to_id: successor.id,
    })
    .eq('id', parsed.data.id)
    .eq('agent_id', session.agent!.id);

  if (linkError) {
    // Roll the successor back rather than leaving it behind. An orphan
    // here is not harmless: it carries its own set_on, so it would count a
    // second Appts Set for a rebooking that never completed, and the
    // original would still be sitting in the queue as pending.
    await supabase.from('appointments').delete().eq('id', successor.id).eq('agent_id', session.agent!.id);
    console.error('rescheduleAppointmentAction: link failed, successor rolled back', linkError);
    return { ok: false, error: 'Could not reschedule — try again.' };
  }

  revalidatePath('/today');
  revalidatePath('/appointments');
  revalidatePath('/logs');
  return { ok: true, id: successor.id };
}

/**
 * What a delete would take with it (F16).
 *
 * `sales.appointment_id` and `recruiting_logs.appointment_id` are both
 * `ON DELETE SET NULL`, so deleting an appointment silently severs the
 * link and leaves the sale counting in sales_count/premium_cents with
 * nothing in the appointment UI pointing at it any more. The row menu asks
 * this first and makes the agent choose, rather than discovering it later
 * from a premium total that will not reconcile.
 */
export async function appointmentDeleteImpactAction(id: string) {
  const session = await requireAgent();
  const supabase = await createClient();

  const [{ data: sale }, { data: recruitingLog }] = await Promise.all([
    supabase
      .from('sales')
      .select('id, premium_cents')
      .eq('appointment_id', id)
      .eq('agent_id', session.agent!.id)
      .maybeSingle(),
    supabase
      .from('recruiting_logs')
      .select('id')
      .eq('appointment_id', id)
      .eq('agent_id', session.agent!.id)
      .maybeSingle(),
  ]);

  return {
    saleId: sale?.id ?? null,
    salePremiumCents: sale?.premium_cents ?? 0,
    recruitingLogId: recruitingLog?.id ?? null,
  };
}

/**
 * The details the resolve sheet needs to open on an appointment.
 *
 * Fetched on demand rather than added to `my_followups`' return shape: the
 * queue RPC runs on every My Day load for every row, and these columns are
 * only ever read after an agent has explicitly chosen to resolve one of
 * them. It also keeps the two call sites -- My Day and /appointments --
 * loading the sheet from one place instead of each passing its own
 * differently-shaped props.
 */
export async function appointmentResolveDefaultsAction(id: string) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { data: appt } = await supabase
    .from('appointments')
    .select('id, appt_type, status, expected_premium_cents, referrals_given, notes, scheduled_for, appt_date, contacts(full_name)')
    .eq('id', id)
    .eq('agent_id', session.agent!.id)
    .maybeSingle();

  if (!appt) return null;

  return {
    apptType: appt.appt_type,
    status: appt.status,
    expectedPremiumCents: appt.expected_premium_cents,
    referralsGiven: appt.referrals_given,
    notes: appt.notes,
    // appt_date as the fallback keeps a legacy or imported row -- which has
    // no slot at all -- from defaulting the reschedule picker to today and
    // quietly losing the date it was actually for (the F6 mistake).
    scheduledFor: appt.scheduled_for,
    apptDate: appt.appt_date,
    contactName: (appt.contacts as { full_name: string } | null)?.full_name ?? '',
  };
}
