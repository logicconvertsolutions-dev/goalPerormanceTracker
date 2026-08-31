'use client';

import { useState, useTransition } from 'react';
import { Megaphone, X } from 'lucide-react';
import { dismissAnnouncementAction } from './announcements-actions';

interface AnnouncementItem {
  id: string;
  message: string;
}

/** Admin's platform-wide broadcast (upcoming update, new feature) — shown
 * to every signed-in user until they dismiss it. Dismissal is per-agent and
 * server-tracked (announcement_dismissals), so it stays dismissed across
 * devices, not just this browser. */
export function AnnouncementBanner({ announcements }: { announcements: AnnouncementItem[] }) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const visible = announcements.filter((a) => !dismissedIds.has(a.id));

  if (visible.length === 0) return null;

  function dismiss(id: string) {
    setDismissedIds((prev) => new Set(prev).add(id));
    startTransition(() => {
      dismissAnnouncementAction({ announcementId: id });
    });
  }

  return (
    <div className="flex flex-col gap-px print:hidden">
      {visible.map((a) => (
        <div key={a.id} className="flex items-start gap-2.5 bg-acc px-4 py-2.5 text-sm text-white md:px-6">
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
          <p className="min-w-0 flex-1">{a.message}</p>
          <button
            type="button"
            onClick={() => dismiss(a.id)}
            className="shrink-0 text-white/70 transition-smooth hover:text-white"
            aria-label="Dismiss announcement"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
