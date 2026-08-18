'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const schema = z.object({ agentId: z.string().uuid() });

export async function deactivateAgentAction(agentId: string) {
  const parsed = schema.safeParse({ agentId });
  if (!parsed.success) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase.rpc('deactivate_agent', {
    p_agent_id: parsed.data.agentId,
  });

  revalidatePath('/team/members');
  return { ok: !error };
}
