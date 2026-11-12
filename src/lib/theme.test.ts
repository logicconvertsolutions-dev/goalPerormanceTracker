import { describe, expect, it } from 'vitest';
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY, isDark, parseThemeSetting } from './theme';

describe('parseThemeSetting', () => {
  it('keeps a valid setting', () => {
    expect(parseThemeSetting('light')).toBe('light');
    expect(parseThemeSetting('dark')).toBe('dark');
    expect(parseThemeSetting('auto')).toBe('auto');
  });

  it('falls back to auto for anything else', () => {
    expect(parseThemeSetting(null)).toBe('auto');
    expect(parseThemeSetting(undefined)).toBe('auto');
    expect(parseThemeSetting('sepia')).toBe('auto');
    expect(parseThemeSetting('')).toBe('auto');
  });
});

describe('isDark', () => {
  it('follows the OS only on auto', () => {
    expect(isDark('auto', true)).toBe(true);
    expect(isDark('auto', false)).toBe(false);
    expect(isDark('light', true)).toBe(false);
    expect(isDark('dark', false)).toBe(true);
  });
});

describe('THEME_INIT_SCRIPT', () => {
  /** Runs the inlined script against a fake window/document/localStorage. */
  function run(stored: string | null, systemPrefersDark: boolean, storageThrows = false) {
    let dark: boolean | undefined;
    const env = {
      localStorage: {
        getItem: (key: string) => {
          if (storageThrows) throw new Error('blocked');
          return key === THEME_STORAGE_KEY ? stored : null;
        },
      },
      window: { matchMedia: () => ({ matches: systemPrefersDark }) },
      document: {
        documentElement: { classList: { toggle: (_: string, on: boolean) => (dark = on) } },
      },
    };
    new Function('localStorage', 'window', 'document', THEME_INIT_SCRIPT)(
      env.localStorage,
      env.window,
      env.document
    );
    return dark;
  }

  it('agrees with parseThemeSetting + isDark for every stored value', () => {
    for (const stored of [null, 'auto', 'light', 'dark', 'sepia']) {
      for (const system of [true, false]) {
        expect(run(stored, system)).toBe(isDark(parseThemeSetting(stored), system));
      }
    }
  });

  it('leaves the page alone when storage is blocked', () => {
    expect(run('dark', true, true)).toBeUndefined();
  });
});
