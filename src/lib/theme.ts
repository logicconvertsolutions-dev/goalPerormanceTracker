/**
 * Theme setting: Auto / Light / Dark (03-ui.md "Theme rule").
 *
 * The setting lives in localStorage, per device -- it is a display
 * preference, not account data. Auto follows the OS and is what a user who
 * has never chosen gets. The resolved theme is the `dark` class on <html>
 * (Tailwind `darkMode: ['class']`; globals.css `.dark` holds the tokens).
 */
export const THEME_SETTINGS = ['auto', 'light', 'dark'] as const;
export type ThemeSetting = (typeof THEME_SETTINGS)[number];

export const THEME_STORAGE_KEY = 'kautis-theme';
export const DEFAULT_THEME: ThemeSetting = 'auto';

export const THEME_LABELS: Record<ThemeSetting, string> = {
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
};

/** Anything unrecognised (missing, corrupted, from an older build) is Auto. */
export function parseThemeSetting(value: unknown): ThemeSetting {
  return THEME_SETTINGS.includes(value as ThemeSetting) ? (value as ThemeSetting) : DEFAULT_THEME;
}

/** Whether a setting means dark, given what the OS currently prefers. */
export function isDark(setting: ThemeSetting, systemPrefersDark: boolean): boolean {
  return setting === 'dark' || (setting === 'auto' && systemPrefersDark);
}

/**
 * Runs in <head> before first paint (app/layout.tsx), so a dark-theme user
 * never sees a white flash. Plain ES5, no imports: it is inlined as a string.
 * Must agree with parseThemeSetting/isDark above -- theme.test.ts runs it
 * against them.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`;
