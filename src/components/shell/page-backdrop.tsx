'use client';

import Image, { type StaticImageData } from 'next/image';
import { usePathname } from 'next/navigation';
import mountain from './page-backdrop-mountain.avif';

// Per-section photos: first matching path prefix wins, anything else gets
// DEFAULT_IMAGE. Add an entry (and the .avif next to this file -- AVIF so the
// build needs no sharp, see greeting-hero.tsx) to give a section its own.
const SECTION_IMAGES: { prefix: string; image: StaticImageData }[] = [];
const DEFAULT_IMAGE = mountain;

/**
 * App-wide page background (P30, every page since P31): a photo behind the
 * content, washed toward white further down so the white cards float on it
 * and long lists stay readable. Fixed, so it holds still while the page
 * scrolls. Starts after the 212px desktop/tablet rail (rail-nav.tsx) so the
 * navigation stays plain; the sticky header (z-20) and mobile tab bar (z-40)
 * sit above it.
 */
export function PageBackdrop() {
  const pathname = usePathname();
  const image = SECTION_IMAGES.find((s) => pathname.startsWith(s.prefix))?.image ?? DEFAULT_IMAGE;
  return (
    <div
      className="pointer-events-none fixed inset-y-0 left-0 right-0 z-0 md:left-[212px] print:hidden"
      aria-hidden="true"
    >
      <Image src={image} alt="" fill sizes="100vw" className="object-cover object-[70%_top]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.55)_0%,rgba(255,255,255,0.82)_38%,rgba(255,255,255,0.93)_100%)]" />
    </div>
  );
}
