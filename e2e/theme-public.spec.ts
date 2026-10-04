import { test, expect } from '@playwright/test';
import { PUBLIC_ROUTES } from './support/routes';
import {
  BODY_BG,
  THEME_COOKIE,
  attachScreenshot,
  expectReadableText,
  expectTheme,
  setThemeCookie,
} from './support/theme';

/**
 * Dark mode on pages that need no sign-in (P36). Always runnable: needs only
 * the app, not test accounts. Signed-in pages: theme-app.spec.ts.
 */

test.describe('every public page, both themes', () => {
  for (const route of PUBLIC_ROUTES) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${route} in ${theme}`, async ({ page, context, baseURL }, testInfo) => {
        await setThemeCookie(context, baseURL!, theme);
        await page.goto(route);
        await expectTheme(page, theme);
        await expectReadableText(page, testInfo, `${route}-${theme}`);
        await attachScreenshot(page, testInfo, `${route}-${theme}`);
      });
    }
  }
});

test.describe('theme selection', () => {
  test('defaults to light with no saved choice, even on a dark device', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    await expectTheme(page, 'light');
  });

  test('applies the saved theme before first paint (no light flash)', async ({ page, context, baseURL }) => {
    await setThemeCookie(context, baseURL!, 'dark');
    // Record the theme at the very first moment <body> exists, before React
    // has hydrated anything -- what the user actually sees on first paint.
    await page.addInitScript(() => {
      new MutationObserver((_, observer) => {
        if (!document.body) return;
        observer.disconnect();
        (window as unknown as { __firstPaintDark: boolean }).__firstPaintDark =
          document.documentElement.classList.contains('dark');
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto('/login');
    expect(await page.evaluate(() => (window as unknown as { __firstPaintDark: boolean }).__firstPaintDark)).toBe(true);
  });

  test('System follows the device and switches live without a reload', async ({ page, context, baseURL }) => {
    await setThemeCookie(context, baseURL!, 'system');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login');
    await expectTheme(page, 'light');

    const navigations: string[] = [];
    page.on('framenavigated', (f) => f === page.mainFrame() && navigations.push(f.url()));

    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expectTheme(page, 'light');
    expect(navigations, 'theme switch must not reload the page').toEqual([]);
  });

  test('an explicit choice ignores the device setting', async ({ page, context, baseURL }) => {
    await setThemeCookie(context, baseURL!, 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    await expectTheme(page, 'light');
  });

  test('a tampered cookie falls back to light and is never executed', async ({ page, context, baseURL }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await setThemeCookie(context, baseURL!, encodeURIComponent('"><script>window.__pwned=1</script>'));
    await page.goto('/login');
    await expectTheme(page, 'light');
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('printing is always light', async ({ page, context, baseURL }) => {
    await setThemeCookie(context, baseURL!, 'dark');
    await page.goto('/privacy');
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('body')).toHaveCSS('background-color', BODY_BG.light);
  });

  test('no hydration or console errors in dark mode', async ({ page, context, baseURL }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && /hydrat/i.test(m.text()) && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await setThemeCookie(context, baseURL!, 'dark');
    await page.goto('/login');
    await expectTheme(page, 'dark');
    expect(errors).toEqual([]);
  });

  test('the cookie holds only the preference', async ({ page, context, baseURL }) => {
    await setThemeCookie(context, baseURL!, 'dark');
    await page.goto('/login');
    const cookie = (await context.cookies()).find((c) => c.name === THEME_COOKIE);
    expect(cookie?.value).toBe('dark');
  });
});
