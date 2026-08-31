'use server';

import { createHash } from 'crypto';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';

const tokenSchema = z.string().min(1);

export interface ConfirmEmailChangeResult {
  ok: boolean;
  error?: string;
}

/**
 * The agent-facing half of the admin-initiated email change (see
 * requestEmailChangeAction in admin/agents/actions.ts) -- re-validates the
 * token server-side rather than trusting whatever state the page rendered,
 * same reasoning as acceptInvitation(). No session required: the agent may
 * not be signed in when they click the email link.
 */
export async function confirmEmailChangeAction(token: string): Promise<ConfirmEmailChangeResult> {
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) return { ok: false, error: 'Invalid link.' };

  const tokenHash = createHash('sha256').update(parsed.data).digest('hex');
  const admin = createAdminClient();

  const { data: change } = await admin
    .from('agent_email_changes')
    .select('id, agent_id, new_email, confirmed_at, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!change) return { ok: false, error: 'This link isn’t valid.' };
  if (change.confirmed_at) return { ok: false, error: 'This link has already been used.' };
  if (new Date(change.expires_at) < new Date()) {
    return { ok: false, error: 'This link has expired. Ask your admin to send a new one.' };
  }

  const { data: stillFree } = await admin.from('agents').select('id').ilike('email', change.new_email);
  if (stillFree && stillFree.some((a) => a.id !== change.agent_id)) {
    return { ok: false, error: 'Another agent has since taken that email — ask your admin to try again.' };
  }

  const { error: authError } = await admin.auth.admin.updateUserById(change.agent_id, {
    email: change.new_email,
    email_confirm: true,
  });
  if (authError) return { ok: false, error: 'Could not update your login email — try again.' };

  const { error: agentError } = await admin
    .from('agents')
    .update({ email: change.new_email })
    .eq('id', change.agent_id);
  if (agentError) return { ok: false, error: 'Could not update your profile email — try again.' };

  await admin.from('agent_email_changes').update({ confirmed_at: new Date().toISOString() }).eq('id', change.id);

  const { data: agent } = await admin.from('agents').select('org_id').eq('id', change.agent_id).maybeSingle();
  await admin.from('audit_log').insert({
    org_id: agent?.org_id ?? null,
    actor_id: change.agent_id,
    action: 'agent.email_changed',
    entity: 'agent',
    entity_id: change.agent_id,
    metadata: { new_email: change.new_email },
  });

  return { ok: true };
}
