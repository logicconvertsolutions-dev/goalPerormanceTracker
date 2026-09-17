import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BackLink } from '@/components/shell/back-link';
import { AdminRosterForm } from './admin-roster-form';
import { AdminRosterMemberRow } from './admin-roster-member-row';

export default async function AdminOrgDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  await requireAdmin();
  const supabase = await createClient();

  // organizations_admin_read / agents_admin_read / team_roster_admin_read
  // (p21a) all make these cross-org for an admin, the same pattern already
  // used by /admin/agents and /admin/agents/[agentId].
  const [{ data: org }, { data: members }, { data: roster }] = await Promise.all([
    supabase.from('organizations').select('id, name').eq('id', orgId).maybeSingle(),
    supabase
      .from('agents')
      .select('id, full_name, email, role, status, joined_at')
      .eq('org_id', orgId)
      .order('full_name'),
    supabase
      .from('team_roster')
      .select('id, full_name, email, phone, invitation_id')
      .eq('org_id', orgId)
      .order('full_name'),
  ]);
  if (!org) notFound();

  const allMembers = members ?? [];
  // A roster entry whose email has already joined as a real agent has
  // finished its job -- same dedupe /team/members uses for the SMD's own
  // roster list.
  const joinedEmails = new Set(allMembers.map((m) => m.email?.toLowerCase()).filter(Boolean));
  const pendingRoster = (roster ?? []).filter(
    (r) => !r.email || !joinedEmails.has(r.email.toLowerCase())
  );

  const leaders = allMembers
    .filter((m) => m.role === 'leader' && m.status === 'active')
    .map((m) => ({ id: m.id, fullName: m.full_name }));

  return (
    <div className="space-y-4 max-w-2xl">
      <BackLink href="/admin/orgs" label="Organizations" />
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">{org.name}</h1>

      <Card>
        <CardHeader>
          <CardTitle>Add member</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {leaders.length === 0 ? (
            <p className="text-sm text-fg-3">
              This organization has no active leader (SMD) yet — invite one from{' '}
              <Link href="/admin/agents" className="underline">
                Agents
              </Link>{' '}
              before adding team members, since every member reports to one.
            </p>
          ) : (
            <>
              <p className="text-xs text-fg-3">
                Adds someone to {org.name}&apos;s roster — same as an SMD building their own team
                from Members. Adding them doesn&apos;t invite them to the app; use Invite per-row
                when they&apos;re ready to sign in.
              </p>
              <AdminRosterForm orgId={org.id} leaders={leaders} />
            </>
          )}
          {pendingRoster.length > 0 && (
            <div className="space-y-2 pt-1">
              {pendingRoster.map((r) => (
                <AdminRosterMemberRow key={r.id} orgId={org.id} member={r} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {allMembers.length === 0 ? (
            <p className="text-sm text-fg-3">No one in this organization yet.</p>
          ) : (
            allMembers.map((m) => (
              <Link
                key={m.id}
                href={`/admin/agents/${m.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-line py-2 px-3 text-sm hover:bg-hover"
              >
                <div className="min-w-0">
                  <p className="truncate text-fg">{m.full_name}</p>
                  <p className="truncate text-fg-3 text-xs">{m.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="neutral">{m.role}</Badge>
                  {m.status === 'inactive' && <Badge variant="bad">Inactive</Badge>}
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
