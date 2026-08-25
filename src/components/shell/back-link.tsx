import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One consistent "go back" affordance — a real icon instead of a "←" text
 * glyph, which renders inconsistently across fonts/platforms. Used on every
 * screen reached one level deep from a nav destination (team sub-pages,
 * invites, audit, privacy, ...).
 */
export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-1 text-sm text-fg-3 transition-smooth hover:text-fg',
        className
      )}
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </Link>
  );
}
