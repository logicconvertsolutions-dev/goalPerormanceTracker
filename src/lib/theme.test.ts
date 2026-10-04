import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_THEME,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_COOKIE,
  parseThemePreference,
  readThemeCookie,
  resolveTheme,
  serializeThemeCookie,
} from './theme';

function clearCookie() {
  document.cookie = `${THEME_COOKIE}=; Max-Age=0; Path=/`;
}

function mockSystemDark(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: dark && query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
}

function runBootstrap() {
  // Executes exactly the string that ships in <head>.
  new Function(THEME_BOOTSTRAP_SCRIPT)();
  const root = document.documentElement;
  return { dark: root.classList.contains('dark'), scheme: root.style.colorScheme };
}

afterEach(() => {
  clearCookie();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
  vi.unstubAllGlobals();
});

describe('theme preference parsing', () => {
  it('defaults existing users to light', () => {
    expect(DEFAULT_THEME).toBe('light');
    expect(parseThemePreference(undefined)).toBe('light');
    expect(readThemeCookie('')).toBe('light');
  });

  it('accepts only the three known values', () => {
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('system')).toBe('system');
    for (const bad of ['DARK', 'dark ', 'purple', '<script>', 'dark;evil=1', '']) {
      expect(parseThemePreference(bad)).toBe('light');
    }
  });

  it('reads the cookie among others and ignores look-alike names', () => {
    expect(readThemeCookie(`sb-token=abc; ${THEME_COOKIE}=dark; other=1`)).toBe('dark');
    expect(readThemeCookie(`not-${THEME_COOKIE}=dark`)).toBe('light');
    expect(readThemeCookie(`${THEME_COOKIE}=%3Cscript%3E`)).toBe('light');
  });

  it('resolves system against the device setting', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });
});

describe('theme cookie', () => {
  it('is scoped, long-lived, SameSite=Lax and Secure over HTTPS', () => {
    const cookie = serializeThemeCookie('dark', true);
    expect(cookie).toContain(`${THEME_COOKIE}=dark`);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toMatch(/Max-Age=\d+/);
    expect(serializeThemeCookie('light', false)).not.toContain('Secure');
  });

  it('refuses to serialize anything outside the allow-list', () => {
    expect(() => serializeThemeCookie('dark; Domain=evil.com' as never, true)).toThrow();
  });
});

describe('inline bootstrap script', () => {
  it('applies light when there is no cookie, even on a dark device', () => {
    mockSystemDark(true);
    expect(runBootstrap()).toEqual({ dark: false, scheme: 'light' });
  });

  it('applies an explicit dark choice regardless of the device', () => {
    mockSystemDark(false);
    document.cookie = `${THEME_COOKIE}=dark; Path=/`;
    expect(runBootstrap()).toEqual({ dark: true, scheme: 'dark' });
  });

  it('follows the device when set to system', () => {
    document.cookie = `${THEME_COOKIE}=system; Path=/`;
    mockSystemDark(true);
    expect(runBootstrap().dark).toBe(true);
    mockSystemDark(false);
    expect(runBootstrap().dark).toBe(false);
  });

  it('falls back to light for a tampered cookie', () => {
    mockSystemDark(true);
    document.cookie = `${THEME_COOKIE}=darkness; Path=/`;
    expect(runBootstrap().dark).toBe(false);
  });

  it('never throws, even without matchMedia', () => {
    document.cookie = `${THEME_COOKIE}=system; Path=/`;
    vi.stubGlobal('matchMedia', undefined);
    expect(() => runBootstrap()).not.toThrow();
  });

  it('contains no interpolated runtime data', () => {
    // Only the cookie name, allow-list, default and media query are baked in.
    expect(THEME_BOOTSTRAP_SCRIPT).not.toMatch(/\$\{/);
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('(light|dark|system)');
  });
});
