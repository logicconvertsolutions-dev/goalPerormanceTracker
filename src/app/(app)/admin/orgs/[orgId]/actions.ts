'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { getSessionAgent } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/notifications/send';
import { inviteEmail } from '@/lib/notifications/templates';
import { appUrl } from '@/lib/notifications/app-url';

// Same convention as admin/agents/actions.ts and admin/orgs/actions.ts: a
// Server Action returns an error instead of redirecting, and the admin
// check happens here rather than via requireAdmin() (meant for page loads).
// admin_add_roster_member / admin_remove_roster_member /
// admin_invite_roster_member are revoked from every PostgREST role and
// callable only through the service-role client
// (20260917100000_p21a_admin_org_roster.sql) -- that grant, not this check
// alone, is the actual security boundary.
async function requireAdminActor(): Promise<{ id: string; fullName: string } | { error: string }> {
  const session = await getSessionAgent();
  if (!session?.agent || session.agent.role !== 'admin') {
    return { error: 'Admin access required.' };
  }
  if (!session.mfaVerified) {
    return { error: 'MFA verification required.' };
  }
  return { id: session.agent.id, fullName: session.agent.full_name };
}

// admin_add_roster_member/admin_remove_roster_member/admin_invite_roster_member
// ship in this same change's migration and aren't in generated
// types/database.ts yet -- that file regenerates only after the migration
// is reviewed and pushed (CLAUDE.md's DB-change workflow), not before. Cast
// to the untyped client for just these three calls rather than hand-editing
// the generated file.
function untypedRpc(client: ReturnType<typeof createAdminClient>) {
  return client as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
}

const addSchema = z.object({
  orgId: z.string().uuid(),
  uplineId: z.string().uuid(),
  fullName: z.string().min(1, 'Enter a name.').max(200),
  email: z.string().email('Enter a valid email.'),
  phone: z.string().max(30).optional(),
});

export async function adminAddRosterMemberAction(formData: FormData) {
  const actor = await requireAdminActor();
  if ('error' in actor) return { ok: false, error: actor.error };

  const parsed = addSchema.safeParse({
    orgId: formData.get('orgId'),
    uplineId: formData.get('uplineId'),
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    phone: formData.get('phone') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const admin = createAdminClient();
  const { error } = await untypedRpc(admin).rpc('admin_add_roster_member', {
    p_actor_id: actor.id,
    p_org_id: parsed.data.orgId,
    p_upline_id: parsed.data.uplineId,
    p_full_name: parsed.data.fullName,
    p_email: parsed.data.email,
    p_phone: parsed.data.phone ?? null,
  });

  revalidatePath(`/admin/orgs/${parsed.data.orgId}`);
  if (error) return { ok: false, error: error.message || 'Could not add team member.' };
  return { ok: true };
}

const rosterIdSchema = z.object({ rosterId: z.string().uuid(), orgId: z.string().uuid() });

export async function adminRemoveRosterMemberAction(rosterId: string, orgId: string) {
  const actor = await requireAdminActor();
  if ('error' in actor) return { ok: false, error: actor.error };

  const parsed = rosterIdSchema.safeParse({ rosterId, orgId });
  if (!parsed.success) return { ok: false, error: 'Invalid roster entry.' };

  const admin = createAdminClient();
  const { error } = await untypedRpc(admin).rpc('admin_remove_roster_member', {
    p_actor_id: actor.id,
    p_roster_id: parsed.data.rosterId,
  });

  revalidatePath(`/admin/orgs/${parsed.data.orgId}`);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

type InviteResult = { ok: true; inviteUrl: string; emailSent: boolean } | { ok: false; error: string };

export async function adminInviteRosterMemberAction(
  rosterId: string,
  orgId: string
): Promise<InviteResult> {
  const actor = await requireAdminActor();
  if ('error' in actor) return { ok: false, error: actor.error };

  const parsed = rosterIdSchema.safeParse({ rosterId, orgId });
  if (!parsed.success) return { ok: false, error: 'Invalid roster entry.' };

  const admin = createAdminClient();
  const { data: token, error } = await untypedRpc(admin).rpc('admin_invite_roster_member', {
    p_actor_id: actor.id,
    p_roster_id: parsed.data.rosterId,
  });

  revalidatePath(`/admin/orgs/${parsed.data.orgId}`);
  if (error || !token || typeof token !== 'string') {
    return { ok: false, error: error?.message ?? 'Could not send invite.' };
  }

  // Regular (non-service-role) client here is fine -- organizations_admin_read
  // already lets an admin read any org's name.
  const supabase = await createClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', parsed.data.orgId)
    .maybeSingle();
  const { data: roster } = await supabase
    .from('team_roster')
    .select('email')
    .eq('id', parsed.data.rosterId)
    .maybeSingle();

  const inviteUrl = appUrl(`/invite/${token}`);
  let emailSent = true;
  if (roster?.email) {
    try {
      await sendEmail({
        to: roster.email,
        ...inviteEmail({
          orgName: org?.name ?? 'the team',
          inviterName: actor.fullName,
          inviteUrl,
        }),
      });
    } catch (err) {
      console.error('[admin/orgs] failed to send roster invite email', err);
      emailSent = false;
    }
  }

  return { ok: true, inviteUrl, emailSent };
}
