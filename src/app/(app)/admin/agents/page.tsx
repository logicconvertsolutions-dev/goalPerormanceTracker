import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { AgentRow } from './agent-row';
import { AgentsFilterBar } from './agents-filter-bar';

interface AdminAgentRow {
  id: string;
  full_name: string;
  email: string;
  role: 'associate' | 'leader' | 'admin';
  status: 'active' | 'inactive';
  org_id: string | null;
  upline_id: string | null;
}

export default async function AdminAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; org?: string; smd?: string }>;
}) {
  await requireAdmin();
  const supabase = await createClient();
  const { q: qRaw, org: orgFilter, smd: smdFilter } = await searchParams;
  const q = qRaw?.trim().toLowerCase();

  // agents_admin_read (p6d) makes this cross-org for an admin, unlike the
  // downline-scoped agents_select every other screen relies on. Fetched
  // unfiltered (search/org/SMD filtering happens below, in memory) because
  // each row's action controls (AgentRow's upline reassignment select) need
  // every agent in that org, not just the ones matching the current filter.
  const [{ data: agents }, { data: orgs }] = await Promise.all([
    supabase
      .from('agents')
      .select('id, full_name, email, role, status, org_id, upline_id')
      .order('full_name'),
    supabase.from('organizations').select('id, name').order('name'),
  ]);

  const allAgents = (agents ?? []) as AdminAgentRow[];
  const orgList = orgs ?? [];
  const orgName = new Map(orgList.map((o) => [o.id, o.name]));
  const agentById = new Map(allAgents.map((a) => [a.id, a]));

  const smdOptions = allAgents
    .filter((a) => a.role === 'leader')
    .map((a) => ({ id: a.id, fullName: a.full_name, orgName: (a.org_id && orgName.get(a.org_id)) || '—' }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const visible = allAgents.filter((agent) => {
    if (q && !agent.full_name.toLowerCase().includes(q) && !agent.email.toLowerCase().includes(q)) {
      return false;
    }
    if (orgFilter && agent.org_id !== orgFilter) return false;
    if (smdFilter && agent.upline_id !== smdFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Agents</h1>
      <p className="text-sm text-fg-3">
        Change an agent&apos;s role, move them between uplines, reactivate a deactivated agent, or
        hard-delete on request. Hard-delete is irreversible. Select an agent to see their full
        record and change their email.
      </p>

      <AgentsFilterBar initialQuery={qRaw ?? ''} orgs={orgList} smds={smdOptions} />

      <p className="text-xs text-fg-3">
        {visible.length} agent{visible.length === 1 ? '' : 's'}
        {q || orgFilter || smdFilter ? ` matching filters (of ${allAgents.length} total)` : ''}
      </p>

      {visible.length === 0 ? (
        <p className="text-sm text-fg-3">No agents match these filters.</p>
      ) : (
        <>
          {/* Mobile: a divided list, same visual language as Contacts. */}
          <div className="divide-y divide-line rounded-lg border border-line bg-panel px-4 shadow-card md:hidden">
            {visible.map((agent) => {
              const sameOrgAgents = agent.org_id
                ? allAgents.filter((a) => a.org_id === agent.org_id)
                : allAgents.filter((a) => a.role === 'admin');
              const upline = agent.upline_id ? agentById.get(agent.upline_id) : undefined;
              return (
                <div key={agent.id} className="space-y-2 py-3">
                  <Link href={`/admin/agents/${agent.id}`} className="min-w-0 hover:underline">
                    <p className="text-sm text-fg">{agent.full_name}</p>
                    <p className="text-fg-3 text-xs">{agent.email}</p>
                  </Link>
                  <p className="text-xs text-fg-3">
                    {agent.org_id ? (orgName.get(agent.org_id) ?? 'Unknown org') : 'No organisation'}
                    {upline ? ` · SMD: ${upline.full_name}` : ''}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
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
                      orgs={orgList}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop / tablet: full searchable table. */}
          <div className="hidden overflow-x-auto rounded-lg border border-line shadow-card md:block">
            <table className="w-full text-sm">
              <thead className="bg-bg-2 text-fg-3 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Agent</th>
                  <th className="text-left font-medium px-4 py-2.5">Organisation</th>
                  <th className="text-left font-medium px-4 py-2.5">SMD</th>
                  <th className="text-left font-medium px-4 py-2.5">Status</th>
                  <th className="text-left font-medium px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((agent) => {
                  const sameOrgAgents = agent.org_id
                    ? allAgents.filter((a) => a.org_id === agent.org_id)
                    : allAgents.filter((a) => a.role === 'admin');
                  const upline = agent.upline_id ? agentById.get(agent.upline_id) : undefined;
                  return (
                    <tr key={agent.id} className="border-t border-line hover:bg-hover align-top">
                      <td className="px-4 py-2.5">
                        <Link href={`/admin/agents/${agent.id}`} className="hover:underline">
                          <p className="text-fg font-medium">{agent.full_name}</p>
                          <p className="text-fg-3 text-xs">{agent.email}</p>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-fg-2">
                        {agent.org_id ? (orgName.get(agent.org_id) ?? 'Unknown org') : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-fg-2">{upline?.full_name ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        {agent.status === 'inactive' ? (
                          <Badge variant="bad">Inactive</Badge>
                        ) : (
                          <span className="text-fg-3">Active</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <AgentRow
                          agentId={agent.id}
                          fullName={agent.full_name}
                          role={agent.role}
                          status={agent.status}
                          currentUplineId={agent.upline_id}
                          sameOrgAgents={sameOrgAgents
                            .filter((a) => a.id !== agent.id)
                            .map((a) => ({ id: a.id, fullName: a.full_name }))}
                          orgs={orgList}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
