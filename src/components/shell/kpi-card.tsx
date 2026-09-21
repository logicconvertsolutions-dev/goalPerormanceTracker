import { cn } from '@/lib/utils';
import { attainmentColor, attainmentBar } from '@/lib/attainment';

interface KpiCardProps {
  label: string;
  value: string;
  /** Present when this KPI has a target — renders a thin attainment progress bar. */
  target?: { value: string; pct: number };
  /** Present when this KPI has no target — a period-over-period delta instead. */
  delta?: { value: number; label: string };
  /**
   * A plain sub-label for a KPI whose number is meaningless without one.
   * Added in P25 C2 for the no-show rate, whose denominator is now
   * outcomes only (held + no-show + cancelled) rather than every row in
   * the period — a rate nobody can see the denominator of is a rate nobody
   * trusts, which is half of what F10 cost.
   */
  hint?: string;
}

/** A single metric tile — plain border, no shadow, so a grid of these reads
 * as one calm strip of numbers rather than a stack of individually-elevated
 * cards. Shared by the Dashboard and Team overview. */
export function KpiCard({ label, value, target, delta, hint }: KpiCardProps) {
  return (
    <div className="space-y-1.5 rounded border border-line bg-panel px-3.5 py-3 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-3">{label}</p>
      <p className="text-2xl font-bold font-mono tabular-nums tracking-tighter text-fg">{value}</p>
      {target ? (
        <div className="space-y-1">
          <p className={cn('text-xs font-mono tabular-nums', attainmentColor(target.pct))}>
            / {target.value}
          </p>
          <div className="h-1 w-full rounded-full bg-panel-2 overflow-hidden">
            <div
              className={cn('h-full rounded-full', attainmentBar(target.pct))}
              style={{ width: `${Math.min(100, Math.max(0, target.pct))}%` }}
            />
          </div>
        </div>
      ) : delta ? (
        <p className="text-xs text-fg-2">
          {delta.value >= 0 ? '▲' : '▼'} {Math.abs(delta.value)} {delta.label}
        </p>
      ) : hint ? (
        <p className="text-xs text-fg-3">{hint}</p>
      ) : null}
    </div>
  );
}
