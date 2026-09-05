'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { updateNotificationPrefsAction } from './actions';

interface Prefs {
  eveningNudge: boolean;
  sundaySummary: boolean;
  mondayDigest: boolean;
}

const ROWS: { key: keyof Prefs; label: string; description: string }[] = [
  {
    key: 'eveningNudge',
    label: 'Evening nudge',
    description: '7:00 PM, only if you haven’t logged anything today',
  },
  {
    key: 'sundaySummary',
    label: 'Sunday summary',
    description: 'Calls vs goal, streak, follow-ups due next week',
  },
  {
    key: 'mondayDigest',
    label: 'Monday team digest',
    description: 'Totals vs goal, who is quiet',
  },
];

// evening_nudge and sunday_summary only ever fire for associates;
// monday_digest only ever fires for leaders/admins (private.
// enqueue_due_notifications() enforces this in SQL regardless of what a
// toggle here is set to) -- showing all three to everyone made it look like
// an associate could opt into "Monday team digest" when it could never
// actually reach them. Filtering by role here is purely a display fix; the
// backend was already correct.
const ROWS_BY_ROLE: Record<'associate' | 'leader' | 'admin', (keyof Prefs)[]> = {
  associate: ['eveningNudge', 'sundaySummary'],
  leader: ['mondayDigest'],
  admin: [],
};

export function NotificationToggles({
  initial,
  role,
}: {
  initial: Prefs;
  role: 'associate' | 'leader' | 'admin';
}) {
  const [prefs, setPrefs] = useState(initial);
  const [, startTransition] = useTransition();
  const visibleKeys = new Set(ROWS_BY_ROLE[role]);
  const rows = ROWS.filter((row) => visibleKeys.has(row.key));

  function toggle(key: keyof Prefs) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    startTransition(async () => {
      const result = await updateNotificationPrefsAction(next);
      if (!result.ok) {
        setPrefs(prefs);
        toast.error('Could not save — try again');
      }
    });
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.key} className="flex items-start gap-3">
          <Checkbox
            id={row.key}
            checked={prefs[row.key]}
            onCheckedChange={() => toggle(row.key)}
          />
          <div>
            <Label htmlFor={row.key} className="text-fg font-medium">
              {row.label}
            </Label>
            <p className="text-xs text-fg-3">{row.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
