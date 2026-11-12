import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KpiStatProps {
  icon: LucideIcon;
  value: number;
  label: string;
  /** Muted red styling — used only when this stat represents a real warning (overdue > 0). */
  warn?: boolean;
  /** Makes the whole tile a link (P30: Due today / Overdue open the queue). */
  href?: string;
  /** Small line under the label, e.g. "Tap to view". */
  hint?: string;
}

/** One compact KPI tile in My Day's summary row. Deliberately plain — a
 * border and a number, not a dashboard card — so three of them read as one
 * calm strip rather than three competing widgets. */
export function KpiStat({ icon: Icon, value, label, warn, href, hint }: KpiStatProps) {
  const className = cn(
    'relative flex flex-1 flex-col gap-1.5 rounded border border-line bg-panel px-3.5 py-3.5 shadow-card',
    // A warning is a coloured edge and number on the same glass pane, not a
    // filled block (globals.css .tile-warn).
    warn && 'tile-warn',
    href && 'transition-smooth hover:border-acc-line hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acc'
  );
  const body = (
    <>
      <Icon className={cn('h-4 w-4', warn ? 'text-bad' : 'text-fg-3')} aria-hidden="true" />
      {href && <ChevronRight className="absolute right-2 top-3 h-4 w-4 text-fg-3" aria-hidden="true" />}
      <p className={cn('text-[30px] font-semibold leading-none tracking-heading-tight', warn ? 'text-bad' : 'text-fg')}>{value}</p>
      <p className="text-xs font-medium leading-tight text-fg-3">{label}</p>
      {hint && <p className="text-[11px] leading-tight text-fg-4">{hint}</p>}
    </>
  );

  return href ? (
    <Link href={href} className={className} aria-label={`${label}: ${value}. View list`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
