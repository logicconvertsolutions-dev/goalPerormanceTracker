import { redirect } from 'next/navigation';
import { getSessionAgent, type SessionAgent } from './session';

/** Any signed-in agent with an active status. Redirects to /login otherwise. */
export async function requireAgent(): Promise<SessionAgent> {
  const session = await getSessionAgent();

  if (!session || !session.agent) {
    redirect('/login');
  }
  if (session.agent.status === 'inactive') {
    redirect('/login?reason=deactivated');
  }
  return session;
}

/**
 * Any signed-in, active agent with MFA verified. Every regular app page
 * requires this now (not just leaders) — a user with no verified factor
 * goes to enrollment, one whose *session* hasn't stepped up to aal2 (e.g. a
 * fresh sign-in with an already-enrolled factor) goes to the step-up
 * challenge instead — sending them back to /mfa/setup would either error
 * (already enrolled) or, worse, silently enroll a second factor while never
 * actually solving why this session is stuck at aal1.
 *
 * mfa/setup and mfa/verify themselves must keep calling requireAgent()
 * directly, never this — routing through here would redirect right back to
 * itself.
 */
export async function requireVerifiedAgent(): Promise<SessionAgent> {
  const session = await requireAgent();

  if (!session.mfaVerified) {
    redirect(session.mfaEnrolled ? '/mfa/verify' : '/mfa/setup?required=login');
  }
  // Existing agents from before terms_accepted_at existed, plus anyone whose
  // acceptInvitation() write somehow didn't land, get a one-time gate here.
  // /terms/accept itself must keep calling requireAgent() directly, same
  // reasoning as mfa/setup and mfa/verify above.
  if (!session.agent!.terms_accepted_at) {
    redirect('/terms/accept');
  }
  return session;
}

/**
 * Leader (SMD), with MFA verified (see requireVerifiedAgent). Admin used to
 * pass this too, back when every admin belonged to an org — now that an
 * admin isn't part of any organization, /team/* has nothing for them
 * (org-scoped downline/roster/targets pages an org-less account can't use);
 * their equivalent tools live under /admin/* instead, gated by
 * requireAdmin().
 */
export async function requireLeader(): Promise<SessionAgent> {
  const session = await requireVerifiedAgent();

  if (session.agent!.role !== 'leader') {
    redirect('/dashboard?toast=team-restricted');
  }
  return session;
}

/** Admin, with MFA verified (see requireVerifiedAgent). */
export async function requireAdmin(): Promise<SessionAgent> {
  const session = await requireVerifiedAgent();

  if (session.agent!.role !== 'admin') {
    redirect('/dashboard?toast=admin-restricted');
  }
  return session;
}
