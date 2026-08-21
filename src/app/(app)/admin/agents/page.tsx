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
  org_id: string;
  upline_id: string | null;
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

  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  const byOrg = new Map<string, AdminAgentRow[]>();
  for (const agent of (agents ?? []) as AdminAgentRow[]) {
    const list = byOrg.get(agent.org_id) ?? [];
    list.push(agent);
    byOrg.set(agent.org_id, list);
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Agents</h1>
      <p className="text-sm text-fg-3">
        Move an agent between uplines, reactivate a deactivated agent, or hard-delete on request.
        Hard-delete is irreversible.
      </p>

      {[...byOrg.entries()].map(([orgId, orgAgents]) => (
        <Card key={orgId}>
          <CardHeader>
            <CardTitle>{orgName.get(orgId) ?? 'Unknown org'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {orgAgents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center justify-between gap-3 rounded-sm border border-line py-2 px-3 text-sm"
              >
                <div>
                  <p className="text-fg">{agent.full_name}</p>
                  <p className="text-fg-3 text-xs">{agent.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="neutral">{agent.role}</Badge>
                  {agent.status === 'inactive' && <Badge variant="bad">Inactive</Badge>}
                  <AgentRow
                    agentId={agent.id}
                    fullName={agent.full_name}
                    status={agent.status}
                    currentUplineId={agent.upline_id}
                    sameOrgAgents={orgAgents
                      .filter((a) => a.id !== agent.id)
                      .map((a) => ({ id: a.id, fullName: a.full_name }))}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
