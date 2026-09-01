import { formatDisplayDateTime, formatDisplayTime } from '@/lib/dates';
import { ACTIVITY_META, type ActivityKind } from '@/components/shell/activity-icons';

export function ActivityRow({
  kind,
  contactName,
  summary,
  createdAt,
  timeZone,
}: {
  kind: ActivityKind;
  contactName: string;
  summary: string;
  createdAt: string;
  /** Viewing agent's IANA time zone -- falls back to America/New_York when unset. */
  timeZone?: string | null;
}) {
  const { icon: Icon, color } = ACTIVITY_META[kind];

  return (
    <div className="flex items-center gap-3 py-3">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}1A`, color }}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-fg">{contactName}</p>
        <p className="truncate text-sm capitalize text-fg-3">{summary}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs font-medium text-fg-2">{formatDisplayDateTime(createdAt, timeZone)}</p>
        <p className="text-xs text-fg-4">{formatDisplayTime(createdAt, timeZone)}</p>
      </div>
    </div>
  );
}
