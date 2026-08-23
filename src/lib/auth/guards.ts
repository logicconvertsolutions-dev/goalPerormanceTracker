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
 * Leader or admin, with MFA verified. Per docs/09-account-and-auth.md a
 * leader without MFA is blocked from /team — redirect to setup, not a 403.
 *
 * A leader who already has a verified factor but whose *session* hasn't
 * stepped up to aal2 (e.g. a fresh sign-in) goes to the step-up challenge,
 * not enrollment — sending them back to /mfa/setup would either error
 * (already enrolled) or, worse, silently enroll a second factor while never
 * actually solving why this session is stuck at aal1.
 */
export async function requireLeader(): Promise<SessionAgent> {
  const session = await requireAgent();

  if (session.agent!.role !== 'leader' && session.agent!.role !== 'admin') {
    redirect('/dashboard?toast=team-restricted');
  }
  if (!session.mfaVerified) {
    redirect(
      session.mfaEnrolled
        ? '/mfa/verify?next=%2Fteam'
        : '/mfa/setup?required=team'
    );
  }
  return session;
}

export async function requireAdmin(): Promise<SessionAgent> {
  const session = await requireAgent();

  if (session.agent!.role !== 'admin') {
    redirect('/dashboard?toast=admin-restricted');
  }
  return session;
}
