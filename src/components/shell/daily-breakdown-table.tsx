import { Card, CardContent } from '@/components/ui/card';
import { formatDisplayDate } from '@/lib/dates';

export interface DailyBreakdownRow {
  activity_date: string;
  calls_made: number;
  appts_set: number;
  appt_held: number;
  recruiting_convos: number;
  sales_count: number;
}

/** Date | Calls | Appts Set | Appts Held | Recruits | Sales, one row per day
 * in the selected period. Desktop table + mobile card list, same split as
 * every other roster/log table in the app (03-ui.md). */
export function DailyBreakdownTable({ rows }: { rows: DailyBreakdownRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-fg-3">No activity in this period.</p>;
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-line hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-bg-2 text-fg-3 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Date</th>
              <th className="text-right font-medium px-4 py-2.5">Calls</th>
              <th className="text-right font-medium px-4 py-2.5">Appts Set</th>
              <th className="text-right font-medium px-4 py-2.5">Appts Held</th>
              <th className="text-right font-medium px-4 py-2.5">Recruits</th>
              <th className="text-right font-medium px-4 py-2.5">Sales</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.activity_date} className="border-t border-line">
                <td className="px-4 py-2 text-fg">{formatDisplayDate(r.activity_date)}</td>
                <td className="px-4 py-2 text-right text-fg font-mono tabular-nums">{r.calls_made}</td>
                <td className="px-4 py-2 text-right text-fg font-mono tabular-nums">{r.appts_set}</td>
                <td className="px-4 py-2 text-right text-fg font-mono tabular-nums">{r.appt_held}</td>
                <td className="px-4 py-2 text-right text-fg font-mono tabular-nums">{r.recruiting_convos}</td>
                <td className="px-4 py-2 text-right text-fg font-mono tabular-nums">{r.sales_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards, not table (03-ui.md). */}
      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <Card key={r.activity_date}>
            <CardContent className="pt-4 space-y-1">
              <p className="text-sm font-medium text-fg">{formatDisplayDate(r.activity_date)}</p>
              <p className="text-xs text-fg-3">
                {r.calls_made} calls · {r.appts_set} appts set · {r.appt_held} appts held ·{' '}
                {r.recruiting_convos} recruits · {r.sales_count} sales
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
