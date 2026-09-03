import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDisplayDateTime } from '@/lib/dates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BackLink } from '@/components/shell/back-link';
import { AgentRow } from '../agent-row';
import { ChangeEmailForm } from './change-email-form';

export default async function AdminAgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const session = await requireAdmin();
  const supabase = await createClient();
  // agent_email_changes has no RLS policies at all (service-role only, same
  // lockdown as invitations' token lookup) -- the regular session client
  // can't read it even for an authenticated admin.
  const admin = createAdminClient();

  // agents_admin_read (p6d) makes this cross-org for an admin.
  const { data: agent } = await supabase
    .from('agents')
    .select('id, full_name, email, role, status, org_id, upline_id, joined_at')
    .eq('id', agentId)
    .maybeSingle();
  if (!agent) notFound();

  const [
    { data: org },
    { data: upline },
    { data: orgAgents },
    { data: allOrgs },
    { data: pendingChange },
  ] = await Promise.all([
    agent.org_id
      ? supabase.from('organizations').select('name').eq('id', agent.org_id).maybeSingle()
      : Promise.resolve({ data: null }),
    agent.upline_id
      ? supabase.from('agents').select('full_name').eq('id', agent.upline_id).maybeSingle()
      : Promise.resolve({ data: null }),
    agent.org_id
      ? supabase.from('agents').select('id, full_name').eq('org_id', agent.org_id).neq('id', agent.id)
      : Promise.resolve({ data: [] }),
    supabase.from('organizations').select('id, name').order('name'),
    admin
      .from('agent_email_changes')
      .select('new_email, created_at, expires_at, confirmed_at')
      .eq('agent_id', agent.id)
      .is('confirmed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const pending =
    pendingChange && new Date(pendingChange.expires_at) > new Date() ? pendingChange : null;

  return (
    <div className="space-y-4 max-w-2xl">
      <BackLink href="/admin/agents" label="Agents" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">{agent.full_name}</h1>
        {agent.status === 'inactive' && <Badge variant="bad">Inactive</Badge>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Record</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-fg-3">Email</span>
            <span className="text-fg">{agent.email}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-fg-3">Role</span>
            <span className="text-fg capitalize">{agent.role}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-fg-3">Organization</span>
            <span className="text-fg">{org?.name ?? '—'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-fg-3">Upline</span>
            <span className="text-fg">{upline?.full_name ?? '—'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-fg-3">Joined</span>
            <span className="text-fg">
              {/* joined_at is a `date` column (no time-of-day) -- locked to
                  UTC rather than any IANA zone, since converting a
                  date-only value through a negative-offset zone (e.g.
                  America/*) shifts it back a calendar day. */}
              {new Date(agent.joined_at).toLocaleDateString('en-CA', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              })}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Role, upline &amp; status</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentRow
            agentId={agent.id}
            fullName={agent.full_name}
            role={agent.role}
            status={agent.status}
            currentUplineId={agent.upline_id}
            sameOrgAgents={(orgAgents ?? []).map((a) => ({ id: a.id, fullName: a.full_name }))}
            orgs={allOrgs ?? []}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pending ? (
            <p className="text-sm text-fg-2">
              Waiting on <strong>{agent.full_name}</strong> to confirm the change to{' '}
              <strong>{pending.new_email}</strong> — sent{' '}
              {formatDisplayDateTime(pending.created_at, session.agent!.time_zone)}.
              They&apos;ll get another
              chance to confirm if you send it again below.
            </p>
          ) : (
            <p className="text-xs text-fg-3">
              Sends a confirmation link to the new address — the email only changes once{' '}
              {agent.full_name} clicks it.
            </p>
          )}
          <ChangeEmailForm agentId={agent.id} currentEmail={agent.email} />
        </CardContent>
      </Card>
    </div>
  );
}
