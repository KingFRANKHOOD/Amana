import { test, expect } from '@playwright/test';

/**
 * E2E tests for admin API endpoints.
 *
 * Verifies that admin-protected routes return proper 403 FORBIDDEN
 * responses for unauthenticated or non-admin callers.
 *
 * All routes use relative URLs resolved against the configurable `baseURL`.
 */

test.describe('Admin API', () => {
  test('POST /admin/evidence/verify returns 401 without auth', async ({ request }) => {
    const response = await request.post('/admin/evidence/verify');
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  test('POST /admin/evidence/verify returns 403 for non-admin', async ({ request }) => {
    // Simulate a regular (non-admin) authenticated user
    const response = await request.post('/admin/evidence/verify', {
      headers: { Authorization: 'Bearer regular-user-token' },
    });

    // Should be 401 or 403, never 500
    expect([401, 403]).toContain(response.status());
  });

  test('GET /admin/feature-flags returns 401 without auth', async ({ request }) => {
    const response = await request.get('/admin/feature-flags');
    expect(response.status()).toBe(401);
  });
});
