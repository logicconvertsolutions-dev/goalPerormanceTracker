import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { attainmentColor, attainmentBar } from '@/lib/attainment';
import { cn } from '@/lib/utils';
import { formatDisplayDate } from '@/lib/dates';

export interface RosterRowData {
  agent_id: string;
  full_name: string;
  calls_made: number;
  calls_target: number;
  pct_calls: number | null;
  appts_set: number;
  appts_held: number;
  appts_held_target: number;
  premium_cents: number;
  premium_cents_target: number;
  streak_days: number;
  last_logged_at: string | null;
  has_override: boolean;
}

const QUIET_DAYS = 7;

function isQuiet(lastLoggedAt: string | null): boolean {
  if (!lastLoggedAt) return true;
  const days = (Date.now() - new Date(lastLoggedAt).getTime()) / 86_400_000;
  return days > QUIET_DAYS;
}

/** One roster row — 03-ui.md: "Agent · Calls (n/target, bar) · Appts Set · Appts Held · Premium · Streak · Last logged". */
export function RosterRow({ row }: { row: RosterRowData }) {
  const pct = row.pct_calls ?? 0;

  return (
    <tr className="border-t border-line hover:bg-hover">
      <td className="px-4 py-2.5">
        <Link href={`/team/${row.agent_id}`} className="text-fg hover:text-acc">
          {row.full_name}
        </Link>
        {row.has_override && (
          <span className="ml-1.5 text-[10px] text-fg-3" title="Has a per-agent target override">
            *
          </span>
        )}
        {isQuiet(row.last_logged_at) && (
          <Badge variant="neutral" className="ml-2 align-middle">
            Quiet
          </Badge>
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn('font-mono tabular-nums text-xs', attainmentColor(pct))}>
            {row.calls_made} / {row.calls_target}
          </span>
          <div className="h-1 w-16 rounded-full bg-panel-2 overflow-hidden">
            <div
              className={cn('h-full rounded-full', attainmentBar(pct))}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-fg-2">{row.appts_set}</td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-fg-2">{row.appts_held}</td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-fg-2">
        ${(row.premium_cents / 100).toLocaleString('en-CA')}
      </td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-fg-2">{row.streak_days}d</td>
      <td className="px-4 py-2.5 text-fg-3 text-xs whitespace-nowrap">
        {row.last_logged_at ? formatDisplayDate(row.last_logged_at.slice(0, 10)) : '—'}
      </td>
    </tr>
  );
}
