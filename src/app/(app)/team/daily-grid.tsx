import { formatDisplayDate } from '@/lib/dates';
import { cn } from '@/lib/utils';

export interface DailyGridColumn {
  agentId: string;
  fullName: string;
  rows: { activity_date: string; calls_made: number; min_met: boolean }[];
}

/**
 * Dates down the left, one column per agent, cell = calls made with a
 * min-met dot — the "activity matrix" visual language from 03-ui.md: solid
 * accent + glow when the minimum was met, sunken hairline at zero. Reads as
 * an attendance sheet — this is what an SMD opens on Monday (08-screen-specs.md).
 */
export function DailyGrid({ dates, columns }: { dates: string[]; columns: DailyGridColumn[] }) {
  if (columns.length === 0) {
    return (
      <p className="text-sm text-fg-3">
        Select one or more agents above to see their daily grid.
      </p>
    );
  }

  const cellFor = (col: DailyGridColumn, date: string) => col.rows.find((r) => r.activity_date === date);

  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm border-collapse">
        <thead className="bg-bg-2 text-fg-3 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left font-medium px-4 py-2.5 sticky left-0 bg-bg-2">Date</th>
            {columns.map((c) => (
              <th key={c.agentId} className="text-center font-medium px-3 py-2.5 whitespace-nowrap">
                {c.fullName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dates.map((date) => (
            <tr key={date} className="border-t border-line">
              <td className="px-4 py-2 text-fg-2 sticky left-0 bg-panel whitespace-nowrap">
                {formatDisplayDate(date)}
              </td>
              {columns.map((c) => {
                const cell = cellFor(c, date);
                const calls = cell?.calls_made ?? 0;
                const minMet = cell?.min_met ?? false;
                return (
                  <td key={c.agentId} className="px-3 py-2 text-center">
                    <span
                      className={cn(
                        'inline-flex h-7 w-9 items-center justify-center rounded-sm font-mono text-xs tabular-nums',
                        minMet
                          ? 'bg-acc text-bg shadow-[0_0_8px_rgba(61,154,255,.45)]'
                          : calls > 0
                            ? 'bg-acc-dim text-acc-2'
                            : 'bg-sunken text-fg-4 border border-line'
                      )}
                    >
                      {calls}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
