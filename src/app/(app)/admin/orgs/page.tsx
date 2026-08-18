import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProvisionOrgForm } from './provision-org-form';

export default async function AdminOrgsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, created_at')
    .order('created_at', { ascending: false });

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
              <div key={org.id} className="text-sm text-fg border-b border-line py-2 last:border-0">
                {org.name}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
