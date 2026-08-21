import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { attainmentColor, attainmentBar } from '@/lib/attainment';

interface KpiCardProps {
  label: string;
  value: string;
  /** Present when this KPI has a target — renders a thin attainment progress bar. */
  target?: { value: string; pct: number };
  /** Present when this KPI has no target — a period-over-period delta instead. */
  delta?: { value: number; label: string };
}

export function KpiCard({ label, value, target, delta }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="pt-4 space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-3">{label}</p>
        <p className="text-2xl font-medium font-mono tabular-nums tracking-tighter text-fg">
          {value}
        </p>
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
        ) : null}
      </CardContent>
    </Card>
  );
}
