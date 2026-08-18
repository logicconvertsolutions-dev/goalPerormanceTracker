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
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex border-t border-line bg-bg-2 pb-[env(safe-area-inset-bottom)]"
      aria-label="Primary"
    >
      {items.map((item) => {
        const current = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 py-2.5 min-h-[44px] text-xs',
              current ? 'text-acc' : 'text-fg-3'
            )}
          >
            <span
              className={cn(
                'h-[5px] w-[5px] rounded-full bg-fg-4',
                current && 'bg-acc shadow-[0_0_8px_var(--acc,#3D9AFF)]'
              )}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
