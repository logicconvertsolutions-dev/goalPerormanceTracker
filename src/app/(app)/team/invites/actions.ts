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
//
// sendEmail() throws on a real send failure (Resend erroring, not just
// being unconfigured -- see send.ts), and by the time this runs
// create_invitation has already committed the invitation row. Letting that
// throw propagate turned a delivery hiccup into an unhandled server-action
// exception instead of the graceful {ok:false} path the UI expects, and hid
// the one thing that still makes the invite usable: the link itself. Caught
// here instead, so the invite is still reported as created and its link is
// still returned -- invite-form.tsx already tells the SMD to copy/share the
// link directly if the email doesn't arrive, which covers this case too.
async function sendInvite(
  email: string,
  token: string
): Promise<{ inviteUrl: string; emailSent: boolean }> {
  const session = await getSessionAgent();
  const supabase = await createClient();
  const [{ data: org }, logoUrl] = await Promise.all([
    supabase.from('organizations').select('name').eq('id', session!.agent!.org_id!).maybeSingle(),
    orgLogoUrl(session!.agent!.org_id!),
  ]);

  const inviteUrl = appUrl(`/invite/${token}`);
  let emailSent = true;
  try {
    await sendEmail({
      to: email,
      ...inviteEmail({
        orgName: org?.name ?? 'the team',
        inviterName: session!.agent!.full_name,
        inviteUrl,
        logoUrl,
      }),
    });
  } catch (err) {
    console.error(`[invites] failed to send invite email to ${email}`, err);
    emailSent = false;
  }
  return { inviteUrl, emailSent };
}

type CreateInvitesResult =
  | { ok: true; invites: { email: string; inviteUrl: string; emailSent: boolean }[] }
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
      if (!valid.success) return { email, ok: false, inviteUrl: null as string | null, emailSent: false };
      const { data: token, error } = await supabase.rpc('create_invitation', {
        p_email: email,
        p_role: 'associate',
      });
      if (error || !token) return { email, ok: false, inviteUrl: null, emailSent: false };
      // ok reflects whether the invitation was *created* -- sendInvite never
      // throws on a delivery failure, it reports emailSent instead, so a
      // Resend hiccup doesn't get lumped in with "Couldn't invite" below.
      const { inviteUrl, emailSent } = await sendInvite(email, token);
      return { email, ok: true, inviteUrl, emailSent };
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
    invites: results.map((r) => ({ email: r.email, inviteUrl: r.inviteUrl!, emailSent: r.emailSent })),
  };
}

export async function resendInvitationAction(email: string) {
  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc('create_invitation', {
    p_email: email,
    p_role: 'associate',
  });
  revalidatePath('/team/invites');
  if (error || !token) return { ok: false, inviteUrl: null, emailSent: false };
  // sendInvite no longer throws on a delivery failure -- ok still reflects
  // invite creation, and the caller already copies inviteUrl to the
  // clipboard regardless, so a failed send degrades to "use the link" rather
  // than an unhandled error.
  const { inviteUrl, emailSent } = await sendInvite(email, token);
  return { ok: true, inviteUrl, emailSent };
}

export async function revokeInvitationAction(invitationId: string) {
  const supabase = await createClient();
  await supabase
    .from('invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', invitationId);
  revalidatePath('/team/invites');
}
