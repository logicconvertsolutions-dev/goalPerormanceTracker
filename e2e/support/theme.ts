import AxeBuilder from '@axe-core/playwright';
import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

export const THEME_COOKIE = 'kautis-theme';
export type Preference = 'light' | 'dark' | 'system';

/** Background colours the two themes paint <body> with (globals.css --c-bg). */
export const BODY_BG = { light: 'rgb(255, 255, 255)', dark: 'rgb(14, 22, 38)' } as const;

export async function setThemeCookie(context: BrowserContext, baseURL: string, value: string) {
  const { hostname } = new URL(baseURL);
  await context.addCookies([{ name: THEME_COOKIE, value, domain: hostname, path: '/', sameSite: 'Lax' }]);
}

/** Asserts the page is fully in one theme: class, color-scheme and painted background. */
export async function expectTheme(page: Page, theme: 'light' | 'dark') {
  const html = page.locator('html');
  if (theme === 'dark') await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  else await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
  await expect(html).toHaveCSS('color-scheme', theme);
  await expect(page.locator('body')).toHaveCSS('background-color', BODY_BG[theme]);
}

/**
 * The "letters are visible" check: axe-core's WCAG AA colour-contrast rule
 * over everything rendered, including text over images/gradients (which
 * axe reports as "needs review" rather than pass/fail -- those are listed in
 * the attachment, not failed, since they need a human eye).
 */
export async function expectReadableText(page: Page, testInfo: TestInfo, label: string) {
  // Let fonts and the backdrop settle so axe measures final colours.
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page })
    .withRules(['color-contrast'])
    .exclude('[aria-hidden="true"]')
    .analyze();

  await testInfo.attach(`${label}-contrast.json`, {
    body: JSON.stringify({ violations: results.violations, incomplete: results.incomplete }, null, 2),
    contentType: 'application/json',
  });

  const failures = results.violations.flatMap((v) =>
    v.nodes.map((n) => `${n.target.join(' ')} -- ${n.failureSummary?.split('\n').slice(1).join(' ').trim()}`)
  );
  expect(failures, `${label}: text below WCAG AA contrast:\n${failures.join('\n')}`).toEqual([]);
}

/** Full-page screenshot attached to the report for a visual once-over. */
export async function attachScreenshot(page: Page, testInfo: TestInfo, label: string) {
  await testInfo.attach(`${label}.png`, {
    body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
    contentType: 'image/png',
  });
}
