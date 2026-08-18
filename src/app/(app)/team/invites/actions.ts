'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const emailListSchema = z.object({
  emails: z.string().min(1),
});

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((e) => e.trim())
    .filter(Boolean);
}

export async function createInvitationsAction(formData: FormData) {
  const parsed = emailListSchema.safeParse({ emails: formData.get('emails') });
  if (!parsed.success) return { ok: false, error: 'Enter at least one email.' };

  const emails = parseEmails(parsed.data.emails);
  const emailSchema = z.string().email();
  const supabase = await createClient();

  const results = await Promise.all(
    emails.map(async (email) => {
      const valid = emailSchema.safeParse(email);
      if (!valid.success) return { email, ok: false };
      const { error } = await supabase.rpc('create_invitation', {
        p_email: email,
        p_role: 'associate',
      });
      return { email, ok: !error };
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
  return { ok: true };
}

export async function resendInvitationAction(email: string) {
  const supabase = await createClient();
  await supabase.rpc('create_invitation', { p_email: email, p_role: 'associate' });
  revalidatePath('/team/invites');
}

export async function revokeInvitationAction(invitationId: string) {
  const supabase = await createClient();
  await supabase
    .from('invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', invitationId);
  revalidatePath('/team/invites');
}
