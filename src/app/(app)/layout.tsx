import Link from 'next/link';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { RailNav } from '@/components/shell/rail-nav';
import { TabBar } from '@/components/shell/tab-bar';
import { AccountMenu } from '@/components/shell/account-menu';
import { OfflineSync } from '@/components/shell/offline-sync';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAgent();
  const isLeader = session.agent!.role === 'leader' || session.agent!.role === 'admin';

  const supabase = await createClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('name, logo_path')
    .eq('id', session.agent!.org_id)
    .maybeSingle();

  let logoUrl: string | null = null;
  if (org?.logo_path) {
    const { data } = await supabase.storage.from('org-logos').createSignedUrl(org.logo_path, 3600);
    logoUrl = data?.signedUrl ?? null;
  }

  return (
    <div className="flex min-h-screen bg-bg">
      <RailNav isLeader={isLeader} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between border-b border-line px-4 py-3 md:px-6">
          <Link
            href="/today"
            className="flex items-center gap-2 text-sm font-medium text-fg-2 transition-smooth hover:text-fg"
          >
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-6 w-6 rounded-sm object-contain" />
            )}
            {org?.name ?? 'Performance Tracker'}
          </Link>
          <AccountMenu
            fullName={session.agent!.full_name}
            isAdmin={session.agent!.role === 'admin'}
          />
        </header>
        <main className="flex-1 px-4 py-6 pb-24 md:px-6 md:pb-6">{children}</main>
      </div>
      <TabBar isLeader={isLeader} />
      <OfflineSync />
    </div>
  );
}
