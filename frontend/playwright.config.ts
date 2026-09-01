import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration.
 *
 * The API base URL is read from the `API_BASE_URL` environment variable
 * so tests can target different backends (local, staging, CI) without
 * code changes.  Falls back to http://localhost:4000 for local dev.
 *
 * Set `API_BASE_URL` in your shell or CI pipeline:
 *   API_BASE_URL=http://localhost:4000 npx playwright test
 *   API_BASE_URL=https://staging-api.amana.com npx playwright test
 */
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    /** Base URL for all API route mocking and navigation. */
    baseURL: API_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
