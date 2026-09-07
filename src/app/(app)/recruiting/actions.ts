'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { findOrCreateContact } from '@/lib/contacts';
import { todayIso } from '@/lib/dates';

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
const RECRUIT_STATUSES = [
  'contacted',
  'marketing_presented',
  'recruited',
  'certified',
  'licensed',
  'declined',
] as const;

const recruitingSchema = z.object({
  prospectName: z.string().min(1, 'Enter the prospect name.').max(200),
  logDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date.'),
  source: z.enum(CALL_SOURCES).optional(),
  status: z.enum(RECRUIT_STATUSES),
  notes: z.string().max(2000).optional(),
  clientRequestId: z.string().optional(),
  // Set when this log is created via the appointment form's "Recruited?"
  // toggle -- lets a later edit of that same appointment find this row
  // again (recruiting_logs_appointment_uq) instead of inserting a duplicate.
  appointmentId: z.string().uuid().optional(),
});

// Postgres unique-violation error code.
const UNIQUE_VIOLATION = '23505';

// P3: minimal CRUD only. Filters/summary/CSV land in P4 per docs/08-screen-specs.md.
export async function createRecruitingLogAction(formData: FormData) {
  // Fetched before validation so the logDate fallback below uses the
  // agent's own local today, not the server's UTC one.
  const session = await requireAgent();

  const parsed = recruitingSchema.safeParse({
    prospectName: formData.get('prospectName'),
    logDate: formData.get('logDate') || todayIso(session.agent!.time_zone),
    source: formData.get('source') || undefined,
    status: formData.get('status') || 'contacted',
    notes: formData.get('notes') || undefined,
    clientRequestId: formData.get('clientRequestId') || undefined,
    appointmentId: formData.get('appointmentId') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const agentId = session.agent!.id;
  // Non-null: only associates/leaders reach this action (admin has no org).
  const orgId = session.agent!.org_id!;
  const supabase = await createClient();

  const contact = await findOrCreateContact(supabase, agentId, orgId, parsed.data.prospectName);
  if ('error' in contact) return { ok: false, error: contact.error };

  // recruiting_logs.appointment_id isn't in generated types yet -- migration
  // 20260907130000_p20b hasn't been applied/regenerated (npm run types).
  // Drop the cast below once it has.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase.from('recruiting_logs').insert({
    agent_id: agentId,
    org_id: orgId,
    contact_id: contact.id,
    appointment_id: parsed.data.appointmentId || null,
    log_date: parsed.data.logDate,
    source: parsed.data.source || null,
    status: parsed.data.status,
    notes: parsed.data.notes || null,
    client_request_id: parsed.data.clientRequestId || null,
  } as any);

  // A duplicate client_request_id means this exact submission already
  // succeeded (offline retry) -- treat as success, not an error.
  if (error && error.code !== UNIQUE_VIOLATION) {
    console.error('createRecruitingLogAction: insert failed', error);
    return { ok: false, error: 'Could not save the recruiting log.' };
  }

  revalidatePath('/recruiting');
  revalidatePath('/logs');
  revalidatePath(`/contacts/${contact.id}`);
  return { ok: true };
}

const updateSchema = recruitingSchema.partial({ prospectName: true }).extend({
  id: z.string().uuid(),
});

export async function updateRecruitingLogAction(formData: FormData) {
  const parsed = updateSchema.safeParse({
    id: formData.get('id'),
    logDate: formData.get('logDate'),
    source: formData.get('source') || undefined,
    status: formData.get('status'),
    notes: formData.get('notes') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase
    .from('recruiting_logs')
    .update({
      log_date: parsed.data.logDate,
      source: parsed.data.source || null,
      status: parsed.data.status,
      notes: parsed.data.notes || null,
    })
    .eq('id', parsed.data.id)
    .eq('agent_id', session.agent!.id);

  if (error) {
    console.error('updateRecruitingLogAction: update failed', error);
    return { ok: false, error: 'Could not update the recruiting log.' };
  }

  revalidatePath('/recruiting');
  revalidatePath('/logs');
  return { ok: true };
}

const syncFromAppointmentSchema = z.object({
  id: z.string().uuid(),
  logDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date.'),
  status: z.enum(RECRUIT_STATUSES),
});

/**
 * Narrow update used only by the appointment form's "Recruited?" toggle, to
 * keep an already-linked recruiting log (recruiting_logs.appointment_id) in
 * sync with the appointment's own date. Unlike updateRecruitingLogAction,
 * this never touches source/notes -- those belong solely to the Recruiting
 * tab's own edit form, and would otherwise get silently wiped to null on
 * every appointment save since the appointment form has no fields for them.
 */
export async function syncRecruitingLogFromAppointmentAction(formData: FormData) {
  const session = await requireAgent();
  const parsed = syncFromAppointmentSchema.safeParse({
    id: formData.get('id'),
    logDate: formData.get('logDate'),
    status: formData.get('status'),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('recruiting_logs')
    .update({
      log_date: parsed.data.logDate,
      status: parsed.data.status,
    })
    .eq('id', parsed.data.id)
    .eq('agent_id', session.agent!.id);

  if (error) {
    console.error('syncRecruitingLogFromAppointmentAction: update failed', error);
    return { ok: false, error: 'Could not update the linked recruiting log.' };
  }

  revalidatePath('/recruiting');
  revalidatePath('/logs');
  return { ok: true };
}

export async function updateRecruitingStatusAction(id: string, status: (typeof RECRUIT_STATUSES)[number]) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase
    .from('recruiting_logs')
    .update({ status })
    .eq('id', id)
    .eq('agent_id', session.agent!.id);

  revalidatePath('/recruiting');
  revalidatePath('/logs');
  return { ok: !error };
}

export async function deleteRecruitingLogAction(id: string) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase
    .from('recruiting_logs')
    .delete()
    .eq('id', id)
    .eq('agent_id', session.agent!.id);

  revalidatePath('/recruiting');
  revalidatePath('/logs');
  return { ok: !error };
}
