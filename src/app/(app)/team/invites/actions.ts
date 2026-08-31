'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionAgent } from '@/lib/auth/session';
import { sendEmail } from '@/lib/notifications/send';
import { inviteEmail } from '@/lib/notifications/templates';
import { appUrl } from '@/lib/notifications/app-url';
import { orgLogoUrl } from '@/lib/notifications/brand';

const emailListSchema = z.object({
  emails: z.string().min(1),
});

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((e) => e.trim())
    .filter(Boolean);
}

// The invitations table stores only a hash of the token (never the raw
// value), so the plaintext token/link create_invitation returns here is the
// only chance to deliver it -- lost the moment this call returns unless we
// email it or hand it back to the caller to show once.
async function sendInvite(
  email: string,
  token: string
): Promise<{ inviteUrl: string }> {
  const session = await getSessionAgent();
  const supabase = await createClient();
  const [{ data: org }, logoUrl] = await Promise.all([
    supabase.from('organizations').select('name').eq('id', session!.agent!.org_id).maybeSingle(),
    orgLogoUrl(session!.agent!.org_id),
  ]);

  const inviteUrl = appUrl(`/invite/${token}`);
  await sendEmail({
    to: email,
    ...inviteEmail({
      orgName: org?.name ?? 'the team',
      inviterName: session!.agent!.full_name,
      inviteUrl,
      logoUrl,
    }),
  });
  return { inviteUrl };
}

type CreateInvitesResult =
  | { ok: true; invites: { email: string; inviteUrl: string }[] }
  | { ok: false; error: string };

export async function createInvitationsAction(
  formData: FormData
): Promise<CreateInvitesResult> {
  const parsed = emailListSchema.safeParse({ emails: formData.get('emails') });
  if (!parsed.success) return { ok: false, error: 'Enter at least one email.' };

  const emails = parseEmails(parsed.data.emails);
  const emailSchema = z.string().email();
  const supabase = await createClient();

  const results = await Promise.all(
    emails.map(async (email) => {
      const valid = emailSchema.safeParse(email);
      if (!valid.success) return { email, ok: false, inviteUrl: null as string | null };
      const { data: token, error } = await supabase.rpc('create_invitation', {
        p_email: email,
        p_role: 'associate',
      });
      if (error || !token) return { email, ok: false, inviteUrl: null };
      const { inviteUrl } = await sendInvite(email, token);
      return { email, ok: true, inviteUrl };
    })
  );

  revalidatePath('/team/invites');
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    return {
      ok: false,
      error: `Couldn't invite: ${failed.map((f) => f.email).join(', ')}`,
    };
  }
  return {
    ok: true,
    invites: results.map((r) => ({ email: r.email, inviteUrl: r.inviteUrl! })),
  };
}

export async function resendInvitationAction(email: string) {
  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc('create_invitation', {
    p_email: email,
    p_role: 'associate',
  });
  revalidatePath('/team/invites');
  if (error || !token) return { ok: false, inviteUrl: null };
  const { inviteUrl } = await sendInvite(email, token);
  return { ok: true, inviteUrl };
}

export async function revokeInvitationAction(invitationId: string) {
  const supabase = await createClient();
  await supabase
    .from('invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', invitationId);
  revalidatePath('/team/invites');
}
