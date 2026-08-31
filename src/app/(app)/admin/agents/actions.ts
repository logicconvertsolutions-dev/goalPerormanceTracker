'use server';

import { z } from 'zod';
import { randomBytes, createHash } from 'crypto';
import { revalidatePath } from 'next/cache';
import { getSessionAgent } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/notifications/send';
import { emailChangeConfirmationEmail } from '@/lib/notifications/templates';
import { appUrl } from '@/lib/notifications/app-url';

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
  // Only needed when demoting an agent away from 'admin' -- an admin's
  // org_id/upline_id are nulled out on promotion (admin_set_agent_role), so
  // leaving admin means picking an org to rejoin.
  orgId: z.string().uuid().optional(),
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
    p_org_id: parsed.data.orgId,
  });

  revalidatePath('/admin/agents');
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

const requestEmailChangeSchema = z.object({
  agentId: z.string().uuid(),
  newEmail: z.string().email(),
});

/**
 * Starts an email change on an agent's account. Doesn't touch auth.users or
 * agents.email yet -- it mails a confirm link to the *new* address, and the
 * agent (not the admin) has to click it before anything actually changes.
 * See confirmEmailChangeAction in confirm-email-change/actions.ts for the
 * other half.
 */
export async function requestEmailChangeAction(input: z.infer<typeof requestEmailChangeSchema>) {
  const actor = await requireAdminActor();
  if ('error' in actor) return { ok: false, error: actor.error };
  const session = await getSessionAgent();

  const parsed = requestEmailChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Enter a valid email address.' };

  const admin = createAdminClient();
  const { data: agent } = await admin
    .from('agents')
    .select('id, full_name, email')
    .eq('id', parsed.data.agentId)
    .maybeSingle();
  if (!agent) return { ok: false, error: 'Agent not found.' };
  if (agent.email.toLowerCase() === parsed.data.newEmail.toLowerCase()) {
    return { ok: false, error: 'That is already this agent’s email.' };
  }

  const { data: existing } = await admin.from('agents').select('id').ilike('email', parsed.data.newEmail);
  if (existing && existing.length > 0) {
    return { ok: false, error: 'Another agent already uses that email.' };
  }

  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const { error } = await admin.from('agent_email_changes').insert({
    agent_id: parsed.data.agentId,
    new_email: parsed.data.newEmail.toLowerCase(),
    token_hash: tokenHash,
    requested_by: actor.id,
  });
  if (error) return { ok: false, error: 'Could not start the email change.' };

  try {
    const content = emailChangeConfirmationEmail({
      fullName: agent.full_name,
      adminName: session?.agent?.full_name ?? 'An administrator',
      confirmUrl: appUrl(`/confirm-email-change/${token}`),
    });
    await sendEmail({
      to: parsed.data.newEmail,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
  } catch (err) {
    console.error('[admin/agents] failed to send email-change confirmation', err);
    return { ok: false, error: 'Could not send the confirmation email — try again.' };
  }

  revalidatePath(`/admin/agents/${parsed.data.agentId}`);
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
