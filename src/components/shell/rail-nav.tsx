'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PRIMARY_NAV, SECONDARY_NAV, LEADER_NAV, type NavItem } from './nav-items';

function NavLink({ item, current }: { item: NavItem; current: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={current}
      className={cn(
        'flex items-center gap-2.5 rounded-sm px-3 py-2.5 text-sm text-fg-2 transition-smooth',
        'hover:bg-hover hover:text-fg',
        current && 'bg-panel-2 text-fg font-medium shadow-lift'
      )}
    >
      <span
        className={cn(
          'h-[5px] w-[5px] shrink-0 rounded-full bg-fg-4',
          current && 'bg-acc shadow-[0_0_8px_var(--acc,#3D9AFF)]'
        )}
      />
      {item.label}
    </Link>
  );
}

export function RailNav({ isLeader }: { isLeader: boolean }) {
  const pathname = usePathname();
  const items = isLeader ? [...PRIMARY_NAV, LEADER_NAV] : PRIMARY_NAV;

  return (
    <nav
      className="hidden md:flex md:flex-col md:w-[212px] md:shrink-0 md:border-r md:border-line md:bg-bg-2 md:p-3 md:gap-1"
      aria-label="Primary"
    >
      {items.map((item) => (
        <NavLink key={item.href} item={item} current={pathname.startsWith(item.href)} />
      ))}

      <div className="my-2 border-t border-line" />

      {SECONDARY_NAV.map((item) => (
        <NavLink key={item.href} item={item} current={pathname.startsWith(item.href)} />
      ))}
    </nav>
  );
}
