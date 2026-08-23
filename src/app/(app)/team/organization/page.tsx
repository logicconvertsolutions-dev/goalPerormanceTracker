import Link from 'next/link';
import { requireLeader } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OrgNameForm } from './org-name-form';
import { OrgLogoUpload } from './org-logo-upload';

export default async function OrganizationSettingsPage() {
  const session = await requireLeader();
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('name, logo_path')
    .eq('id', session.agent!.org_id)
    .maybeSingle();

  let logoUrl: string | null = null;
  if (org?.logo_path) {
    const { data } = await supabase.storage
      .from('org-logos')
      .createSignedUrl(org.logo_path, 60 * 60);
    logoUrl = data?.signedUrl ?? null;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-heading-tight text-fg">Organization</h1>
        <Link href="/team" className="text-sm text-acc hover:underline">
          ← Team
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <OrgNameForm currentName={org?.name ?? ''} />
          <OrgLogoUpload currentLogoUrl={logoUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Default team targets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-fg-2">
            The weekly calls, appointments, and premium targets every associate starts with
            unless you set a per-agent override.
          </p>
          <Link href="/team/targets" className="text-sm text-acc hover:underline">
            Manage targets →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
