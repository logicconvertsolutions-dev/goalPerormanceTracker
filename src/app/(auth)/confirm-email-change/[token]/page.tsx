import { createHash } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { ConfirmEmailChangeForm } from './confirm-email-change-form';

interface Lookup {
  state: 'valid' | 'confirmed' | 'expired' | 'invalid';
  newEmail: string;
}

async function lookupChange(token: string): Promise<Lookup> {
  const admin = createAdminClient();
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const { data: change } = await admin
    .from('agent_email_changes')
    .select('new_email, confirmed_at, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!change) return { state: 'invalid', newEmail: '' };
  if (change.confirmed_at) return { state: 'confirmed', newEmail: change.new_email };
  if (new Date(change.expires_at) < new Date()) return { state: 'expired', newEmail: change.new_email };
  return { state: 'valid', newEmail: change.new_email };
}

export default async function ConfirmEmailChangePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const change = await lookupChange(token);

  if (change.state === 'invalid') {
    return (
      <div className="text-center space-y-3">
        <h1 className="text-xl font-semibold text-fg">Invalid link</h1>
        <p className="text-sm text-fg-2">This email confirmation link isn&apos;t valid.</p>
      </div>
    );
  }

  if (change.state === 'confirmed') {
    return (
      <div className="text-center space-y-3">
        <h1 className="text-xl font-semibold text-fg">Already confirmed</h1>
        <p className="text-sm text-fg-2">
          This email change has already been confirmed.{' '}
          <a href="/login" className="text-acc hover:underline">
            Sign in
          </a>
          .
        </p>
      </div>
    );
  }

  if (change.state === 'expired') {
    return (
      <div className="text-center space-y-3">
        <h1 className="text-xl font-semibold text-fg">Link expired</h1>
        <p className="text-sm text-fg-2">
          This confirmation link has expired. Ask your admin to send a new one.
        </p>
      </div>
    );
  }

  return <ConfirmEmailChangeForm token={token} newEmail={change.newEmail} />;
}
