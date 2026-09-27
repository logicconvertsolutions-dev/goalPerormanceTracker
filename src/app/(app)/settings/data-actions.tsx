'use client';

import { Button } from '@/components/ui/button';

export function DataActions({ showDownloadEverything = false }: { showDownloadEverything?: boolean }) {
  if (!showDownloadEverything) return null;

  return (
    <div>
      <Button variant="secondary" asChild>
        <a href="/settings/export">Download everything</a>
      </Button>
      <p className="text-xs text-fg-3 mt-1">A JSON file of everything Kautis holds about you: your profile, contacts, activity, to-dos, reminders and settings.</p>
    </div>
  );
}
