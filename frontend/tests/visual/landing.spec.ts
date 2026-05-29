import { test, expect } from '@playwright/test';

test.describe('Landing Page Visual Tests', () => {
  test('landing header matches snapshot', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const header = page.locator('header').first();
    await expect(header).toHaveScreenshot('landing-header.png');
  });

  test('landing hero section matches snapshot', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const hero = page.locator('main').first();
    await expect(hero).toHaveScreenshot('landing-hero.png');
  });
});
