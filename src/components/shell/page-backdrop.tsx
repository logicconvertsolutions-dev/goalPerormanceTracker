'use client';

import Image, { type StaticImageData } from 'next/image';
import { usePathname } from 'next/navigation';
import mountain from './page-backdrop-mountain.avif';
import { HERO_PATH } from './hero-path';

// Per-section photos: first matching path prefix wins, anything else gets
// DEFAULT_IMAGE. Add an entry (and the .avif next to this file -- AVIF so the
// build needs no sharp, see the note below) to give a section its own.
const SECTION_IMAGES: { prefix: string; image: StaticImageData }[] = [];
const DEFAULT_IMAGE = mountain;

/**
 * App-wide page background (P30, every page since P31): a photo behind the
 * content, washed toward white further down so the white cards float on it
 * and long lists stay readable. Fixed, so it holds still while the page
 * scrolls. Starts after the 212px desktop/tablet rail (rail-nav.tsx) so the
 * navigation stays plain; the sticky header (z-20) and mobile tab bar (z-40)
 * sit above it.
 *
 * My Day (P36) puts its header on the photo: solid brand navy at the very
 * top, fading through the greeting and icons to the bare photo just under
 * the header, then the usual white wash for the cards. The solid start
 * matters: iOS may paint the status bar itself in the theme colour (#0B1E3D)
 * rather than letting the page draw under it, and starting the shade on
 * that exact navy means there is no visible edge either way. The stops are in px
 * plus the status-bar inset so they track the header, not the viewport.
 *
 * AVIF on purpose: Next generates a blur preview (via sharp) at build time
 * for every static .jpg/.png/.webp import, and the Node 18 CI job has no
 * sharp (sharp 0.35 needs Node >= 20.9).
 */
export function PageBackdrop() {
  const pathname = usePathname();
  const hero = pathname === HERO_PATH;
  const image = SECTION_IMAGES.find((s) => pathname.startsWith(s.prefix))?.image ?? DEFAULT_IMAGE;
  return (
    <div
      className="pointer-events-none fixed inset-y-0 left-0 right-0 z-0 md:left-[212px] print:hidden"
      aria-hidden="true"
    >
      <Image src={image} alt="" fill priority={hero} sizes="100vw" className="object-cover object-[70%_top]" />
      {hero ? (
        <>
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgb(11,30,61) 0, rgb(11,30,61) env(safe-area-inset-top), rgba(11,30,61,0.62) calc(env(safe-area-inset-top) + 48px), rgba(11,30,61,0.45) calc(env(safe-area-inset-top) + 96px), rgba(11,30,61,0) calc(env(safe-area-inset-top) + 150px), rgba(255,255,255,0.6) calc(env(safe-area-inset-top) + 230px), rgba(255,255,255,0.86) calc(env(safe-area-inset-top) + 380px), rgba(255,255,255,0.93) 100%)',
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
      ) : (
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.55)_0%,rgba(255,255,255,0.82)_38%,rgba(255,255,255,0.93)_100%)]" />
      )}
    </div>
  );
}
