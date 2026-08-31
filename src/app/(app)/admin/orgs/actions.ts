'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { getSessionAgent } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/notifications/send';
import { inviteEmail } from '@/lib/notifications/templates';
import { appUrl } from '@/lib/notifications/app-url';

const schema = z.object({
  orgName: z.string().min(1).max(200),
  smdEmail: z.string().email(),
  smdName: z.string().min(1).max(200),
});

export async function provisionOrgAction(
  input: z.infer<typeof schema>
): Promise<{ ok: boolean; error?: string }> {
  // A Server Action needs a returned error, not a thrown redirect — check
  // the role directly rather than using the requireAdmin() guard, which
  // calls next/navigation's redirect() and is meant for page loads.
  const session = await getSessionAgent();
  if (!session?.agent || session.agent.role !== 'admin') {
    return { ok: false, error: 'Admin access required.' };
  }
  if (!session.mfaVerified) {
    return { ok: false, error: 'MFA verification required.' };
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the form fields.' };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('provision_org', {
    p_org_name: parsed.data.orgName,
    p_smd_email: parsed.data.smdEmail,
    p_smd_name: parsed.data.smdName,
  });

  if (error) return { ok: false, error: error.message };

  // provision_org only creates the org + a hashed invitation row — it never
  // sends mail itself (no email dependency inside a DB function). Same
  // "email is the only chance to deliver the raw token" reasoning as
  // sendInvite() in team/invites/actions.ts; skipping this left the SMD with
  // no way to ever see their invite link.
  const row = data?.[0];
  if (row?.invite_token) {
    try {
      await sendEmail({
        to: parsed.data.smdEmail,
        ...inviteEmail({
          orgName: parsed.data.orgName,
          inviterName: session.agent!.full_name,
          inviteUrl: appUrl(`/invite/${row.invite_token}`),
        }),
      });
    } catch (err) {
      console.error('[admin/orgs] failed to send SMD invite email', err);
    }
  }

  return { ok: true };
}

const deleteSchema = z.object({
  orgId: z.string().uuid(),
  orgName: z.string().min(1),
});

export async function deleteOrgAction(
  input: z.infer<typeof deleteSchema>
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSessionAgent();
  if (!session?.agent || session.agent.role !== 'admin') {
    return { ok: false, error: 'Admin access required.' };
  }
  if (!session.mfaVerified) {
    return { ok: false, error: 'MFA verification required.' };
  }

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the form fields.' };

  const admin = createAdminClient();

  // Confirm the caller actually knows which org this is (matches the
  // hard-delete-agent confirm-by-typing-the-name pattern in /admin/agents)
  // before touching anything irreversible.
  const { data: org } = await admin
    .from('organizations')
    .select('name, logo_path')
    .eq('id', parsed.data.orgId)
    .maybeSingle();
  if (!org || org.name !== parsed.data.orgName) {
    return { ok: false, error: 'Organization name does not match.' };
  }

  const { error } = await admin.rpc('admin_delete_org', {
    p_actor_id: session.agent!.id,
    p_org_id: parsed.data.orgId,
  });
  if (error) return { ok: false, error: error.message };

  // Best-effort: the DB delete already succeeded, an orphaned logo object
  // left in storage is a cleanup nicety, not a correctness issue worth
  // failing the whole action over.
  if (org.logo_path) {
    await admin.storage.from('org-logos').remove([org.logo_path]);
  }

  revalidatePath('/admin/orgs');
  return { ok: true };
}
