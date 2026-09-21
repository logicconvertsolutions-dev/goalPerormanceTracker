import { cn } from '@/lib/utils';

/**
 * The count on My Day's nav item (P25 D-1).
 *
 * Counts items due today plus everything still needing an outcome —
 * never forward-dated rows, even though My Day now shows a week of them.
 * A badge that can't reach zero is decoration; this one is a call to
 * action, so it has to be clearable by doing the work.
 *
 * Capped at 99+ so a neglected queue can't widen the rail or break the
 * tab bar's layout.
 */
export function NavBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;

  return (
    <span
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bad px-1',
        'text-[10px] font-semibold leading-none text-canvas',
        className
      )}
    >
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{count} due</span>
    </span>
  );
}
