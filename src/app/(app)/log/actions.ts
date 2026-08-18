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
  company: z.string().max(200).optional(),
  callDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date.'),
  source: z.enum(CALL_SOURCES),
  outcome: z.enum(CALL_OUTCOMES),
  notes: z.string().max(2000).optional(),
  followUpOn: z.string().optional(),
});

export async function logCallAction(formData: FormData) {
  const parsed = logCallSchema.safeParse({
    contactName: formData.get('contactName'),
    company: formData.get('company') || undefined,
    callDate: formData.get('callDate') || todayIso(),
    source: formData.get('source'),
    outcome: formData.get('outcome'),
    notes: formData.get('notes') || undefined,
    followUpOn: formData.get('followUpOn') || undefined,
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

  const { error } = await supabase.from('call_logs').insert({
    agent_id: agentId,
    org_id: orgId,
    contact_id: contact.id,
    call_date: parsed.data.callDate,
    source: parsed.data.source,
    outcome: parsed.data.outcome,
    notes: parsed.data.notes || null,
    follow_up_on: parsed.data.outcome === 'connected' ? parsed.data.followUpOn || null : null,
  });

  if (error) return { ok: false, error: 'Could not save the call.' };

  revalidatePath('/today');
  revalidatePath('/contacts');
  revalidatePath(`/contacts/${contact.id}`);
  return { ok: true };
}
