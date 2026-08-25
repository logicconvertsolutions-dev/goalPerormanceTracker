import { requireLeader } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BackLink } from '@/components/shell/back-link';
import { InviteForm } from './invite-form';
import { InviteRowActions } from './invite-row-actions';

export default async function TeamInvitesPage() {
  await requireLeader();
  const supabase = await createClient();

  const { data: invitations } = await supabase
    .from('invitations')
    .select('id, email, expires_at, accepted_at, revoked_at, created_at')
    .order('created_at', { ascending: false });

  const pending = (invitations ?? []).filter((i) => !i.accepted_at && !i.revoked_at);

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Invites</h1>
        <BackLink href="/team" label="Team" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invite associates</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {pending.length === 0 ? (
            <p className="text-sm text-fg-3">No pending invitations.</p>
          ) : (
            pending.map((inv) => {
              const expired = new Date(inv.expires_at) < new Date();
              return (
                <div
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-line py-2 px-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-fg truncate">{inv.email}</p>
                    <p className="text-fg-3 text-xs">
                      Sent{' '}
                      {new Date(inv.created_at).toLocaleDateString('en-CA', {
                        day: 'numeric',
                        month: 'short',
                      })}{' '}
                      · expires{' '}
                      {new Date(inv.expires_at).toLocaleDateString('en-CA', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {expired && <Badge variant="bad">Expired</Badge>}
                    <InviteRowActions invitationId={inv.id} email={inv.email} />
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
