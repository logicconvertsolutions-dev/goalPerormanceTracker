'use client';

import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';
import { useTheme } from '@/components/shell/theme-provider';

export function Toaster(props: ToasterProps) {
  const { resolved } = useTheme();
  return (
    <SonnerToaster
      theme={resolved}
      className="toaster"
      toastOptions={{
        classNames: {
          toast:
            'bg-panel-2 border border-line-2 text-fg shadow-lift rounded-sm',
          description: 'text-fg-2',
          actionButton: 'bg-acc text-on-acc',
          cancelButton: 'bg-hover text-fg-2',
        },
      }}
      {...props}
    />
  );
}
