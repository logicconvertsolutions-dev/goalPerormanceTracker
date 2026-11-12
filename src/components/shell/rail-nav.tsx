'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  PRIMARY_NAV,
  SECONDARY_NAV,
  LEADER_SECONDARY_NAV,
  LEADER_NAV,
  ADMIN_NAV,
  HELP_NAV,
  TOOLS_NAV,
  type NavItem,
} from './nav-items';
import { useLogActivityDialog } from './log-activity-dialog';
import { ThemeSwitch } from './theme-switch';

// A floating panel: navy in light, glass in dark (globals.css .nav-chrome).
// 212px wide plus a 12px margin each side -- PageBackdrop and StatusBarBand
// no longer depend on that width, the backdrop now runs behind the rail.
const RAIL =
  'nav-chrome hidden md:sticky md:top-[calc(env(safe-area-inset-top)+0.75rem)] md:z-[1] md:m-3 md:mt-[calc(env(safe-area-inset-top)+0.75rem)] md:flex md:h-[calc(100vh-1.5rem-env(safe-area-inset-top))] md:w-[212px] md:shrink-0 md:flex-col md:gap-0.5 md:overflow-y-auto md:rounded-[22px] md:p-3 print:hidden';
const RAIL_RULE = 'my-2 border-t border-white/15';

function NavLink({ item, current }: { item: NavItem; current: boolean }) {
  const Icon = item.icon;
  const { open: openLog } = useLogActivityDialog();
  const className = cn(
    'flex items-center gap-2.5 rounded-full border border-transparent px-3 py-2.5 text-left text-sm transition-smooth',
    current ? 'nav-current font-semibold' : 'hover:bg-white/10 hover:text-white'
  );
  const inner = (
    <>
      <Icon className={cn('h-4 w-4 shrink-0', !current && 'opacity-85')} aria-hidden="true" />
      {item.label}
    </>
  );

  if (item.href === '/log') {
    return (
      <button type="button" onClick={() => openLog()} className={className}>
        {inner}
      </button>
    );
  }

  return (
    <Link href={item.href} aria-current={current} className={className}>
      {inner}
    </Link>
  );
}

type AppRole = 'associate' | 'leader' | 'admin';

export function RailNav({ role }: { role: AppRole }) {
  const pathname = usePathname();

  if (role === 'admin') {
    return (
      <nav
        className={RAIL}
        aria-label="Primary"
      >
        {ADMIN_NAV.map((item) => (
          <NavLink key={item.href} item={item} current={pathname.startsWith(item.href)} />
        ))}

        <div className={RAIL_RULE} />
        <NavLink item={HELP_NAV} current={pathname.startsWith(HELP_NAV.href)} />
        <ThemeSwitch tone="chrome" className="mt-auto" />
      </nav>
    );
  }

  const items = role === 'leader' ? [...PRIMARY_NAV, LEADER_NAV] : PRIMARY_NAV;
  const secondaryItems = role === 'leader' ? LEADER_SECONDARY_NAV : SECONDARY_NAV;

  return (
    <nav
      className={RAIL}
      aria-label="Primary"
    >
      {items.map((item) => (
        <NavLink key={item.href} item={item} current={pathname.startsWith(item.href)} />
      ))}

      <div className={RAIL_RULE} />

      {secondaryItems.map((item) => (
        <NavLink key={item.href} item={item} current={pathname.startsWith(item.href)} />
      ))}

      <div className={RAIL_RULE} />
      <p className="px-3 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide opacity-80">
        Tools
      </p>
      {TOOLS_NAV.map((item) => (
        <NavLink key={item.href} item={item} current={pathname.startsWith(item.href)} />
      ))}

      <div className={RAIL_RULE} />
      <NavLink item={HELP_NAV} current={pathname.startsWith(HELP_NAV.href)} />
      <ThemeSwitch tone="chrome" className="mt-auto" />
    </nav>
  );
}
