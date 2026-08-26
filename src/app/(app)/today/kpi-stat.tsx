import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KpiStatProps {
  icon: LucideIcon;
  value: number;
  label: string;
  /** Muted red styling — used only when this stat represents a real warning (overdue > 0). */
  warn?: boolean;
}

/** One compact KPI tile in My Day's summary row. Deliberately plain — a
 * border and a number, not a dashboard card — so three of them read as one
 * calm strip rather than three competing widgets. */
export function KpiStat({ icon: Icon, value, label, warn }: KpiStatProps) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col gap-1.5 rounded-[10px] border border-line bg-panel px-3 py-3 shadow-card',
        warn && 'border-bad/30 bg-bad-dim/40'
      )}
    >
      <Icon className={cn('h-4 w-4', warn ? 'text-bad' : 'text-fg-3')} aria-hidden="true" />
      <p className={cn('text-2xl font-bold leading-none', warn ? 'text-bad' : 'text-fg')}>{value}</p>
      <p className="text-xs font-medium leading-tight text-fg-3">{label}</p>
    </div>
  );
}
