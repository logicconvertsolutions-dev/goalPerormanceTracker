'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { browserTimeZone } from '@/lib/dates';
import { setAnnouncementActiveAction } from './actions';

export function AnnouncementRow({
  id,
  message,
  active,
  createdAt,
}: {
  id: string;
  message: string;
  active: boolean;
  createdAt: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-3 last:border-0">
      <div className="min-w-0">
        <p className="text-sm text-fg whitespace-pre-wrap">{message}</p>
        <p className="mt-1 text-xs text-fg-3">
          {new Date(createdAt).toLocaleDateString('en-CA', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: browserTimeZone(),
          })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={active ? 'ok' : 'neutral'}>{active ? 'Live' : 'Retracted'}</Badge>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await setAnnouncementActiveAction({ announcementId: id, active: !active });
              if (result.ok) toast.success(active ? 'Announcement retracted' : 'Announcement reactivated');
              else toast.error(result.error ?? 'Could not update — try again');
            })
          }
        >
          {active ? 'Retract' : 'Reactivate'}
        </Button>
      </div>
    </div>
  );
}
