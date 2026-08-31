import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AgentRow } from './agent-row';

interface AdminAgentRow {
  id: string;
  full_name: string;
  email: string;
  role: 'associate' | 'leader' | 'admin';
  status: 'active' | 'inactive';
  org_id: string | null;
  upline_id: string | null;
}

function AgentListItem({
  agent,
  sameOrgAgents,
  orgs,
}: {
  agent: AdminAgentRow;
  sameOrgAgents: AdminAgentRow[];
  orgs: { id: string; name: string }[];
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-line py-2 px-3 text-sm">
      <Link href={`/admin/agents/${agent.id}`} className="min-w-0 hover:underline">
        <p className="text-fg">{agent.full_name}</p>
        <p className="text-fg-3 text-xs">{agent.email}</p>
      </Link>
      <div className="flex items-center gap-2">
        {agent.status === 'inactive' && <Badge variant="bad">Inactive</Badge>}
        <AgentRow
          agentId={agent.id}
          fullName={agent.full_name}
          role={agent.role}
          status={agent.status}
          currentUplineId={agent.upline_id}
          sameOrgAgents={sameOrgAgents
            .filter((a) => a.id !== agent.id)
            .map((a) => ({ id: a.id, fullName: a.full_name }))}
          orgs={orgs}
        />
      </div>
    </div>
  );
}

export default async function AdminAgentsPage() {
  await requireAdmin();
  const supabase = await createClient();

  // agents_admin_read (p6d) makes this cross-org for an admin, unlike the
  // downline-scoped agents_select every other screen relies on.
  const [{ data: agents }, { data: orgs }] = await Promise.all([
    supabase
      .from('agents')
      .select('id, full_name, email, role, status, org_id, upline_id')
      .order('full_name'),
    supabase.from('organizations').select('id, name').order('name'),
  ]);

  const orgList = orgs ?? [];
  const orgName = new Map(orgList.map((o) => [o.id, o.name]));

  // Admins aren't part of any organization (org_id is null) -- keep them out
  // of the per-org grouping below, which is meaningless for them.
  const adminAgents: AdminAgentRow[] = [];
  const byOrg = new Map<string, AdminAgentRow[]>();
  for (const agent of (agents ?? []) as AdminAgentRow[]) {
    if (agent.role === 'admin' || !agent.org_id) {
      adminAgents.push(agent);
      continue;
    }
    const list = byOrg.get(agent.org_id) ?? [];
    list.push(agent);
    byOrg.set(agent.org_id, list);
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Agents</h1>
      <p className="text-sm text-fg-3">
        Change an agent&apos;s role, move them between uplines, reactivate a deactivated agent, or
        hard-delete on request. Hard-delete is irreversible. Select an agent to see their full
        record and change their email.
      </p>

      {adminAgents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Admins</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {adminAgents.map((agent) => (
              <AgentListItem key={agent.id} agent={agent} sameOrgAgents={adminAgents} orgs={orgList} />
            ))}
          </CardContent>
        </Card>
      )}

      {[...byOrg.entries()].map(([orgId, orgAgents]) => (
        <Card key={orgId}>
          <CardHeader>
            <CardTitle>{orgName.get(orgId) ?? 'Unknown org'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {orgAgents.map((agent) => (
              <AgentListItem key={agent.id} agent={agent} sameOrgAgents={orgAgents} orgs={orgList} />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
