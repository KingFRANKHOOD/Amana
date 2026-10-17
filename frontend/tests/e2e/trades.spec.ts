import { test, expect } from '@playwright/test';

/**
 * E2E tests for trade-related API endpoints.
 *
 * All routes use relative URLs — Playwright resolves them against the
 * `baseURL` configured in playwright.config.ts, which reads from the
 * `API_BASE_URL` environment variable.  This means the same tests work
 * against localhost, staging, or any CI environment without code changes.
 */

test.describe('Trade API', () => {
  test('GET /trades returns 401 without auth', async ({ request }) => {
    const response = await request.get('/trades');
    expect(response.status()).toBe(401);
  });

  test('POST /trades returns 401 without auth', async ({ request }) => {
    const response = await request.post('/trades', {
      data: {
        sellerAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        amountUsdc: '100.00',
      },
    });
    expect(response.status()).toBe(401);
  });

  test('GET /trades/:id returns 404 for nonexistent trade', async ({ request }) => {
    const response = await request.get('/trades/nonexistent-id');
    expect(response.status()).toBe(404);
  });
});

test.describe('Trade API — error codes', () => {
  test('returns consistent error structure', async ({ request }) => {
    const response = await request.get('/trades');
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
    expect(body.error).toHaveProperty('statusCode');
  });
});
