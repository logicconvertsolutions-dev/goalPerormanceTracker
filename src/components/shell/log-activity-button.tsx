'use client';

import type { ReactNode } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useLogActivityDialog } from './log-activity-dialog';

/** Drop-in replacement for a `<Button asChild><Link href="/log">…</Link></Button>` —
 * opens the shared Log Activity dialog instead of navigating to a separate page. */
export function LogActivityButton({
  contactId,
  contactName,
  date,
  children,
  ...buttonProps
}: {
  contactId?: string;
  contactName?: string;
  date?: string;
  children: ReactNode;
} & Omit<ButtonProps, 'asChild' | 'onClick'>) {
  const { open } = useLogActivityDialog();
  return (
    <Button {...buttonProps} onClick={() => open({ contactId, contactName, date })}>
      {children}
    </Button>
  );
}
