'use server';

import { z } from 'zod';
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
