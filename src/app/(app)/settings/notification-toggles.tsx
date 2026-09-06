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
    label: 'Cycle summary',
    description: 'Calls vs goal, streak, follow-ups due next cycle',
  },
  {
    key: 'mondayDigest',
    label: 'Team cycle digest',
    description: 'Totals vs goal, who is quiet',
  },
];

// evening_nudge and sunday_summary fire for anyone who logs their own
// activity -- associates and leaders alike (P19b: a leader has their own
// Dashboard/Goals/streak same as an associate, so there was no reason to
// withhold their personal nudge/summary). monday_digest still only ever
// fires for leaders/admins. admin gets none of the three -- an admin has no
// org (P11c), never logs activity, and has no target, so none of these
// would have anything to report. private.enqueue_due_notifications()
// enforces all of this in SQL regardless of what a toggle here is set to;
// showing a toggle no role could ever receive made it look like an opt-in
// that could never actually reach anyone. Filtering by role here is a
// display fix; the backend is the source of truth.
const ROWS_BY_ROLE: Record<'associate' | 'leader' | 'admin', (keyof Prefs)[]> = {
  associate: ['eveningNudge', 'sundaySummary'],
  leader: ['eveningNudge', 'sundaySummary', 'mondayDigest'],
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
