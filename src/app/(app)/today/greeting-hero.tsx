import Image from 'next/image';
import { Plus } from 'lucide-react';
import { LogActivityButton } from '@/components/shell/log-activity-button';
import mountain from './my-day-mountain.avif';

/**
 * My Day header (P30): date, time-of-day greeting and the Log Activity
 * button over the summit photo. Kept to roughly the footprint of the old
 * "My Day" title row. The image is a static import (not public/, which is
 * off-limits), so next/image resizes and serves it per screen size. AVIF on
 * purpose: Next generates a blur preview (via sharp) at build time for every
 * static .jpg/.png/.webp import, and the Node 18 CI job has no sharp (sharp
 * 0.35 needs Node >= 20.9). The navy bg-acc shows while the photo loads.
 */
export function GreetingHero({ greeting, name, dateLabel }: { greeting: string; name: string; dateLabel: string }) {
  return (
    <section className="relative flex items-center gap-3 overflow-hidden rounded-lg bg-acc px-4 py-3.5 text-white shadow-card lg:py-5">
      <Image
        src={mountain}
        alt=""
        fill
        priority
        sizes="(min-width: 1024px) 1152px, 100vw"
        // Keep the climber and flag in frame on the wide, short crop.
        className="object-cover object-[78%_42%]"
      />
      <div
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(11,30,61,0.92)_0%,rgba(11,30,61,0.66)_50%,rgba(11,30,61,0.12)_100%)]"
        aria-hidden="true"
      />
      <div className="relative min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/80">{dateLabel}</p>
        <h1 className="mt-0.5 line-clamp-2 text-[19px] font-bold leading-6 tracking-heading-tight [text-wrap:balance] lg:text-[24px] lg:leading-8">
          {greeting}, {name} <span aria-hidden="true">👋</span>
        </h1>
        <p className="mt-0.5 text-xs text-white/80">Small steps. Big progress.</p>
      </div>
      <LogActivityButton
        size="sm"
        className="relative shrink-0 rounded-full border-0 bg-white text-acc shadow-lift hover:bg-white/90"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Log
      </LogActivityButton>
    </section>
  );
}
