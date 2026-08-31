'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { signOutAction } from '@/app/(app)/logout/actions';
import { formatVersion } from '@/lib/version';
import { SECONDARY_NAV } from './nav-items';

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function AccountMenu({
  fullName,
  isAdmin,
}: {
  fullName: string;
  isAdmin: boolean;
}) {
  const [, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="-m-1.5 flex h-12 w-12 items-center justify-center rounded-full focus-visible:outline-none"
        aria-label="Account menu"
      >
        <Avatar>
          <AvatarFallback>{initials(fullName || '?')}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{fullName}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* The rail nav's "secondary" group (Activity Logs, Meeting Notes) has
            no equivalent on the mobile tab bar — there's no room for a 5th/6th
            tab — so it needs a reachable spot on mobile. This menu is the one
            thing present on every page regardless of screen size. Hidden on
            desktop since the rail nav already covers it there, and for admin
            entirely — an admin doesn't log activity of their own. */}
        {!isAdmin && (
          <>
            {SECONDARY_NAV.map((item) => (
              <DropdownMenuItem key={item.href} asChild className="md:hidden">
                <Link href={item.href}>{item.label}</Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator className="md:hidden" />
          </>
        )}
        <DropdownMenuItem asChild>
          <Link href="/profile">Profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/feedback">Send feedback</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="md:hidden">
          <Link href="/help">How to</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => startTransition(() => signOutAction())}>
          Sign out
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[11px] text-fg-4">{formatVersion()}</div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
