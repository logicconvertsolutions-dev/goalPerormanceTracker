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
  saleDate: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date.')
    .refine((v) => v <= todayIso(), 'Sale date cannot be in the future.'),
  productType: z.string().max(200).optional(),
  premiumCents: z.coerce.number().int().min(0).default(0),
  notes: z.string().max(2000).optional(),
  followUpOn: z.string().optional(),
  clientRequestId: z.string().optional(),
});

// Postgres unique-violation error code.
const UNIQUE_VIOLATION = '23505';

// P3: minimal CRUD only. Filters/summary/CSV land in P4 per docs/08-screen-specs.md.
export async function createSaleAction(formData: FormData) {
  const parsed = saleSchema.safeParse({
    clientName: formData.get('clientName'),
    contactId: formData.get('contactId') || undefined,
    saleDate: formData.get('saleDate') || todayIso(),
    productType: formData.get('productType') || undefined,
    premiumCents: formData.get('premiumCents') || 0,
    notes: formData.get('notes') || undefined,
    followUpOn: formData.get('followUpOn') || undefined,
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
    parsed.data.clientName,
    parsed.data.contactId
  );
  if ('error' in contact) return { ok: false, error: contact.error };

  const { error } = await supabase.from('sales').insert({
    agent_id: agentId,
    org_id: orgId,
    contact_id: contact.id,
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
    return { ok: false, error: 'Could not save the sale.' };
  }

  revalidatePath('/sales');
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

  if (error) return { ok: false, error: 'Could not update the sale.' };

  revalidatePath('/sales');
  return { ok: true };
}

export async function deleteSaleAction(id: string) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase.from('sales').delete().eq('id', id).eq('agent_id', session.agent!.id);

  revalidatePath('/sales');
  return { ok: !error };
}
