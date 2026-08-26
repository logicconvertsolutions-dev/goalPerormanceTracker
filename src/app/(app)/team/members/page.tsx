import { requireLeader } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DeactivateButton } from './deactivate-button';
import { RosterForm } from './roster-form';
import { RosterMemberRow } from './roster-member-row';
import { TrainingReminderButton } from '../training-reminder-button';

export default async function TeamMembersPage() {
  const session = await requireLeader();
  const supabase = await createClient();

  // RLS already scopes agents SELECT to the caller's own downline via
  // is_upline_of — no PII crosses this table, just name/role/status.
  const [{ data: members }, { data: roster }] = await Promise.all([
    supabase
      .from('agents')
      .select('id, full_name, email, role, status, joined_at')
      .neq('id', session.userId)
      .order('full_name'),
    supabase
      .from('team_roster')
      .select('id, full_name, email, phone, invitation_id')
      .eq('upline_id', session.userId)
      .order('full_name'),
  ]);

  // A roster entry whose email has already joined as a real agent has
  // finished its job — no login-free "roster" concept applies to them
  // anymore, so it drops off this list once that happens.
  const joinedEmails = new Set((members ?? []).map((m) => m.email?.toLowerCase()).filter(Boolean));
  const pendingRoster = (roster ?? []).filter(
    (r) => !r.email || !joinedEmails.has(r.email.toLowerCase())
  );

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-[28px] font-bold leading-[34px] tracking-heading-tight text-fg">Members</h1>

      <Card>
        <CardHeader>
          <CardTitle>Team roster</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-fg-3">
            Add everyone on your team here — no email is sent until you invite them.
          </p>
          <RosterForm />
          {pendingRoster.length > 0 && (
            <div className="space-y-2 pt-1">
              {pendingRoster.map((r) => (
                <RosterMemberRow key={r.id} member={r} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Downline roster</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!members || members.length === 0 ? (
            <p className="text-sm text-fg-3">No one on your team yet.</p>
          ) : (
            members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-sm border border-line py-2 px-3 text-sm"
              >
                <div>
                  <p className="text-fg">{m.full_name}</p>
                  <p className="text-fg-3 text-xs">{m.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="neutral">{m.role}</Badge>
                  {m.status === 'inactive' ? (
                    <Badge variant="bad">Deactivated</Badge>
                  ) : (
                    <>
                      <TrainingReminderButton agentId={m.id} fullName={m.full_name} />
                      <DeactivateButton agentId={m.id} fullName={m.full_name} />
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
