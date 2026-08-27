'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { getSessionAgent } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';

// Same convention as admin/orgs/actions.ts: a Server Action returns an
// error instead of redirecting, and the admin check happens here rather
// than via requireAdmin() (meant for page loads). All three RPCs are
// revoked from every PostgREST role and callable only through the
// service-role client (20260819100000_p6a_admin_agent_lifecycle.sql).
async function requireAdminActor(): Promise<{ id: string } | { error: string }> {
  const session = await getSessionAgent();
  if (!session?.agent || session.agent.role !== 'admin') {
    return { error: 'Admin access required.' };
  }
  if (!session.mfaVerified) {
    return { error: 'MFA verification required.' };
  }
  return { id: session.agent.id };
}

const moveSchema = z.object({
  agentId: z.string().uuid(),
  newUplineId: z.string().uuid().nullable(),
});

export async function moveAgentAction(input: z.infer<typeof moveSchema>) {
  const actor = await requireAdminActor();
  if ('error' in actor) return { ok: false, error: actor.error };

  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };

  const admin = createAdminClient();
  const { error } = await admin.rpc('admin_move_agent', {
    p_actor_id: actor.id,
    p_agent_id: parsed.data.agentId,
    // Generated types don't mark this param nullable (codegen only adds `?`
    // for params with a SQL default, not for a nullable type) -- the
    // function signature (p_new_upline_id uuid) genuinely accepts null for
    // "no upline", and Postgres is fine with it at runtime.
    p_new_upline_id: parsed.data.newUplineId as string,
  });

  revalidatePath('/admin/agents');
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

const agentIdSchema = z.object({ agentId: z.string().uuid() });

export async function reactivateAgentAction(agentId: string) {
  const actor = await requireAdminActor();
  if ('error' in actor) return { ok: false, error: actor.error };

  const parsed = agentIdSchema.safeParse({ agentId });
  if (!parsed.success) return { ok: false, error: 'Invalid agent.' };

  const admin = createAdminClient();
  const { error } = await admin.rpc('admin_reactivate_agent', {
    p_actor_id: actor.id,
    p_agent_id: parsed.data.agentId,
  });

  revalidatePath('/admin/agents');
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

const setRoleSchema = z.object({
  agentId: z.string().uuid(),
  role: z.enum(['associate', 'leader', 'admin']),
});

export async function setAgentRoleAction(input: z.infer<typeof setRoleSchema>) {
  const actor = await requireAdminActor();
  if ('error' in actor) return { ok: false, error: actor.error };

  const parsed = setRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };

  const admin = createAdminClient();
  const { error } = await admin.rpc('admin_set_agent_role', {
    p_actor_id: actor.id,
    p_agent_id: parsed.data.agentId,
    p_role: parsed.data.role,
  });

  revalidatePath('/admin/agents');
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function hardDeleteAgentAction(agentId: string) {
  const actor = await requireAdminActor();
  if ('error' in actor) return { ok: false, error: actor.error };

  const parsed = agentIdSchema.safeParse({ agentId });
  if (!parsed.success) return { ok: false, error: 'Invalid agent.' };

  const admin = createAdminClient();
  const { error } = await admin.rpc('admin_hard_delete_agent', {
    p_actor_id: actor.id,
    p_agent_id: parsed.data.agentId,
  });

  revalidatePath('/admin/agents');
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
