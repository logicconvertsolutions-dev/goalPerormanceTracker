import Image from 'next/image';
import mountain from './my-day-mountain.avif';

/**
 * My Day's page background (P30): the summit photo behind the whole page,
 * washed toward white further down so the white cards float on it and long
 * lists stay readable. Fixed, so it holds still while the page scrolls. Starts
 * after the 212px desktop/tablet rail (rail-nav.tsx) so the navigation stays
 * plain; the sticky header (z-20) and mobile tab bar (z-40) sit above it.
 */
export function PageBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-y-0 left-0 right-0 z-0 md:left-[212px] print:hidden" aria-hidden="true">
      <Image src={mountain} alt="" fill sizes="100vw" className="object-cover object-[70%_top]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.55)_0%,rgba(255,255,255,0.82)_38%,rgba(255,255,255,0.93)_100%)]" />
    </div>
  );
}
