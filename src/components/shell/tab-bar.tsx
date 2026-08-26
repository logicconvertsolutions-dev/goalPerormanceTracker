'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PRIMARY_NAV, LEADER_NAV } from './nav-items';

export function TabBar({ isLeader }: { isLeader: boolean }) {
  const pathname = usePathname();
  const items = isLeader ? [...PRIMARY_NAV, LEADER_NAV] : PRIMARY_NAV;

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex border-t border-line bg-bg-2 shadow-float pb-[env(safe-area-inset-bottom)] print:hidden"
      aria-label="Primary"
    >
      {items.map((item) => {
        const current = pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current}
            className={cn(
              'relative flex flex-1 flex-col items-center justify-center gap-1 py-2.5 min-h-[44px] text-[11px] leading-none transition-smooth',
              current ? 'font-medium text-fg' : 'text-fg-3'
            )}
          >
            {current && (
              <span className="absolute top-0 h-[3px] w-8 rounded-full bg-gold" aria-hidden="true" />
            )}
            <Icon className={cn('h-5 w-5', current ? 'text-acc' : 'text-fg-3')} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
