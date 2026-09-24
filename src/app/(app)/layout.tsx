import Link from 'next/link';
import { requireAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { RailNav } from '@/components/shell/rail-nav';
import { TabBar } from '@/components/shell/tab-bar';
import { AccountMenu } from '@/components/shell/account-menu';
import { AnnouncementBanner } from '@/components/shell/announcement-banner';
import { OfflineSync } from '@/components/shell/offline-sync';
import { LogActivityDialogProvider } from '@/components/shell/log-activity-dialog';
import { KautisMark } from '@/components/shell/kautis-logo';
import { NotificationBell, type BellNotification } from '@/components/shell/notification-bell';
import { RefreshButton } from '@/components/shell/refresh-button';
import { PageBackdrop } from '@/components/shell/page-backdrop';

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

  const [{ data: activeAnnouncements }, { data: dismissed }] = await Promise.all([
    supabase
      .from('announcements')
      .select('id, message, created_at')
      .eq('active', true)
      .order('created_at', { ascending: false }),
    supabase.from('announcement_dismissals').select('announcement_id').eq('agent_id', session.userId),
  ]);
  // Bell feed (P30). Admins have no personal notifications, so no bell.
  let bell: { items: BellNotification[]; unread: number } | null = null;
  if (role !== 'admin') {
    const [{ data: items }, { count: unread }] = await Promise.all([
      supabase
        .from('notifications')
        .select('id, kind, title, body, link, created_at, read_at')
        .eq('agent_id', session.userId)
        .is('cleared_at', null)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', session.userId)
        .is('cleared_at', null)
        .is('read_at', null),
    ]);
    bell = { items: items ?? [], unread: unread ?? 0 };
  }

  const dismissedIds = new Set((dismissed ?? []).map((d) => d.announcement_id));
  const visibleAnnouncements = (activeAnnouncements ?? []).filter((a) => !dismissedIds.has(a.id));

  return (
    <LogActivityDialogProvider>
      <div className="flex min-h-screen bg-bg print:block">
        <PageBackdrop />
        <RailNav role={role} />
        <div className="relative z-[1] flex-1 flex flex-col min-w-0 print:block">
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-bg px-4 py-3 md:px-6 print:hidden">
            <Link
              href={role === 'admin' ? '/admin/agents' : '/today'}
              className="flex min-w-0 items-center gap-2.5 text-fg-2 transition-smooth hover:text-fg"
            >
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="h-14 w-14 shrink-0 rounded-sm object-contain" />
              ) : (
                // No org logo uploaded yet (or an admin, who has no org at
                // all) -- show the Kautis mark in the same slot/size the
                // org's own logo would occupy.
                <KautisMark size={56} className="h-14 w-14 shrink-0" />
              )}
              <span className="truncate text-lg font-semibold tracking-tight text-gold-dark">
                {org?.name ?? 'Kautis'}
              </span>
            </Link>
            <div className="flex shrink-0 items-center gap-1.5">
              <RefreshButton className="md:hidden" />
              {bell && (
                <NotificationBell
                  notifications={bell.items}
                  unreadCount={bell.unread}
                  // The VAPID *public* key is meant to be shared with browsers;
                  // passed down from the server so no NEXT_PUBLIC_ var is needed.
                  vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null}
                  timeZone={session.agent!.time_zone}
                />
              )}
              <AccountMenu
                fullName={session.agent!.full_name}
                isAdmin={role === 'admin'}
                isLeader={role === 'leader'}
              />
            </div>
          </header>
          <AnnouncementBanner announcements={visibleAnnouncements} />
          <main className="flex-1 px-4 py-6 pb-24 md:px-6 md:pb-6 print:p-0">{children}</main>
        </div>
        <TabBar role={role} />
        <OfflineSync />
      </div>
    </LogActivityDialogProvider>
  );
}
