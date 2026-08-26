import { formatDisplayDate, formatDisplayTime } from '@/lib/dates';
import { ACTIVITY_META, type ActivityKind } from '@/components/shell/activity-icons';

export function ActivityRow({
  kind,
  contactName,
  summary,
  createdAt,
}: {
  kind: ActivityKind;
  contactName: string;
  summary: string;
  createdAt: string;
}) {
  const Icon = ACTIVITY_META[kind].icon;

  return (
    <div className="flex items-center gap-3 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-acc-dim text-acc">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-fg">{contactName}</p>
        <p className="truncate text-sm capitalize text-fg-3">{summary}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs font-medium text-fg-2">{formatDisplayDate(createdAt.slice(0, 10))}</p>
        <p className="text-xs text-fg-4">{formatDisplayTime(createdAt)}</p>
      </div>
    </div>
  );
}
