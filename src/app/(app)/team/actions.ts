'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const nudgeSchema = z.object({ agentId: z.string().uuid() });

// Rate-limited stub: records the nudge and audit-logs it via nudge_agent
// (supabase/migrations/20260818194500_p5a_team_dashboard_rpcs.sql). Actual
// email delivery is P5.5's job, reusing this same RPC.
export async function nudgeAgentAction(agentId: string) {
  const parsed = nudgeSchema.safeParse({ agentId });
  if (!parsed.success) return { ok: false, message: 'Invalid agent' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('nudge_agent', { p_agent_id: parsed.data.agentId });

  revalidatePath('/team');
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
