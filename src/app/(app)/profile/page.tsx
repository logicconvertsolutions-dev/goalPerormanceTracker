import { requireVerifiedAgent } from '@/lib/auth/guards';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FullNameForm } from './full-name-form';
import { PasswordForm } from './password-form';
import { SignOutEverywhereButton } from './sign-out-everywhere-button';
import { ResetMfaButton } from './reset-mfa-button';

export default async function ProfilePage() {
  const session = await requireVerifiedAgent();
  const mfaEnabled = session.mfaEnrolled;

  return (
    <div className="space-y-4 max-w-lg">
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Profile</h1>

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FullNameForm currentName={session.agent!.full_name} />
          <div>
            <p className="text-xs text-fg-3">Email</p>
            <p className="text-sm text-fg">{session.email}</p>
          </div>
          <div>
            <p className="text-xs text-fg-3">Role</p>
            <p className="text-sm text-fg capitalize">{session.agent!.role}</p>
          </div>
          <div>
            <p className="text-xs text-fg-3">Joined</p>
            <p className="text-sm text-fg">
              {new Date(session.agent!.joined_at).toLocaleDateString('en-CA', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-fg-3">Two-factor authentication</p>
              <Badge variant={mfaEnabled ? 'ok' : 'neutral'} className="mt-1">
                {mfaEnabled ? 'Enabled' : 'Not enabled'}
              </Badge>
            </div>
            {!mfaEnabled && (
              <a href="/mfa/setup" className="text-sm text-acc hover:underline">
                Set up
              </a>
            )}
            {mfaEnabled && session.mfaVerified && <ResetMfaButton />}
            {mfaEnabled && !session.mfaVerified && (
              <a
                href="/mfa/verify?next=%2Fprofile"
                className="text-sm text-acc hover:underline"
              >
                Verify to manage
              </a>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-fg-2">
            Lost a device? Sign out of every session, including this one.
          </p>
          <SignOutEverywhereButton />
        </CardContent>
      </Card>
    </div>
  );
}
