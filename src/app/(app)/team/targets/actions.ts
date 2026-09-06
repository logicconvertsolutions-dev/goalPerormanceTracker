'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { nextCycleStart, todayIso } from '@/lib/dates';

const schema = z.object({
  agentId: z.string().uuid().nullable(),
  callsPerCycle: z.coerce.number().int().positive(),
  apptsHeldPerCycle: z.coerce.number().int().positive(),
  premiumDollarsPerCycle: z.coerce.number().nonnegative(),
  minCallsPerDay: z.coerce.number().int().positive(),
});

// Versioned by effective_from, always taking effect the start of the next
// 10-day cycle -- never mutates a *past* target row (CLAUDE.md rule 8). A
// row that hasn't taken effect yet has never scored anything, so saving
// again before the next cycle boundary corrects that still-pending row in
// place rather than colliding with it -- public.set_target (P19d) does this
// as an atomic INSERT ... ON CONFLICT DO UPDATE against the partial unique
// indexes on (org_id, effective_from) / (org_id, agent_id, effective_from),
// which supabase-js's own .upsert() can't target (partial-index conflict
// targets need a WHERE clause on the arbiter that on_conflict=columns has
// no way to express). The RPC replicates targets_insert's own authorization
// checks (leader/admin, is_upline_of, own org) since it runs as security
// definer; the targets_audit trigger still fires and logs 'insert.target'
// or 'update.target' depending on which path the ON CONFLICT takes.
export async function setTargetAction(formData: FormData) {
  const raw = {
    agentId: formData.get('agentId') || null,
    callsPerCycle: formData.get('callsPerCycle'),
    apptsHeldPerCycle: formData.get('apptsHeldPerCycle'),
    premiumDollarsPerCycle: formData.get('premiumDollarsPerCycle'),
    minCallsPerDay: formData.get('minCallsPerDay'),
  };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Check the values entered.' };

  const supabase = await createClient();
  const { data: me } = await supabase.auth.getUser();
  const { data: agent } = await supabase.from('agents').select('org_id, time_zone').eq('id', me.user!.id).single();
  if (!agent) return { ok: false, error: 'Not signed in.' };

  const { error } = await supabase.rpc('set_target', {
    p_agent_id: parsed.data.agentId,
    // Start of the next 10-day cycle from the leader's own local today --
    // not the server's UTC one, which could be a day ahead/behind near
    // their midnight.
    p_effective_from: nextCycleStart(todayIso(agent.time_zone)),
    p_calls_per_cycle: parsed.data.callsPerCycle,
    p_appts_held_per_cycle: parsed.data.apptsHeldPerCycle,
    p_premium_cents_per_cycle: Math.round(parsed.data.premiumDollarsPerCycle * 100),
    p_min_calls_per_day: parsed.data.minCallsPerDay,
  });

  revalidatePath('/team/targets');
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
