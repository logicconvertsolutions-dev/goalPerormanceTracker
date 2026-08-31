import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProvisionOrgForm } from './provision-org-form';
import { DeleteOrgButton } from './delete-org-button';

export default async function AdminOrgsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: orgs }, { data: agents }] = await Promise.all([
    supabase.from('organizations').select('id, name, created_at').order('created_at', { ascending: false }),
    // agents_admin_read (p6d) makes this cross-org for an admin -- just the
    // org_id column, to count agents per org for the delete-confirm copy.
    supabase.from('agents').select('org_id'),
  ]);

  const agentCountByOrg = new Map<string, number>();
  for (const agent of agents ?? []) {
    if (!agent.org_id) continue;
    agentCountByOrg.set(agent.org_id, (agentCountByOrg.get(agent.org_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-4 max-w-lg">
      <h1 className="text-xl font-semibold tracking-heading-tight text-fg">
        Organizations
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>New organization</CardTitle>
        </CardHeader>
        <CardContent>
          <ProvisionOrgForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!orgs || orgs.length === 0 ? (
            <p className="text-sm text-fg-3">No organizations yet.</p>
          ) : (
            orgs.map((org) => (
              <div
                key={org.id}
                className="flex items-center justify-between gap-3 text-sm text-fg border-b border-line py-2 last:border-0"
              >
                {org.name}
                <DeleteOrgButton
                  orgId={org.id}
                  orgName={org.name}
                  agentCount={agentCountByOrg.get(org.id) ?? 0}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
