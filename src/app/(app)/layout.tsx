import { requireAgent } from '@/lib/auth/guards';
import { RailNav } from '@/components/shell/rail-nav';
import { TabBar } from '@/components/shell/tab-bar';
import { AccountMenu } from '@/components/shell/account-menu';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAgent();
  const isLeader = session.agent!.role === 'leader' || session.agent!.role === 'admin';

  return (
    <div className="flex min-h-screen bg-bg">
      <RailNav isLeader={isLeader} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between border-b border-line px-4 py-3 md:px-6">
          <span className="text-sm font-medium text-fg-2">Performance Tracker</span>
          <AccountMenu fullName={session.agent!.full_name} />
        </header>
        <main className="flex-1 px-4 py-6 pb-24 md:px-6 md:pb-6">{children}</main>
      </div>
      <TabBar isLeader={isLeader} />
    </div>
  );
}
