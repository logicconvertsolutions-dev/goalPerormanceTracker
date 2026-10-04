'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DARK_MEDIA_QUERY,
  DEFAULT_THEME,
  THEME_COLOR,
  readThemeCookie,
  resolveTheme,
  serializeThemeCookie,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';

type ThemeContextValue = {
  /** What the user picked: light, dark, or follow the device. */
  preference: ThemePreference;
  /** What is actually showing right now. */
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Re-applies the theme to <html>. The inline bootstrap script in
 * app/layout.tsx does the same before first paint; this keeps it correct
 * afterwards (user changes the setting, OS flips light/dark, another tab
 * changed the cookie).
 */
function applyTheme(resolved: ResolvedTheme, preference: ThemePreference) {
  const root = document.documentElement;
  // Suppress the app's colour transitions for this one frame so every
  // surface flips at once instead of fading through mismatched states.
  const freeze = document.createElement('style');
  freeze.appendChild(document.createTextNode('*,*::before,*::after{transition:none!important}'));
  document.head.appendChild(freeze);

  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  root.setAttribute('data-theme-preference', preference);
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute('content', THEME_COLOR[resolved]));

  // Force a style flush before re-enabling transitions.
  void window.getComputedStyle(document.body).opacity;
  window.setTimeout(() => freeze.remove(), 1);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // The server can't know the device's preference, so the first client
  // render matches the server (default) and the effect below syncs to the
  // real value -- <html> itself is already correct from the bootstrap script.
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_THEME);
  const [resolved, setResolved] = useState<ResolvedTheme>('light');

  const sync = useCallback(() => {
    const pref = readThemeCookie(document.cookie);
    const next = resolveTheme(pref, window.matchMedia(DARK_MEDIA_QUERY).matches);
    setPreferenceState(pref);
    setResolved(next);
    const root = document.documentElement;
    if (root.classList.contains('dark') !== (next === 'dark') || root.getAttribute('data-theme-preference') !== pref) {
      applyTheme(next, pref);
    } else {
      document
        .querySelectorAll('meta[name="theme-color"]')
        .forEach((meta) => meta.setAttribute('content', THEME_COLOR[next]));
    }
  }, []);

  useEffect(() => {
    sync();
    const media = window.matchMedia(DARK_MEDIA_QUERY);
    // Live OS switching (e.g. a phone's scheduled dark mode at sunset).
    // addListener is the fallback for Safari < 14.
    if (media.addEventListener) media.addEventListener('change', sync);
    else media.addListener(sync);
    // Pick up a change made in another tab when this one is shown again.
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', sync);
      else media.removeListener(sync);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sync]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      document.cookie = serializeThemeCookie(next, window.location.protocol === 'https:');
      sync();
    },
    [sync]
  );

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
