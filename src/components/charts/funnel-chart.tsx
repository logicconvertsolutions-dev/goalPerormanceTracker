import type { FunnelResult } from '@/lib/metrics';
import { BLUE_ORDINAL_RAMP } from '@/lib/chart-colors';

/**
 * Horizontal stepped bars, conversion % printed between stages — the point of
 * the funnel is the percentage, not the raw counts (08-screen-specs.md). Each
 * stage steps through the blue ordinal ramp (light -> dark) since these are
 * ordered stages of one funnel, not distinct unrelated categories.
 */
export function FunnelChart({ funnel }: { funnel: FunnelResult }) {
  const stages = [
    { label: 'Calls made', value: funnel.callsMade, pct: null as number | null },
    { label: 'Appts set', value: funnel.apptsSet, pct: funnel.pctApptsSet },
    { label: 'Appts held', value: funnel.apptsHeld, pct: funnel.pctApptsHeld },
    { label: 'Sales', value: funnel.salesClosed, pct: funnel.pctSalesClosed },
  ];
  const max = Math.max(1, funnel.callsMade);

  return (
    <div className="space-y-2.5">
      {stages.map((s, i) => (
        <div key={s.label}>
          <div className="flex items-baseline justify-between text-xs mb-1">
            <span className="text-fg-2">{s.label}</span>
            <span className="font-mono tabular-nums text-fg">
              {s.value}
              {s.pct !== null && <span className="text-fg-3"> ({Math.round(s.pct * 100)}%)</span>}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-panel-2 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, (s.value / max) * 100)}%`,
                background: BLUE_ORDINAL_RAMP[i % BLUE_ORDINAL_RAMP.length],
              }}
            />
          </div>
        </div>
      ))}
      <table className="sr-only">
        <caption>Conversion funnel</caption>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Count</th>
            <th>% of calls made</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s) => (
            <tr key={s.label}>
              <td>{s.label}</td>
              <td>{s.value}</td>
              <td>{s.pct !== null ? `${Math.round(s.pct * 100)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
