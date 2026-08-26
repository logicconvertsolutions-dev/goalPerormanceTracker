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
] as const;

const CALL_OUTCOMES = [
  'connected',
  'voicemail',
  'no_answer',
  'appointment_set',
  'not_interested',
] as const;

const logCallSchema = z.object({
  contactName: z.string().min(1, 'Enter who you called.').max(200),
  contactId: z.string().uuid().optional(),
  callDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date.'),
  source: z.enum(CALL_SOURCES),
  outcome: z.enum(CALL_OUTCOMES),
  notes: z.string().max(2000).optional(),
  followUpOn: z.string().optional(),
  clientRequestId: z.string().optional(),
});

// Postgres unique-violation error code.
const UNIQUE_VIOLATION = '23505';

export async function logCallAction(formData: FormData) {
  const parsed = logCallSchema.safeParse({
    contactName: formData.get('contactName'),
    contactId: formData.get('contactId') || undefined,
    callDate: formData.get('callDate') || todayIso(),
    source: formData.get('source'),
    outcome: formData.get('outcome'),
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

  const { error } = await supabase.from('call_logs').insert({
    agent_id: agentId,
    org_id: orgId,
    contact_id: contact.id,
    call_date: parsed.data.callDate,
    source: parsed.data.source,
    outcome: parsed.data.outcome,
    notes: parsed.data.notes || null,
    follow_up_on: parsed.data.followUpOn || null,
    client_request_id: parsed.data.clientRequestId || null,
  });

  // A duplicate client_request_id means this exact submission already
  // succeeded (offline retry) -- treat as success, not an error.
  if (error && error.code !== UNIQUE_VIOLATION) {
    console.error('logCallAction: insert failed', error);
    return { ok: false, error: 'Could not save the call.' };
  }

  revalidatePath('/today');
  revalidatePath('/contacts');
  revalidatePath(`/contacts/${contact.id}`);
  revalidatePath('/logs');
  return { ok: true };
}

const updateCallSchema = z.object({
  id: z.string().uuid(),
  callDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date.'),
  source: z.enum(CALL_SOURCES),
  outcome: z.enum(CALL_OUTCOMES),
  notes: z.string().max(2000).optional(),
  followUpOn: z.string().optional(),
});

export async function updateCallAction(formData: FormData) {
  const parsed = updateCallSchema.safeParse({
    id: formData.get('id'),
    callDate: formData.get('callDate'),
    source: formData.get('source'),
    outcome: formData.get('outcome'),
    notes: formData.get('notes') || undefined,
    followUpOn: formData.get('followUpOn') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase
    .from('call_logs')
    .update({
      call_date: parsed.data.callDate,
      source: parsed.data.source,
      outcome: parsed.data.outcome,
      notes: parsed.data.notes || null,
      follow_up_on: parsed.data.followUpOn || null,
    })
    .eq('id', parsed.data.id)
    .eq('agent_id', session.agent!.id);

  if (error) {
    console.error('updateCallAction: update failed', error);
    return { ok: false, error: 'Could not update the call.' };
  }

  revalidatePath('/today');
  revalidatePath('/logs');
  return { ok: true };
}

export async function deleteCallAction(id: string) {
  const session = await requireAgent();
  const supabase = await createClient();

  const { error } = await supabase.from('call_logs').delete().eq('id', id).eq('agent_id', session.agent!.id);

  revalidatePath('/logs');
  revalidatePath('/today');
  return { ok: !error };
}
