import Link from 'next/link';
import { requireLeader } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BackLink } from '@/components/shell/back-link';
import { OrgNameForm } from './org-name-form';
import { OrgLogoUpload } from './org-logo-upload';

export default async function OrganizationSettingsPage() {
  const session = await requireLeader();
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('name, logo_path')
    .eq('id', session.agent!.org_id!)
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
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <h1 className="text-[28px] font-bold leading-[34px] tracking-heading-tight text-fg">Organization</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/team/members">Members</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/team/invites">Invites</Link>
          </Button>
          <BackLink href="/team" label="Team" />
        </div>
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
          <CardTitle>Default team goals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-fg-2">
            The 10-day cycle calls, appointments, and premium goals every associate starts
            with unless you set a per-agent override.
          </p>
          <Link href="/team/targets" className="text-sm text-acc hover:underline">
            Manage goals →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
