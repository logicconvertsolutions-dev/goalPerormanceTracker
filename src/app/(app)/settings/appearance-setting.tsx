'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTheme } from '@/components/shell/theme-provider';
import { themePreferenceSchema, type ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/**
 * Light / Dark / System (P36). Native radio inputs styled as a segmented
 * control, so keyboard (arrow keys) and screen readers work without extra
 * ARIA. Applies instantly -- the choice is a per-device cookie, not account
 * data, so there's nothing to save to the server.
 */
export function AppearanceSetting() {
  const { preference, resolved, setPreference } = useTheme();

  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-3 gap-1 rounded-sm border border-line-2 bg-sunken p-1">
        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const checked = preference === value;
          return (
            <label
              key={value}
              className={cn(
                'relative flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-[8px] text-sm font-medium transition-smooth',
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-acc',
                checked ? 'bg-panel text-fg shadow-lift' : 'text-fg-2 hover:text-fg'
              )}
            >
              <input
                type="radio"
                name="theme"
                value={value}
                checked={checked}
                onChange={(e) => {
                  // Re-validate: the value comes from the DOM.
                  const parsed = themePreferenceSchema.safeParse(e.target.value);
                  if (parsed.success) setPreference(parsed.data);
                }}
                className="sr-only"
                data-testid={`theme-option-${value}`}
              />
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-fg-3" aria-live="polite">
        {preference === 'system'
          ? `Matches your device — currently ${resolved}.`
          : 'Saved on this device.'}
      </p>
    </fieldset>
  );
}
