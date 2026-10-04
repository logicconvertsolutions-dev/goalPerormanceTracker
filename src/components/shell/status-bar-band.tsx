'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { HERO_PATH } from './hero-path';

/**
 * The Home Screen app draws under the iPhone/iPad status bar
 * (`black-translucent`, root layout), whose clock and battery are then
 * white. This navy strip, exactly the status bar's height, keeps them
 * readable over the light pages. Everywhere but My Day, where the page photo
 * runs up behind the status bar instead (AppHeader turns navy once
 * scrolled) -- there it only covers the tablet/desktop rail. Zero height in
 * a normal browser tab, where there is no inset.
 */
export function StatusBarBand() {
  const onHero = usePathname() === HERO_PATH;
  return (
    <div
      className={cn(
        'pointer-events-none fixed left-0 top-0 z-[60] h-[env(safe-area-inset-top)] bg-acc print:hidden',
        onHero ? 'hidden w-[212px] md:block' : 'right-0'
      )}
      aria-hidden="true"
    />
  );
}
