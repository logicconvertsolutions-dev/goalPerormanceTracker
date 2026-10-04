'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dateTimeLine, greetingFor } from '@/lib/greeting';
import { LogActivityButton } from './log-activity-button';
import { HERO_PATH } from './hero-path';

/** Scroll distance over which the My Day greeting fades and the bar turns navy. */
const PIN_DISTANCE = 72;

/**
 * App header. Every page: a 64px navy bar (white logo, then refresh/bell/
 * account on the right) that sticks to the top. It owns the iPhone status-bar strip too
 * (padding = safe-area-inset-top) -- the Home Screen app draws under the
 * status bar (`black-translucent`, root layout).
 *
 * My Day (P36): the bar goes transparent over the page photo (PageBackdrop
 * adds the navy shade) and the greeting, date/time and Log button sit beside
 * it, pulled up under the bar so logo, greeting and icons share a row. As
 * the page scrolls the greeting fades out under the bar, which fills in navy
 * and shrinks the logo -- a slim pinned bar. The bar never changes height,
 * so nothing below it jumps.
 */
export function AppHeader({
  homeHref,
  logo,
  actions,
  name,
  timeZone,
}: {
  homeHref: string;
  logo: ReactNode;
  actions: ReactNode;
  name: string;
  timeZone: string | null;
}) {
  const hero = usePathname() === HERO_PATH;
  const barRef = useRef<HTMLElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const [actionsWidth, setActionsWidth] = useState(128);

  // Styles are written straight to the nodes (no re-render per scroll frame).
  useEffect(() => {
    const bar = barRef.current;
    const logo = logoRef.current;
    const greeting = heroRef.current;
    if (!hero || !bar || !logo || !greeting) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const p = Math.min(1, Math.max(0, window.scrollY / PIN_DISTANCE));
      bar.style.backgroundColor = `rgba(11, 30, 61, ${p.toFixed(3)})`;
      bar.style.boxShadow = p === 1 ? '0 2px 12px rgba(11, 30, 61, 0.25)' : 'none';
      logo.style.transform = `scale(${1 - p * 0.25})`;
      greeting.style.opacity = String(Math.max(0, 1 - p * 1.6));
      // At rest the see-through bar lets taps reach the Log button beside
      // the icons (md+); once it fills in it is solid again, and the faded
      // greeting stops taking taps.
      bar.style.pointerEvents = p === 1 ? 'auto' : '';
      greeting.style.pointerEvents = p > 0.5 ? 'none' : '';
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
      // Leaving My Day: hand the bar back to its class-based look.
      for (const el of [bar, logo, greeting]) el.removeAttribute('style');
    };
  }, [hero]);

  // The greeting's right column reserves exactly the icons' width (refresh is
  // phone-only; admins have no bell), so the text never runs under them.
  useEffect(() => {
    const el = actionsRef.current;
    if (!hero || !el) return;
    const ro = new ResizeObserver(() => setActionsWidth(el.offsetWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hero]);

  return (
    // Always 'dark': every page's bar is navy (white logo and icons).
    <div data-tone="dark" className="group/header contents">
      <header
        ref={barRef}
        className={cn(
          'sticky top-0 z-20 px-4 pt-[env(safe-area-inset-top)] md:px-6 print:hidden',
          // Other pages: the navy bar My Day pins to once scrolled. A white bar
          // made iOS paint the status bar white at rest (it takes its colour
          // from the top of the page), so every page now reads navy there.
          hero ? 'pointer-events-none text-white' : 'bg-acc text-white shadow-[0_2px_12px_rgba(11,30,61,0.25)]'
        )}
      >
        <div className="flex h-16 items-center justify-between gap-3">
          <Link href={homeHref} aria-label="Home" className="pointer-events-auto shrink-0 rounded-full transition-smooth hover:opacity-90">
            <div ref={logoRef} className="origin-left">
              {logo}
            </div>
          </Link>
          <div ref={actionsRef} className="pointer-events-auto flex shrink-0 items-center gap-1.5">
            {actions}
          </div>
        </div>
      </header>

      {hero && (
        <section
          ref={heroRef}
          className="relative z-10 -mt-16 flex gap-3 px-4 pb-2 text-white md:px-6 print:hidden"
        >
          {/* Logo column: the logo itself lives in the sticky bar above. */}
          <div className="w-[52px] shrink-0" aria-hidden="true" />
          <Greeting name={name} timeZone={timeZone} />
          {/* Right column: the icons' slot, with Log under it on phones and
            beside it from md up (one-line greeting, no room to waste). */}
          <div
            className="flex w-[var(--actions-w)] shrink-0 flex-col items-end md:w-auto md:flex-row-reverse md:items-center md:gap-3 md:self-start"
            style={{ '--actions-w': `${actionsWidth}px` } as CSSProperties}
          >
            <div className="h-16 w-full md:w-[var(--actions-w)]" aria-hidden="true" />
            <LogActivityButton
              size="sm"
              className="rounded-full border-0 bg-white text-acc shadow-lift hover:bg-white/90"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Log
            </LogActivityButton>
          </div>
        </section>
      )}
    </div>
  );
}

/** Greeting + live local date/time, ticking on the minute. */
function Greeting({ name, timeZone }: { name: string; timeZone: string | null }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    // Back from the background (Home Screen app): the timer may have slept.
    const onVisible = () => document.visibilityState === 'visible' && setNow(new Date());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <div className="min-w-0 flex-1 pt-2.5 [text-shadow:0_1px_8px_rgba(11,30,61,0.45)] md:pt-2">
      <h1
        className="line-clamp-2 text-[19px] font-bold leading-6 tracking-heading-tight [text-wrap:balance] lg:text-[24px] lg:leading-8"
        suppressHydrationWarning
      >
        {greetingFor(now, timeZone)}, {name} <span aria-hidden="true">👋</span>
      </h1>
      <p className="mt-0.5 text-[13px] font-medium text-white/85" suppressHydrationWarning>
        {dateTimeLine(now, timeZone)}
      </p>
    </div>
  );
}
