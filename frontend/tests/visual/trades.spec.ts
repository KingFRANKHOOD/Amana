import { test, expect } from '@playwright/test';

test.describe('Trades Page Visual Tests', () => {
  test('trades page header matches snapshot', async ({ page }) => {
    await page.goto('/trades');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toHaveText('Trades');
    const header = page.locator('header').first();
    await expect(header).toHaveScreenshot('trades-header.png');
  });

  test('trades page main content matches snapshot', async ({ page }) => {
    await page.goto('/trades');
    await page.waitForLoadState('networkidle');
    const main = page.locator('main').first();
    await expect(main).toHaveScreenshot('trades-main.png');
  });
});
