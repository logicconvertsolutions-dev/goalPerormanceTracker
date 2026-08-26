import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Buttons round more than the app's default rounded-sm — bumped a step to
  // rounded-lg (see size:lg below for the next step up) for a softer, more
  // pill-like feel, scoped to buttons only rather than the shared radius scale.
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium tracking-tight transition-smooth disabled:pointer-events-none disabled:opacity-50 min-h-[44px] px-4',
  {
    variants: {
      variant: {
        primary: 'bg-acc text-bg shadow-lift hover:bg-acc-2 hover:shadow-float',
        secondary:
          'bg-panel-2 text-fg border border-line-2 shadow-lift hover:bg-hover',
        // Tinted navy — a middle weight between ghost and primary for
        // secondary-but-still-visible actions (e.g. a trailing CTA below
        // a list, not the page's main action).
        soft: 'bg-acc/10 text-acc border border-acc/25 hover:bg-acc/15',
        ghost: 'text-fg-2 hover:bg-hover hover:text-fg',
        destructive: 'bg-bad-dim text-bad border border-bad hover:bg-bad/20',
        link: 'text-acc underline-offset-4 hover:underline min-h-0 px-0',
      },
      size: {
        default: 'h-11',
        sm: 'h-9 px-3 text-xs',
        lg: 'h-12 px-6 text-base rounded-xl',
        icon: 'h-11 w-11 p-0',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
