'use client';

import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';

export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      theme="dark"
      className="toaster"
      toastOptions={{
        classNames: {
          toast:
            'bg-panel-2 border border-line-2 text-fg shadow-lift rounded-sm',
          description: 'text-fg-2',
          actionButton: 'bg-acc text-bg',
          cancelButton: 'bg-hover text-fg-2',
        },
      }}
      {...props}
    />
  );
}
