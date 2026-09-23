import Image from 'next/image';
import { Sun } from 'lucide-react';
import type { Quote } from '@/lib/quotes';
import mountain from './my-day-mountain.avif';

/** "Today's thought" (P30) -- one curated quote per agent-local day. */
export function QuoteCard({ quote }: { quote: Quote }) {
  return (
    <figure className="relative overflow-hidden rounded-lg bg-acc px-5 py-5 text-white shadow-card">
      <Image
        src={mountain}
        alt=""
        fill
        sizes="(min-width: 1024px) 480px, 100vw"
        className="object-cover object-[80%_45%]"
      />
      <div
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(11,30,61,0.9)_0%,rgba(11,30,61,0.62)_60%,rgba(11,30,61,0.15)_100%)]"
        aria-hidden="true"
      />
      <div className="relative">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-white/75">
          <Sun className="h-3.5 w-3.5" aria-hidden="true" />
          Today’s thought
        </p>
        <blockquote className="mt-2 max-w-[300px] text-[16px] font-semibold leading-[23px] [text-wrap:balance]">
          “{quote.text}”
        </blockquote>
        <figcaption className="mt-2.5 text-xs text-white/80">— {quote.author}</figcaption>
      </div>
    </figure>
  );
}
