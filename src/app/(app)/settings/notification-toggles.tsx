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
    description: 'Calls vs target, streak, follow-ups due next week',
  },
  {
    key: 'mondayDigest',
    label: 'Monday team digest',
    description: 'Leaders only — totals vs target, who is quiet',
  },
];

export function NotificationToggles({ initial }: { initial: Prefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [, startTransition] = useTransition();

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
      {ROWS.map((row) => (
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
