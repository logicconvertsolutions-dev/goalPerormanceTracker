import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SectionHeaderProps {
  title: string;
  /** Small gold marker in front of the title — reserved for the section that
   * answers "what should I do next", so it doesn't compete for attention. */
  dot?: boolean;
  subtitle?: string;
  action?: { label: string; href: string };
}

export function SectionHeader({ title, dot, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h2 className={cn('flex items-center gap-2 text-[20px] font-bold text-fg', dot && 'gap-2.5')}>
          {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />}
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-sm text-fg-3">{subtitle}</p>}
      </div>
      {action && (
        <Link
          href={action.href}
          className="flex shrink-0 items-center gap-1 text-sm font-medium text-acc hover:underline"
        >
          {action.label}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
