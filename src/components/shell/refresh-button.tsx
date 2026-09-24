'use client';

import { useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

/** At most one automatic refresh per this many ms when the app regains focus. */
const AUTO_REFRESH_GAP_MS = 30_000;

/**
 * Header refresh (P31). A Home Screen web app has no pull-to-refresh or
 * reload button, so changes made on another device (e.g. a task added on
 * desktop) only show after a restart. The button re-fetches the current
 * page's server data in place (router.refresh(), no full reload); the page
 * also refreshes by itself when it comes back to the foreground.
 */
export function RefreshButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const lastRefresh = useRef(Date.now());

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefresh.current < AUTO_REFRESH_GAP_MS) return;
      lastRefresh.current = Date.now();
      startTransition(() => router.refresh());
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [router]);

  return (
    <button
      type="button"
      onClick={() => {
        lastRefresh.current = Date.now();
        startTransition(() => router.refresh());
      }}
      disabled={pending}
      aria-label="Refresh"
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-sm text-fg transition-smooth hover:bg-hover',
        className
      )}
    >
      <RefreshCw className={cn('h-[18px] w-[18px]', pending && 'animate-spin')} aria-hidden="true" />
    </button>
  );
}
