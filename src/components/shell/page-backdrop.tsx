'use client';

import { usePathname } from 'next/navigation';
import { HERO_PATH } from './hero-path';

/**
 * App-wide page background: a fixed, tinted ground behind everything, so the
 * glass cards and navigation chrome have something to sit on. Light is a pale
 * navy tint with faint navy glows (globals.css .backdrop-tint); dark is dim
 * navy glows on near-black (.backdrop-glow). It runs behind the floating
 * rail too; the header (z-20) and mobile tab bar (z-40) sit above it.
 *
 * There is no photo any more (it was a mountain image from P30 to
 * 2026-11-12, washed toward white -- it read as fog behind glass cards).
 *
 * My Day (P36) puts its greeting on the backdrop: solid brand navy at the
 * very top, fading out just under the header. The solid start matters: iOS
 * may paint the status bar itself in the theme colour (#0B1E3D) rather than
 * letting the page draw under it, and starting the shade on that exact navy
 * means there is no visible edge either way. The stops are in px plus the
 * status-bar inset so they track the header, not the viewport.
 */
export function PageBackdrop() {
  const hero = usePathname() === HERO_PATH;
  return (
    <div className="pointer-events-none fixed inset-0 z-0 print:hidden" aria-hidden="true">
      <div className="backdrop-tint absolute inset-0 dark:hidden" />
      <div className="backdrop-glow absolute inset-0 hidden dark:block" />
      {hero && (
        <>
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgb(11,30,61) 0, rgb(11,30,61) env(safe-area-inset-top), rgba(11,30,61,0.82) calc(env(safe-area-inset-top) + 48px), rgba(11,30,61,0.62) calc(env(safe-area-inset-top) + 96px), rgba(11,30,61,0) calc(env(safe-area-inset-top) + 170px))',
            }}
          />
          {/* Extra shade behind the greeting text on the left. */}
          <div
            className="absolute inset-x-0 top-0"
            style={{
              height: 'calc(env(safe-area-inset-top) + 150px)',
              background: 'linear-gradient(90deg, rgba(11,30,61,0.45) 0%, rgba(11,30,61,0) 65%)',
              // Fade out downward -- no hard edge where it ends.
              maskImage: 'linear-gradient(180deg, #000 55%, transparent)',
              WebkitMaskImage: 'linear-gradient(180deg, #000 55%, transparent)',
            }}
          />
        </>
      )}
    </div>
  );
}
