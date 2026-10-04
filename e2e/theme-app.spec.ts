import { existsSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { authFile } from './support/auth';
import { ROLE_ROUTES, type Role } from './support/routes';
import {
  THEME_COOKIE,
  attachScreenshot,
  expectReadableText,
  expectTheme,
  setThemeCookie,
} from './support/theme';

/**
 * Dark mode across every signed-in page, per role (P36). Uses the sessions
 * saved by auth.setup.ts; a role without test credentials is skipped, so this
 * file is a no-op until the E2E_* env vars are configured (see auth.setup.ts).
 */

async function gotoSettled(page: Page, route: string) {
  const response = await page.goto(route);
  expect(response?.status(), `${route} responded`).toBeLessThan(400);
  // A guard redirect (e.g. /login) means the session isn't valid for this page.
  expect(new URL(page.url()).pathname, `${route} redirected`).toBe(route);
  await page.waitForLoadState('networkidle');
}

for (const role of Object.keys(ROLE_ROUTES) as Role[]) {
  test.describe(`${role}: every page, both themes`, () => {
    test.skip(!existsSync(authFile(role)), `no ${role} session (set E2E_${role.toUpperCase()}_* env vars)`);
    test.use({ storageState: existsSync(authFile(role)) ? authFile(role) : undefined });

    for (const route of ROLE_ROUTES[role]) {
      for (const theme of ['light', 'dark'] as const) {
        test(`${route} in ${theme}`, async ({ page, context, baseURL }, testInfo) => {
          await setThemeCookie(context, baseURL!, theme);
          await gotoSettled(page, route);
          await expectTheme(page, theme);
          await expectReadableText(page, testInfo, `${role}${route.replace(/\//g, '-')}-${theme}`);
          await attachScreenshot(page, testInfo, `${role}${route.replace(/\//g, '-')}-${theme}`);
        });
      }
    }

    test('menus, dialogs and toasts are readable in dark', async ({ page, context, baseURL }, testInfo) => {
      await setThemeCookie(context, baseURL!, 'dark');
      await gotoSettled(page, role === 'admin' ? '/settings' : '/today');

      await page.getByRole('button', { name: 'Account menu' }).first().click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expectReadableText(page, testInfo, `${role}-account-menu-dark`);
      await page.keyboard.press('Escape');

      const bell = page.getByRole('button', { name: /^Notifications/ }).first();
      if (await bell.isVisible()) {
        await bell.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectReadableText(page, testInfo, `${role}-notifications-dark`);
        await attachScreenshot(page, testInfo, `${role}-notifications-dark`);
        await page.keyboard.press('Escape');
      }
    });
  });
}

test.describe('Appearance setting', () => {
  test.skip(!existsSync(authFile('agent')), 'no agent session (set E2E_AGENT_* env vars)');
  test.use({ storageState: existsSync(authFile('agent')) ? authFile('agent') : undefined });

  test('switching theme applies instantly, persists across reloads and pages', async ({ page, context }) => {
    await context.clearCookies({ name: THEME_COOKIE });
    await gotoSettled(page, '/settings');
    await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();

    await page.getByText('Dark', { exact: true }).click();
    await expectTheme(page, 'dark');

    await page.reload();
    await expectTheme(page, 'dark');
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();

    await gotoSettled(page, '/today');
    await expectTheme(page, 'dark');

    await gotoSettled(page, '/settings');
    await page.getByText('Light', { exact: true }).click();
    await expectTheme(page, 'light');
  });

  test('System follows the device live', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await gotoSettled(page, '/settings');
    await page.getByText('System', { exact: true }).click();
    await expectTheme(page, 'light');
    await expect(page.getByText(/currently light/i)).toBeVisible();

    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'dark');
    await expect(page.getByText(/currently dark/i)).toBeVisible();
  });

  test('cookie is scoped, SameSite=Lax, and Secure on HTTPS', async ({ page, context, baseURL }) => {
    await gotoSettled(page, '/settings');
    await page.getByText('Dark', { exact: true }).click();
    const cookie = (await context.cookies()).find((c) => c.name === THEME_COOKIE);
    expect(cookie).toMatchObject({ value: 'dark', path: '/', sameSite: 'Lax' });
    expect(cookie!.secure).toBe(baseURL!.startsWith('https:'));
    // Readable by the pre-paint script by design; carries nothing sensitive.
    expect(cookie!.httpOnly).toBe(false);
    expect(cookie!.expires).toBeGreaterThan(Date.now() / 1000 + 300 * 24 * 3600);
  });

  test('keyboard users can change the theme', async ({ page }) => {
    await gotoSettled(page, '/settings');
    await page.getByRole('radio', { name: 'Light' }).check();
    await page.getByRole('radio', { name: 'Light' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
    await expectTheme(page, 'dark');
    await page.getByRole('radio', { name: 'Light' }).check();
  });
});
