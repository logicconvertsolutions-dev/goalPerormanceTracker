import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Back arrow + title + filter pills for the To Do and Reminders pages (P31). */
export function PlannerPageHeader({
  title,
  label,
  filters,
  current,
}: {
  title: string;
  label: string;
  filters: { key: string; label: string; href: string; count: number }[];
  current: string;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Link
          href="/today"
          aria-label="Back to My Day"
          className="flex h-9 w-9 items-center justify-center rounded-sm text-fg-2 hover:bg-hover"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-[24px] font-bold tracking-heading-tight text-fg">{title}</h1>
      </div>

      <nav className="flex flex-wrap gap-1.5" aria-label={label}>
        {filters.map((f) => (
          <Link
            key={f.key}
            href={f.href}
            aria-current={f.key === current ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-bold',
              f.key === current ? 'border-acc bg-acc text-white' : 'border-line bg-panel text-fg-2 hover:bg-hover'
            )}
          >
            {f.label} ({f.count})
          </Link>
        ))}
      </nav>
    </>
  );
}
