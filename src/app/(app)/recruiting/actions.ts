'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { findOrCreateContact } from '@/lib/contacts';
import { todayIso } from '@/lib/dates';

const CALL_SOURCES = ['warm_market', 'referral', 'cold', 'social_media', 'friend', 'other'] as const;
const RECRUIT_STATUSES = ['contacted', 'interviewed', 'joined', 'licensed', 'declined'] as const;

const recruitingSchema = z.object({
  prospectName: z.string().min(1, 'Enter the prospect name.').max(200),
  logDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date.'),
  source: z.enum(CALL_SOURCES).optional(),
  status: z.enum(RECRUIT_STATUSES),
  notes: z.string().max(2000).optional(),
  clientRequestId: z.string().optional(),
});

// Postgres unique-violation error code.
const UNIQUE_VIOLATION = '23505';

// P3: minimal CRUD only. Filters/summary/CSV land in P4 per docs/08-screen-specs.md.
export async function createRecruitingLogAction(formData: FormData) {
  const parsed = recruitingSchema.safeParse({
    prospectName: formData.get('prospectName'),
    logDate: formData.get('logDate') || todayIso(),
    source: formData.get('source') || undefined,
    status: formData.get('status') || 'contacted',
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

  const contact = await findOrCreateContact(supabase, agentId, orgId, parsed.data.prospectName);
  if ('error' in contact) return { ok: false, error: contact.error };

  const { error } = await supabase.from('recruiting_logs').insert({
    agent_id: agentId,
    org_id: orgId,
    contact_id: contact.id,
    log_date: parsed.data.logDate,
    source: parsed.data.source || null,
    status: parsed.data.status,
    notes: parsed.data.notes || null,
    client_request_id: parsed.data.clientRequestId || null,
  });

  // A duplicate client_request_id means this exact submission already
  // succeeded (offline retry) -- treat as success, not an error.
  if (error && error.code !== UNIQUE_VIOLATION) {
    return { ok: false, error: 'Could not save the recruiting log.' };
  }

  revalidatePath('/recruiting');
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

  if (error) return { ok: false, error: 'Could not update the recruiting log.' };

  revalidatePath('/recruiting');
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
  return { ok: !error };
}
