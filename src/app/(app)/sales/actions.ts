'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { findOrCreateContact } from '@/lib/contacts';
import { todayIso } from '@/lib/dates';

const saleSchema = z.object({
  clientName: z.string().min(1, 'Enter the client name.').max(200),
  contactId: z.string().uuid().optional(),
  // "Cannot be in the future" is checked below in createSaleAction, against
  // the acting agent's own local today -- see the identical comment in
  // appointments/actions.ts for why that can't live in a .refine() here.
  saleDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date.'),
  productType: z.string().max(200).optional(),
  premiumCents: z.coerce.number().int().min(0).default(0),
  notes: z.string().max(2000).optional(),
  followUpOn: z.string().optional(),
  clientRequestId: z.string().optional(),
  // Set when this sale is created via the appointment form's "Log as a
  // Sale" toggle -- lets a later edit of that same appointment find this
  // row again (sales_appointment_uq) instead of inserting a duplicate.
  appointmentId: z.string().uuid().optional(),
});

// Postgres unique-violation error code.
const UNIQUE_VIOLATION = '23505';

// P3: minimal CRUD only. Filters/summary/CSV land in P4 per docs/08-screen-specs.md.
export async function createSaleAction(formData: FormData) {
  // Fetched before validation -- see createAppointmentAction for why.
  const session = await requireAgent();
  const today = todayIso(session.agent!.time_zone);

  const parsed = saleSchema.safeParse({
    clientName: formData.get('clientName'),
    contactId: formData.get('contactId') || undefined,
    saleDate: formData.get('saleDate') || today,
    productType: formData.get('productType') || undefined,
    premiumCents: formData.get('premiumCents') || 0,
    notes: formData.get('notes') || undefined,
    followUpOn: formData.get('followUpOn') || undefined,
    clientRequestId: formData.get('clientRequestId') || undefined,
    appointmentId: formData.get('appointmentId') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  if (parsed.data.saleDate > today) {
    return { ok: false, error: 'Sale date cannot be in the future.' };
  }

  const agentId = session.agent!.id;
  // Non-null: only associates/leaders reach this action (admin has no org).
  const orgId = session.agent!.org_id!;
  const supabase = await createClient();

  const contact = await findOrCreateContact(
    supabase,
    agentId,
    orgId,
    parsed.data.clientName,
    parsed.data.contactId
  );
  if ('error' in contact) return { ok: false, error: contact.error };

  const { error } = await supabase.from('sales').insert({
    agent_id: agentId,
    org_id: orgId,
    contact_id: contact.id,
    appointment_id: parsed.data.appointmentId || null,
    sale_date: parsed.data.saleDate,
    product_type: parsed.data.productType || null,
    premium_cents: parsed.data.premiumCents,
    notes: parsed.data.notes || null,
    follow_up_on: parsed.data.followUpOn || null,
    client_request_id: parsed.data.clientRequestId || null,
  });

  // A duplicate client_request_id means this exact submission already
  // succeeded (offline retry) -- treat as success, not an error.
  if (error && error.code !== UNIQUE_VIOLATION) {
    console.error('createSaleAction: insert failed', error);
    return { ok: false, error: 'Could not save the sale.' };
  }

  revalidatePath('/sales');
  revalidatePath('/logs');
  revalidatePath(`/contacts/${contact.id}`);
  return { ok: true };
}

const updateSchema = saleSchema.partial({ clientName: true }).extend({
  id: z.string().uuid(),
});

export async function updateSaleAction(formData: FormData) {
  const parsed = updateSchema.safeParse({
    id: formData.get('id'),
    saleDate: formData.get('saleDate'),
    productType: formData.get('productType') || undefined,
    premiumCents: formData.get('premiumCents') || 0,
    notes: formData.get('notes') || undefined,
    followUpOn: formData.get('followUpOn') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const session = await requireAgent();
  if (parsed.data.saleDate && parsed.data.saleDate > todayIso(session.agent!.time_zone)) {
    return { ok: false, error: 'Sale date cannot be in the future.' };
  }
  const supabase = await createClient();

  const { error } = await supabase
    .from('sales')
    .update({
      sale_date: parsed.data.saleDate,
      product_type: parsed.data.productType || null,
      premium_cents: parsed.data.premiumCents,
      notes: parsed.data.notes || null,
      follow_up_on: parsed.data.followUpOn || null,
    })
    .eq('id', parsed.data.id)
    .eq('agent_id', session.agent!.id);

  if (error) {
    console.error('updateSaleAction: update failed', error);
    return { ok: false, error: 'Could not update the sale.' };
  }

  revalidatePath('/sales');
  revalidatePath('/logs');
  return { ok: true };
}

const syncFromAppointmentSchema = z.object({
  id: z.string().uuid(),
  saleDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date.'),
  productType: z.string().max(200).optional(),
  premiumCents: z.coerce.number().int().min(0).default(0),
});

/**
 * Narrow update used only by the appointment form's "Log as a Sale" toggle,
 * to keep an already-linked sale (sales.appointment_id) in sync with the
 * appointment's own date/premium/product type. Unlike updateSaleAction,
 * this never touches notes/follow_up_on -- those belong solely to the Sales
 * tab's own edit form, and would otherwise get silently wiped to null on
 * every appointment save since the appointment form has no fields for them.
 */
export async function syncSaleFromAppointmentAction(formData: FormData) {
  const session = await requireAgent();
  const parsed = syncFromAppointmentSchema.safeParse({
    id: formData.get('id'),
    saleDate: formData.get('saleDate'),
    productType: formData.get('productType') || undefined,
    premiumCents: formData.get('premiumCents') || 0,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('sales')
    .update({
      sale_date: parsed.data.saleDate,
      product_type: parsed.data.productType || null,
      premium_cents: parsed.data.premiumCents,
    })
    .eq('id', parsed.data.id)
    .eq('agent_id', session.agent!.id);

  if (error) {
    console.error('syncSaleFromAppointmentAction: update failed', error);
    return { ok: false, error: 'Could not update the linked sale.' };
  }

  revalidatePath('/sales');
  revalidatePath('/logs');
  return { ok: true };
}

export async function deleteSaleAction(id: string) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase.from('sales').delete().eq('id', id).eq('agent_id', session.agent!.id);

  revalidatePath('/sales');
  revalidatePath('/logs');
  return { ok: !error };
}
