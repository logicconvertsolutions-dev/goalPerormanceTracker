import { z } from 'zod';

/**
 * Appearance preference (P36). Stored per device in a cookie -- a UI
 * preference, not account data, so it never touches the database and
 * "System" can legitimately differ between a user's laptop and phone.
 *
 * The cookie is deliberately NOT HttpOnly: the inline bootstrap script in
 * app/layout.tsx must read it before first paint to avoid a light flash.
 * It carries no identity or secret, only one of the three literals below,
 * and every reader validates it against that allow-list.
 */
export const THEME_COOKIE = 'kautis-theme';

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export const themePreferenceSchema = z.enum(THEME_PREFERENCES);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;
export type ResolvedTheme = 'light' | 'dark';

/** Existing users keep the light theme until they choose otherwise. */
export const DEFAULT_THEME: ThemePreference = 'light';

/** One year, refreshed on every change. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** Browser chrome colour (`<meta name="theme-color">`) per resolved theme. */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#0B1E3D',
  dark: '#0E1626',
};

/** Parses a raw cookie value; anything unexpected falls back to the default. */
export function parseThemePreference(value: string | null | undefined): ThemePreference {
  const parsed = themePreferenceSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_THEME;
}

/** Reads the preference out of a `document.cookie`-style string. */
export function readThemeCookie(cookieString: string): ThemePreference {
  const match = cookieString.match(new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([^;]*)`));
  return parseThemePreference(match ? decodeURIComponent(match[1]) : null);
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/** Serializes the cookie for `document.cookie`. Secure whenever served over HTTPS. */
export function serializeThemeCookie(preference: ThemePreference, secure: boolean): string {
  const value = themePreferenceSchema.parse(preference);
  return [
    `${THEME_COOKIE}=${value}`,
    'Path=/',
    `Max-Age=${THEME_COOKIE_MAX_AGE}`,
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/**
 * Runs inline in <head> before the body paints. A static string -- nothing
 * user-controlled is interpolated -- and the cookie value is matched against
 * a literal allow-list, so a tampered cookie can only ever fall back to light.
 * Kept dependency-free and ES5 so it runs on every browser the app supports.
 * Must stay in sync with resolveTheme()/THEME_COLOR (theme.test.ts checks).
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=(light|dark|system)(?:;|$)/);var p=m?m[1]:'${DEFAULT_THEME}';var d=p==='dark'||(p==='system'&&window.matchMedia('${DARK_MEDIA_QUERY}').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';e.setAttribute('data-theme-preference',p);}catch(_){}})();`;
