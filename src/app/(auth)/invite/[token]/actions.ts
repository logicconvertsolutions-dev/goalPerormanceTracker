'use server';

import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { createHash } from 'crypto';

const acceptSchema = z.object({
  token: z.string().min(1),
  fullName: z.string().min(1).max(200),
  password: z.string().min(8),
  // Server-side enforcement of the checkbox -- previously only a client-side
  // gate on the submit button, so nothing actually stopped a direct call
  // from skipping it. z.literal(true) rejects anything but an explicit yes.
  agreedToTerms: z.literal(true),
});

export interface AcceptResult {
  ok: boolean;
  error?: string;
}

export async function acceptInvitation(
  input: { token: string; fullName: string; password: string; agreedToTerms: boolean }
): Promise<AcceptResult> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'You must accept the Terms & Conditions and privacy notice.' };
  }
  const { token, fullName, password } = parsed.data;

  const admin = createAdminClient();
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const { data: invitation } = await admin
    .from('invitations')
    .select('id, email, expires_at, accepted_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!invitation) {
    return { ok: false, error: "This invitation link isn't valid." };
  }
  if (invitation.accepted_at) {
    return { ok: false, error: 'already-accepted' };
  }
  if (invitation.revoked_at || new Date(invitation.expires_at) < new Date()) {
    return { ok: false, error: 'expired' };
  }

  // handle_new_user reads org_id/upline_id/role from the invitation row
  // itself (matched by email), never from this call's metadata — so full
  // name is the only thing that needs to travel through signUp's metadata.
  const { data: created, error: signUpError } = await admin.auth.admin.createUser({
    email: invitation.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (signUpError) {
    return { ok: false, error: signUpError.message };
  }

  // handle_new_user's insert into public.agents runs inside the same
  // transaction as createUser above, so the row already exists here.
  if (created.user) {
    await admin
      .from('agents')
      .update({ terms_accepted_at: new Date().toISOString() })
      .eq('id', created.user.id);
  }

  return { ok: true };
}
