'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  DEFAULT_THEME,
  THEME_LABELS,
  THEME_SETTINGS,
  THEME_STORAGE_KEY,
  isDark,
  parseThemeSetting,
  type ThemeSetting,
} from '@/lib/theme';

const SYSTEM_DARK = '(prefers-color-scheme: dark)';

function apply(setting: ThemeSetting) {
  document.documentElement.classList.toggle(
    'dark',
    isDark(setting, window.matchMedia(SYSTEM_DARK).matches)
  );
}

/**
 * Auto / Light / Dark (03-ui.md "Theme rule"). Lives at the foot of the
 * desktop rail (`tone="chrome"`, light ink on the navy/glass rail) and in the
 * account menu on phones (`tone="surface"`).
 *
 * The first paint is handled by THEME_INIT_SCRIPT in app/layout.tsx; this
 * only reads the saved setting after mount (so server and client render the
 * same thing), applies changes, and keeps Auto in step with the OS.
 */
export function ThemeSwitch({
  tone = 'surface',
  className,
}: {
  tone?: 'chrome' | 'surface';
  className?: string;
}) {
  const [setting, setSetting] = useState<ThemeSetting>(DEFAULT_THEME);

  useEffect(() => {
    try {
      setSetting(parseThemeSetting(localStorage.getItem(THEME_STORAGE_KEY)));
    } catch {
      // Storage blocked: stay on Auto for this visit.
    }
  }, []);

  // Auto tracks the OS while the app is open (e.g. sunset schedule).
  useEffect(() => {
    if (setting !== 'auto') return;
    const media = window.matchMedia(SYSTEM_DARK);
    const onChange = () => apply('auto');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [setting]);

  function choose(next: ThemeSetting) {
    setSetting(next);
    apply(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Applies for this visit only.
    }
  }

  const chrome = tone === 'chrome';
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn('flex gap-0.5 rounded-[10px] p-0.5', chrome ? 'bg-white/10' : 'bg-hover', className)}
    >
      {THEME_SETTINGS.map((option) => {
        const on = setting === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => choose(option)}
            className={cn(
              'flex-1 rounded-[8px] text-xs transition-smooth',
              // 44px touch target on phones (account menu); the rail is desktop-only.
              chrome ? 'min-h-[32px]' : 'min-h-[44px]',
              chrome
                ? on
                  ? 'bg-white/20 font-medium text-white'
                  : 'text-[color:var(--side-muted)] hover:text-white'
                : on
                  ? 'bg-panel font-medium text-fg shadow-lift'
                  : 'text-fg-2 hover:text-fg'
            )}
          >
            {THEME_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
