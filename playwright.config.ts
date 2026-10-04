import { defineConfig, devices } from '@playwright/test';

// E2E_BASE_URL runs the suite against an already-deployed environment (e.g.
// https://staging.kautis.ca) instead of starting a local dev server. Never
// point it at production: the signed-in specs log in as test accounts.
const externalBaseURL = process.env.E2E_BASE_URL;
const baseURL = externalBaseURL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },

  projects: [
    // Signs in once per role (credentials from env -- see e2e/auth.setup.ts).
    // No trace/video/screenshot: a trace records typed values, which here
    // would be the test account's password and TOTP code.
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { trace: 'off', video: 'off', screenshot: 'off' },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      dependencies: ['setup'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      dependencies: ['setup'],
    },
    // Phone viewports: the mobile tab bar and full-width layouts get their
    // own dark-mode pass (iOS Safari is WebKit, Android is Chromium).
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      dependencies: ['setup'],
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
      dependencies: ['setup'],
    },
  ],

  webServer: externalBaseURL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
      },
});
