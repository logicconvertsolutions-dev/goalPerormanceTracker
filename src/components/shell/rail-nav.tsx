'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PRIMARY_NAV, SECONDARY_NAV, LEADER_NAV, type NavItem } from './nav-items';

function NavLink({ item, current }: { item: NavItem; current: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={current}
      className={cn(
        'flex items-center gap-2.5 rounded-sm border-l-2 border-transparent px-3 py-2.5 text-sm text-fg-2 transition-smooth',
        'hover:bg-hover hover:text-fg',
        current && 'border-l-gold bg-hover text-fg font-medium'
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', current && 'text-acc')} aria-hidden="true" />
      {item.label}
    </Link>
  );
}

export function RailNav({ isLeader }: { isLeader: boolean }) {
  const pathname = usePathname();
  const items = isLeader ? [...PRIMARY_NAV, LEADER_NAV] : PRIMARY_NAV;

  return (
    <nav
      className="hidden md:flex md:flex-col md:w-[212px] md:shrink-0 md:border-r md:border-line md:bg-bg-2 md:p-3 md:gap-1 print:hidden"
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
