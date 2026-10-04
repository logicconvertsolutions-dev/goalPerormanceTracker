import { mkdirSync } from 'node:fs';
import { test as setup, expect } from '@playwright/test';
import { totp } from './support/totp';
import { authFile } from './support/auth';
import type { Role } from './support/routes';

/**
 * Signs in once per role and saves the session for theme-app.spec.ts.
 * Credentials come only from env vars -- use dedicated staging test
 * accounts, never real users, and never commit them:
 *
 *   E2E_AGENT_EMAIL / E2E_AGENT_PASSWORD / E2E_AGENT_TOTP_SECRET
 *   E2E_LEADER_EMAIL / E2E_LEADER_PASSWORD / E2E_LEADER_TOTP_SECRET
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD / E2E_ADMIN_TOTP_SECRET
 *
 * The TOTP secret is the base32 key shown when enrolling MFA ("can't scan?").
 * A role with no credentials is skipped, and so are its signed-in tests.
 * Sessions land in e2e/.auth/ (git-ignored).
 */
const ROLES: Role[] = ['agent', 'leader', 'admin'];

for (const role of ROLES) {
  const prefix = `E2E_${role.toUpperCase()}`;
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  const secret = process.env[`${prefix}_TOTP_SECRET`];

  setup.describe(role, () => {
    // Decided before any browser launches.
    setup.skip(!email || !password, `${prefix}_EMAIL / _PASSWORD not set`);

    setup(`sign in as ${role}`, async ({ page }) => {
      await page.goto('/login');
      await page.getByLabel('Email', { exact: true }).first().fill(email!);
      await page.getByLabel('Password', { exact: true }).fill(password!);
      await page.getByRole('button', { name: /sign in/i }).first().click();

      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
      if (page.url().includes('/mfa/verify')) {
        expect(secret, `${prefix}_TOTP_SECRET is required: this account has MFA`).toBeTruthy();
        await page.getByLabel('Verification code').fill(totp(secret!));
        await page.getByRole('button', { name: /verify/i }).click();
        await page.waitForURL((url) => !url.pathname.startsWith('/mfa'), { timeout: 20_000 });
      }
      expect(page.url(), 'test account must already have MFA enrolled and terms accepted').not.toMatch(
        /\/(mfa\/setup|terms\/accept|login)/
      );

      mkdirSync('e2e/.auth', { recursive: true });
      await page.context().storageState({ path: authFile(role) });
    });
  });
}
