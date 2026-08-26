import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}

/** Shared top-of-page header — title, optional subtitle, optional trailing
 * action — used by every top-level destination (Dashboard, Contacts, Log
 * Activity, Team, Settings, ...) so the same type scale and spacing that
 * My Day introduced reads consistently across the app instead of each page
 * carrying its own copy of the same markup. */
export function PageHeader({ title, subtitle, action, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="truncate text-[28px] font-bold leading-[34px] tracking-heading-tight text-fg">
          {title}
        </h1>
        {subtitle && <p className="mt-0.5 text-sm text-fg-3">{subtitle}</p>}
      </div>
      {action && <div className="mt-1 shrink-0">{action}</div>}
    </div>
  );
}
