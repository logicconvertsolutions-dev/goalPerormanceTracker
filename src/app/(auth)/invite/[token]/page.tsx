import { createHash } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { DEFAULT_TIME_ZONE } from '@/lib/notifications/window';
import { AcceptInviteForm } from './accept-invite-form';

interface InvitationDetails {
  inviterName: string;
  orgName: string;
  email: string;
  state: 'valid' | 'expired' | 'accepted' | 'invalid';
  expiresAt?: string;
}

async function lookupInvitation(token: string): Promise<InvitationDetails> {
  const admin = createAdminClient();
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const { data: invitation } = await admin
    .from('invitations')
    .select('email, expires_at, accepted_at, revoked_at, org_id, created_by')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!invitation) {
    return { inviterName: '', orgName: '', email: '', state: 'invalid' };
  }
  if (invitation.accepted_at) {
    return { inviterName: '', orgName: '', email: invitation.email, state: 'accepted' };
  }
  if (invitation.revoked_at || new Date(invitation.expires_at) < new Date()) {
    return {
      inviterName: '',
      orgName: '',
      email: invitation.email,
      state: 'expired',
      expiresAt: invitation.expires_at,
    };
  }

  // An admin-role invitation (an existing admin inviting a new admin)
  // carries no org_id -- admins aren't part of any organization.
  const [{ data: org }, { data: inviter }] = await Promise.all([
    invitation.org_id
      ? admin.from('organizations').select('name').eq('id', invitation.org_id).maybeSingle()
      : Promise.resolve({ data: null }),
    invitation.created_by
      ? admin.from('agents').select('full_name').eq('id', invitation.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    inviterName: inviter?.full_name ?? 'Your SMD',
    orgName: org?.name ?? 'the team',
    email: invitation.email,
    state: 'valid',
  };
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await lookupInvitation(token);

  if (invitation.state === 'invalid') {
    return (
      <div className="text-center space-y-3">
        <h1 className="text-xl font-semibold text-fg">Invalid invitation</h1>
        <p className="text-sm text-fg-2">This invitation link isn&apos;t valid.</p>
      </div>
    );
  }

  if (invitation.state === 'accepted') {
    return (
      <div className="text-center space-y-3">
        <h1 className="text-xl font-semibold text-fg">Already accepted</h1>
        <p className="text-sm text-fg-2">
          This invitation has already been accepted.{' '}
          <a href="/login" className="text-acc hover:underline">
            Sign in
          </a>
          .
        </p>
      </div>
    );
  }

  if (invitation.state === 'expired') {
    const expiredDate = invitation.expiresAt
      ? new Date(invitation.expiresAt).toLocaleDateString('en-CA', {
          day: 'numeric',
          month: 'short',
          timeZone: DEFAULT_TIME_ZONE,
        })
      : '';
    return (
      <div className="text-center space-y-3">
        <h1 className="text-xl font-semibold text-fg">Invitation expired</h1>
        <p className="text-sm text-fg-2">
          This invitation expired on {expiredDate}. Ask your SMD to send a new one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">
          {invitation.inviterName} invited you to the {invitation.orgName} on Team
          Tracker
        </h1>
        <p className="text-sm text-fg-2">Set your name and password to get started.</p>
      </div>
      <AcceptInviteForm token={token} email={invitation.email} />
    </div>
  );
}
