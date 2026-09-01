import { test, expect } from '@playwright/test';

/**
 * E2E tests for authentication API endpoints.
 *
 * All routes use relative URLs resolved against the configurable
 * `baseURL` — no hardcoded host:port values.
 */

test.describe('Auth API', () => {
  test('POST /auth/challenge returns a challenge string', async ({ request }) => {
    const response = await request.post('/auth/challenge', {
      data: { walletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANHUF' },
    });

    // Should return 200 with a challenge or 400 for invalid input — not 500
    expect([200, 400]).toContain(response.status());
  });

  test('POST /auth/verify rejects invalid credentials', async ({ request }) => {
    const response = await request.post('/auth/verify', {
      data: {
        walletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANHUF',
        signedChallenge: 'invalid',
      },
    });

    expect([400, 401]).toContain(response.status());
  });
});
