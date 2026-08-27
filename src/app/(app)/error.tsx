'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-bad-dim text-bad">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </span>
      <h1 className="text-lg font-semibold text-fg">Something went wrong</h1>
      <p className="text-sm text-fg-3">
        This page hit an error loading your data. Nothing was lost — try again.
      </p>
      <Button variant="primary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
