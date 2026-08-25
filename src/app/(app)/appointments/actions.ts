'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { findOrCreateContact } from '@/lib/contacts';
import { todayIso } from '@/lib/dates';

const APPT_STATUSES = ['scheduled', 'held', 'no_show', 'rescheduled', 'cancelled'] as const;

const appointmentSchema = z.object({
  contactName: z.string().min(1, 'Enter who the appointment is with.').max(200),
  company: z.string().max(200).optional(),
  apptDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date.'),
  apptType: z.string().max(200).optional(),
  status: z.enum(APPT_STATUSES),
  expectedPremiumCents: z.coerce.number().int().min(0).default(0),
  referralsGiven: z.coerce.number().int().min(0).default(0),
  notes: z.string().max(2000).optional(),
  clientRequestId: z.string().optional(),
});

// Postgres unique-violation error code.
const UNIQUE_VIOLATION = '23505';

// P3: minimal CRUD only. Filters/summary/CSV land in P4 per docs/08-screen-specs.md.
export async function createAppointmentAction(formData: FormData) {
  const parsed = appointmentSchema.safeParse({
    contactName: formData.get('contactName'),
    company: formData.get('company') || undefined,
    apptDate: formData.get('apptDate') || todayIso(),
    apptType: formData.get('apptType') || undefined,
    status: formData.get('status') || 'scheduled',
    expectedPremiumCents: formData.get('expectedPremiumCents') || 0,
    referralsGiven: formData.get('referralsGiven') || 0,
    notes: formData.get('notes') || undefined,
    clientRequestId: formData.get('clientRequestId') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const session = await requireAgent();
  const agentId = session.agent!.id;
  const orgId = session.agent!.org_id;
  const supabase = await createClient();

  const contact = await findOrCreateContact(
    supabase,
    agentId,
    orgId,
    parsed.data.contactName,
    parsed.data.company
  );
  if ('error' in contact) return { ok: false, error: contact.error };

  const { error } = await supabase.from('appointments').insert({
    agent_id: agentId,
    org_id: orgId,
    contact_id: contact.id,
    appt_date: parsed.data.apptDate,
    appt_type: parsed.data.apptType || null,
    status: parsed.data.status,
    expected_premium_cents: parsed.data.expectedPremiumCents,
    referrals_given: parsed.data.referralsGiven,
    notes: parsed.data.notes || null,
    client_request_id: parsed.data.clientRequestId || null,
  });

  // A duplicate client_request_id means this exact submission already
  // succeeded (offline retry) -- treat as success, not an error.
  if (error && error.code !== UNIQUE_VIOLATION) {
    console.error('createAppointmentAction: insert failed', error);
    return { ok: false, error: 'Could not save the appointment.' };
  }

  revalidatePath('/appointments');
  revalidatePath('/logs');
  revalidatePath(`/contacts/${contact.id}`);
  return { ok: true };
}

const updateSchema = appointmentSchema.partial({ contactName: true }).extend({
  id: z.string().uuid(),
});

export async function updateAppointmentAction(formData: FormData) {
  const parsed = updateSchema.safeParse({
    id: formData.get('id'),
    apptDate: formData.get('apptDate'),
    apptType: formData.get('apptType') || undefined,
    status: formData.get('status'),
    expectedPremiumCents: formData.get('expectedPremiumCents') || 0,
    referralsGiven: formData.get('referralsGiven') || 0,
    notes: formData.get('notes') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase
    .from('appointments')
    .update({
      appt_date: parsed.data.apptDate,
      appt_type: parsed.data.apptType || null,
      status: parsed.data.status,
      expected_premium_cents: parsed.data.expectedPremiumCents,
      referrals_given: parsed.data.referralsGiven,
      notes: parsed.data.notes || null,
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

  const { error } = await supabase
    .from('appointments')
    .update({ status })
    .eq('id', id)
    .eq('agent_id', session.agent!.id);

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
