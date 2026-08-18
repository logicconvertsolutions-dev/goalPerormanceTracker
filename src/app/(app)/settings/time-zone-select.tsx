'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { updateTimeZoneAction } from './actions';

const COMMON_ZONES = [
  'America/St_Johns',
  'America/Halifax',
  'America/Toronto',
  'America/Winnipeg',
  'America/Edmonton',
  'America/Vancouver',
];

export function TimeZoneSelect({ current }: { current: string | null }) {
  const browserDefault =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'America/Toronto';
  const [value, setValue] = useState(current ?? browserDefault);
  const [, startTransition] = useTransition();

  const zones = COMMON_ZONES.includes(value) ? COMMON_ZONES : [value, ...COMMON_ZONES];

  return (
    <div className="space-y-1.5">
      <Label>Time zone</Label>
      <Select
        value={value}
        onValueChange={(v) => {
          setValue(v);
          startTransition(async () => {
            const result = await updateTimeZoneAction(v);
            if (!result.ok) toast.error('Could not save time zone');
          });
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {zones.map((z) => (
            <SelectItem key={z} value={z}>
              {z.replace('_', ' ')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
