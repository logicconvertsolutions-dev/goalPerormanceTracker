import { AlertTriangle, CalendarClock, Clock, CalendarDays, CalendarRange, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BandId } from './day-bands';

/**
 * One band of My Day's queue (P25 D-1, F13).
 *
 * The bands answer different questions, so they get different treatments
 * rather than one repeated container:
 *
 *   starting_soon   about to begin -- the one band that is time-critical
 *   needs_outcome   already happened, never recorded. The nag.
 *   overdue         late work
 *   today           the rest of today
 *   tomorrow        advance notice
 *   later           the next week, collapsed
 *
 * `later` collapses via native <details>/<summary>: no client component,
 * no state, no dependency, and keyboard/screen-reader behaviour for free.
 * The forward bands exist to be glanceable, not to compete with the work
 * that is actually due, so the furthest-out one stays shut until asked for.
 */

interface BandMeta {
  title: string;
  /** Rendered under the title. Says why the band exists when that is not
   *  self-evident from its name. */
  description?: string;
  icon: typeof AlertTriangle;
  /** Attention treatment. Only the two bands that represent a problem get
   *  one -- if everything is highlighted, nothing is. */
  tone: 'bad' | 'warn' | 'neutral';
  /** Shut by default. */
  collapsed?: boolean;
}

export const BAND_META: Record<BandId, BandMeta> = {
  starting_soon: {
    title: 'Starting soon',
    description: 'In the next two hours.',
    icon: Timer,
    tone: 'warn',
  },
  needs_outcome: {
    title: 'Needs an outcome',
    description:
      'These have been and gone but were never marked Held, No-show or Cancelled. Until they are, they count as neither — and your no-show rate is computed without them.',
    icon: AlertTriangle,
    tone: 'bad',
  },
  overdue: {
    title: 'Overdue follow-ups',
    description: 'Past the day you set for them.',
    icon: Clock,
    tone: 'bad',
  },
  today: {
    title: 'Later today',
    icon: CalendarDays,
    tone: 'neutral',
  },
  tomorrow: {
    title: 'Tomorrow',
    icon: CalendarClock,
    tone: 'neutral',
  },
  later: {
    title: 'Later',
    description: 'The next seven days.',
    icon: CalendarRange,
    tone: 'neutral',
    collapsed: true,
  },
};

const TONE_SHELL: Record<BandMeta['tone'], string> = {
  bad: 'border-line bg-bad-dim',
  warn: 'border-line bg-warn-dim',
  neutral: 'border-line bg-panel',
};

const TONE_ICON: Record<BandMeta['tone'], string> = {
  bad: 'text-bad',
  warn: 'text-warn',
  neutral: 'text-acc',
};

export function QueueBand({ id, count, children }: { id: BandId; count: number; children: React.ReactNode }) {
  const meta = BAND_META[id];
  const Icon = meta.icon;

  const header = (
    <>
      <Icon className={cn('h-4 w-4 shrink-0', TONE_ICON[meta.tone])} aria-hidden="true" />
      <span className="text-sm font-semibold text-fg">
        {meta.title} ({count})
      </span>
    </>
  );

  const body = (
    <>
      {meta.description && <p className="px-4 pt-2.5 text-xs text-fg-3">{meta.description}</p>}
      <div className="divide-y divide-line px-4">{children}</div>
    </>
  );

  if (meta.collapsed) {
    return (
      <details className={cn('rounded-lg border shadow-card', TONE_SHELL[meta.tone])}>
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-2.5 hover:bg-hover [&::-webkit-details-marker]:hidden">
          {header}
          <span className="ml-auto text-xs text-fg-3">Show</span>
        </summary>
        <div className="border-t border-line">{body}</div>
      </details>
    );
  }

  return (
    <section className={cn('rounded-lg border shadow-card', TONE_SHELL[meta.tone])}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">{header}</div>
      {body}
    </section>
  );
}
