import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-tight',
  {
    variants: {
      variant: {
        default: 'border-acc-line bg-acc-dim text-acc',
        neutral: 'border-line-2 bg-panel-2 text-fg-2',
        ok: 'border-transparent bg-ok/15 text-ok',
        warn: 'border-transparent bg-warn-dim text-warn',
        bad: 'border-transparent bg-bad-dim text-bad',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
