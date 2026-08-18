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
 */
export async function requireLeader(): Promise<SessionAgent> {
  const session = await requireAgent();

  if (session.agent!.role !== 'leader' && session.agent!.role !== 'admin') {
    redirect('/dashboard?toast=team-restricted');
  }
  if (!session.mfaVerified) {
    redirect('/mfa/setup?required=team');
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
