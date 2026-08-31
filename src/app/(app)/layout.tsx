import Link from 'next/link';
import { Target } from 'lucide-react';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { RailNav } from '@/components/shell/rail-nav';
import { TabBar } from '@/components/shell/tab-bar';
import { AccountMenu } from '@/components/shell/account-menu';
import { OfflineSync } from '@/components/shell/offline-sync';
import { LogActivityDialogProvider } from '@/components/shell/log-activity-dialog';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAgent();
  const role = session.agent!.role;

  const supabase = await createClient();
  // Admins aren't part of any organization (org_id is null) -- there's no
  // org branding to show them, only the generic app identity below.
  let org: { name: string; logo_path: string | null } | null = null;
  if (role !== 'admin') {
    const { data } = await supabase
      .from('organizations')
      .select('name, logo_path')
      .eq('id', session.agent!.org_id!)
      .maybeSingle();
    org = data;
  }

  let logoUrl: string | null = null;
  if (org?.logo_path) {
    const { data } = await supabase.storage.from('org-logos').createSignedUrl(org.logo_path, 3600);
    logoUrl = data?.signedUrl ?? null;
  }

  return (
    <LogActivityDialogProvider>
      <div className="flex min-h-screen bg-bg print:block">
        <RailNav role={role} />
        <div className="flex-1 flex flex-col min-w-0 print:block">
          <header className="flex items-center justify-between border-b border-line px-4 py-3 md:px-6 print:hidden">
            <Link
              href={role === 'admin' ? '/admin/agents' : '/today'}
              className="flex min-w-0 items-center gap-2.5 text-fg-2 transition-smooth hover:text-fg"
            >
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="h-11 w-11 shrink-0 rounded-sm object-contain" />
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-acc text-gold">
                  <Target className="h-5 w-5" aria-hidden="true" />
                </span>
              )}
              <span className="truncate text-lg font-semibold tracking-tight text-gold-dark">
                {org?.name ?? 'Performance Tracker'}
              </span>
            </Link>
            <AccountMenu fullName={session.agent!.full_name} isAdmin={role === 'admin'} />
          </header>
          <main className="flex-1 px-4 py-6 pb-24 md:px-6 md:pb-6 print:p-0">{children}</main>
        </div>
        <TabBar role={role} />
        <OfflineSync />
      </div>
    </LogActivityDialogProvider>
  );
}
