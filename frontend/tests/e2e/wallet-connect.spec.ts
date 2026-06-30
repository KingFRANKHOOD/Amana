import { expect, test, type Page } from '@playwright/test';

const BUYER_ADDRESS = 'GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU';

function testJwt(walletAddress: string) {
  const payload = {
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    walletAddress,
  };
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'e2e',
  ].join('.');
}

async function seedAuthenticatedWallet(page: Page, address = BUYER_ADDRESS) {
  await page.addInitScript(
    ({ token, addr }) => {
      window.sessionStorage.setItem('amana_jwt', token);
      const freighter = {
        isConnected: async () => ({ isConnected: true }),
        isAllowed: async () => ({ isAllowed: true }),
        getAddress: async () => ({ address: addr }),
        requestAccess: async () => ({ address: addr }),
        signMessage: async () => ({ signedMessage: 'signed-message' }),
        signTransaction: async (xdr: string) => ({ signedTxXdr: `signed-${xdr}` }),
      };
      Object.assign(window, { freighter, freighterApi: freighter });
    },
    { token: testJwt(address), addr: address },
  );
}

test.describe('Wallet Connection Flow', () => {
  test('redirects to login when no wallet is connected', async ({ page }) => {
    await page.goto('/trades');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/.*login.*|.*\/$/i);
  });

  test('connects wallet via Freighter and stores JWT', async ({ page }) => {
    await page.addInitScript(
      ({ addr }) => {
        const freighter = {
          isConnected: async () => ({ isConnected: false }),
          isAllowed: async () => ({ isAllowed: false }),
          getAddress: async () => ({ address: addr }),
          requestAccess: async () => ({ address: addr }),
          signMessage: async () => ({ signedMessage: 'signed-message' }),
          signTransaction: async (xdr: string) => ({ signedTxXdr: `signed-${xdr}` }),
        };
        Object.assign(window, { freighter, freighterApi: freighter });
      },
      { addr: BUYER_ADDRESS },
    );

    await page.route('http://localhost:4000/auth/challenge', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ challenge: 'sign-this-message', expiresAt: Date.now() + 60000 }),
      });
    });

    await page.route('http://localhost:4000/auth/verify', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: testJwt(BUYER_ADDRESS) }),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const connectButton = page.getByRole('button', { name: /connect|login|sign/i }).first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
    }

    await page.waitForTimeout(1000);
    const hasToken = await page.evaluate(() => window.sessionStorage.getItem('amana_jwt'));
    expect(hasToken).toBeTruthy();
  });

  test('shows wallet address when connected', async ({ page }) => {
    await seedAuthenticatedWallet(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(BUYER_ADDRESS.slice(0, 8))).toBeVisible();
  });
});
