'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { nextMonday, todayIso } from '@/lib/dates';

const schema = z.object({
  agentId: z.string().uuid().nullable(),
  callsPerWeek: z.coerce.number().int().positive(),
  apptsHeldPerWeek: z.coerce.number().int().positive(),
  premiumDollarsPerWeek: z.coerce.number().nonnegative(),
  minCallsPerDay: z.coerce.number().int().positive(),
});

// Insert-only — never mutate a past target row (CLAUDE.md rule 8). Always
// takes effect the coming Monday; targets_insert RLS (leader/admin,
// is_upline_of, own org) does the authorization, and the targets_audit_insert
// trigger (p5a migration) logs it.
export async function setTargetAction(formData: FormData) {
  const raw = {
    agentId: formData.get('agentId') || null,
    callsPerWeek: formData.get('callsPerWeek'),
    apptsHeldPerWeek: formData.get('apptsHeldPerWeek'),
    premiumDollarsPerWeek: formData.get('premiumDollarsPerWeek'),
    minCallsPerDay: formData.get('minCallsPerDay'),
  };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Check the values entered.' };

  const supabase = await createClient();
  const { data: me } = await supabase.auth.getUser();
  const { data: agent } = await supabase.from('agents').select('org_id').eq('id', me.user!.id).single();
  if (!agent) return { ok: false, error: 'Not signed in.' };

  const { error } = await supabase.from('targets').insert({
    org_id: agent.org_id,
    agent_id: parsed.data.agentId,
    set_by: me.user!.id,
    effective_from: nextMonday(todayIso()),
    calls_per_week: parsed.data.callsPerWeek,
    appts_held_per_week: parsed.data.apptsHeldPerWeek,
    premium_cents_per_week: Math.round(parsed.data.premiumDollarsPerWeek * 100),
    min_calls_per_day: parsed.data.minCallsPerDay,
  });

  revalidatePath('/team/targets');
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
