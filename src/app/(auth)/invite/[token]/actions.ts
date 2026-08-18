'use server';

import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { createHash } from 'crypto';

const acceptSchema = z.object({
  token: z.string().min(1),
  fullName: z.string().min(1).max(200),
  password: z.string().min(8),
});

export interface AcceptResult {
  ok: boolean;
  error?: string;
}

export async function acceptInvitation(
  input: z.infer<typeof acceptSchema>
): Promise<AcceptResult> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid submission.' };
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
  const { error: signUpError } = await admin.auth.admin.createUser({
    email: invitation.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (signUpError) {
    return { ok: false, error: signUpError.message };
  }

  return { ok: true };
}
