'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionAgent } from '@/lib/auth/session';
import { sendEmail } from '@/lib/notifications/send';
import { inviteEmail, rosterTrainingReminderEmail } from '@/lib/notifications/templates';
import { appUrl } from '@/lib/notifications/app-url';

const schema = z.object({ agentId: z.string().uuid() });

export async function deactivateAgentAction(agentId: string) {
  const parsed = schema.safeParse({ agentId });
  if (!parsed.success) return { ok: false };

  const supabase = await createClient();
  const { error } = await supabase.rpc('deactivate_agent', {
    p_agent_id: parsed.data.agentId,
  });

  revalidatePath('/team/members');
  return { ok: !error };
}

const addRosterSchema = z.object({
  fullName: z.string().min(1, 'Enter a name.').max(200),
  // Mandatory: a training reminder needs somewhere to send it, with no
  // invite/signup required first (sendRosterTrainingReminderAction below).
  email: z.string().email('Enter a valid email.'),
  phone: z.string().max(30).optional(),
});

/**
 * Adds a team member to the roster with no login and no email sent — the
 * SMD decides later, per person, whether/when to actually invite them
 * (inviteRosterMemberAction below). Direct insert: team_roster's RLS policy
 * already restricts this to a leader/admin inserting into their own subtree.
 */
export async function addRosterMemberAction(formData: FormData) {
  const parsed = addRosterSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    phone: formData.get('phone') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const session = await getSessionAgent();
  const supabase = await createClient();

  const { error } = await supabase.from('team_roster').insert({
    org_id: session!.agent!.org_id,
    upline_id: session!.agent!.id,
    created_by: session!.agent!.id,
    full_name: parsed.data.fullName,
    email: parsed.data.email.toLowerCase(),
    phone: parsed.data.phone || null,
  });

  revalidatePath('/team/members');
  if (error) return { ok: false, error: 'Could not add team member.' };
  return { ok: true };
}

export async function removeRosterMemberAction(rosterId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('team_roster').delete().eq('id', rosterId);
  revalidatePath('/team/members');
  return { ok: !error };
}

const inviteRosterSchema = z.object({
  rosterId: z.string().uuid(),
  email: z.string().email('Enter a valid email to invite.'),
});

/**
 * Promotes one roster entry into a real invitation — the same
 * createInvitationsAction flow the Invites page uses (create_invitation RPC
 * + email), just triggered for a single roster row and stamping
 * team_roster.invitation_id afterward so the UI can show "Invited".
 */
export async function inviteRosterMemberAction(formData: FormData) {
  const parsed = inviteRosterSchema.safeParse({
    rosterId: formData.get('rosterId'),
    email: formData.get('email'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const session = await getSessionAgent();
  const supabase = await createClient();
  const email = parsed.data.email.toLowerCase();

  const { data: token, error } = await supabase.rpc('create_invitation', {
    p_email: email,
    p_role: 'associate',
  });
  if (error || !token) return { ok: false, error: error?.message ?? 'Could not send invite.' };

  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', session!.agent!.org_id)
    .maybeSingle();

  const inviteUrl = appUrl(`/invite/${token}`);
  await sendEmail({
    to: email,
    ...inviteEmail({
      orgName: org?.name ?? 'the team',
      inviterName: session!.agent!.full_name,
      inviteUrl,
    }),
  });

  // The invitation's id isn't returned by create_invitation (only the raw
  // token) — this row is the one we just inserted, so the most recent
  // pending invitation for this email in this org is unambiguous.
  const { data: invitation } = await supabase
    .from('invitations')
    .select('id')
    .eq('org_id', session!.agent!.org_id)
    .eq('email', email)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  await supabase
    .from('team_roster')
    .update({ email, invitation_id: invitation?.id ?? null })
    .eq('id', parsed.data.rosterId);

  revalidatePath('/team/members');
  revalidatePath('/team/invites');
  return { ok: true, inviteUrl };
}

/**
 * Sends a training reminder straight to a roster member's email — no invite
 * or app signup required first (send_roster_training_reminder rate-limits
 * to 1/7 days per roster row, mirroring send_training_reminder's cooldown
 * for real agents, 20260827090000_p9c).
 */
export async function sendRosterTrainingReminderAction(rosterId: string) {
  const parsed = z.object({ rosterId: z.string().uuid() }).safeParse({ rosterId });
  if (!parsed.success) return { ok: false, message: 'Invalid roster entry' };

  const session = await getSessionAgent();
  const supabase = await createClient();

  const { data: member } = await supabase
    .from('team_roster')
    .select('full_name, email')
    .eq('id', parsed.data.rosterId)
    .maybeSingle();
  if (!member?.email) return { ok: false, message: 'Add an email before sending a reminder.' };

  const { error } = await supabase.rpc('send_roster_training_reminder', {
    p_roster_id: parsed.data.rosterId,
  });
  revalidatePath('/team/members');
  if (error) return { ok: false, message: error.message };

  try {
    await sendEmail({
      to: member.email,
      ...rosterTrainingReminderEmail({
        fullName: member.full_name,
        sentByName: session!.agent!.full_name,
      }),
    });
  } catch (err) {
    console.error('[notifications] failed to send roster training reminder email', err);
  }

  return { ok: true };
}
