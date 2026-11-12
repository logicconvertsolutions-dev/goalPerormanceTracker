'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PRIMARY_NAV, LEADER_NAV, ADMIN_NAV } from './nav-items';
import { useLogActivityDialog } from './log-activity-dialog';

type AppRole = 'associate' | 'leader' | 'admin';

export function TabBar({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const { open: openLog } = useLogActivityDialog();
  const items =
    role === 'admin' ? ADMIN_NAV : role === 'leader' ? [...PRIMARY_NAV, LEADER_NAV] : PRIMARY_NAV;

  return (
    <nav
      // A floating glass bar (globals.css .nav-chrome), clear of the home
      // indicator. (app)/layout.tsx pads <main> so content can scroll past it.
      className="nav-chrome fixed bottom-[calc(10px+env(safe-area-inset-bottom))] left-3 right-3 z-40 flex gap-0.5 rounded-[24px] p-1.5 md:hidden print:hidden"
      aria-label="Primary"
    >
      {items.map((item) => {
        const current = pathname.startsWith(item.href);
        const Icon = item.icon;
        const isLogActivity = item.href === '/log';
        const className = cn(
          'flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[18px] border border-transparent py-1.5 text-[10px] leading-none transition-smooth',
          current && 'nav-current font-medium'
        );
        const inner = (
          <>
            <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="max-w-full truncate">{item.label}</span>
          </>
        );
        return isLogActivity ? (
          <button key={item.href} type="button" onClick={() => openLog()} className={className}>
            {inner}
          </button>
        ) : (
          <Link key={item.href} href={item.href} aria-current={current} className={className}>
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
