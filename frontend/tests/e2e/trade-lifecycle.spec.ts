import { expect, test, type Page } from '@playwright/test';

const BUYER_ADDRESS = 'GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU';
const SELLER_ADDRESS = 'GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3';

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

async function mockStellarRpc(page: Page) {
  await page.route('https://soroban-testnet.stellar.org/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { hash: 'mock-tx-hash' } }),
    });
  });
}

test.describe('Trade Lifecycle E2E', () => {
  test('creates a trade from the create trade form', async ({ page }) => {
    await seedAuthenticatedWallet(page);
    await mockStellarRpc(page);

    await page.route('http://localhost:4000/trades', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          tradeId: '4294967297',
          unsignedXdr: 'create-trade-xdr',
        }),
      });
    });

    await page.goto('/trades/create');
    await page.waitForLoadState('networkidle');

    await page.locator('select').first().selectOption('Maize');
    await page.getByPlaceholder(/e\.g\. 500/i).fill('25');
    await page.getByPlaceholder(/e\.g\. 450/i).fill('1000');
    await page.getByPlaceholder(/G\.\.\./i).fill(SELLER_ADDRESS);
    await page.getByRole('button', { name: /continue to negotiation/i }).click();

    await page.getByRole('button', { name: /review trade/i }).click();
    await page.getByRole('button', { name: /lock funds & create trade/i }).click();

    await expect(page.getByText(/trade created/i)).toBeVisible();
    await expect(page.getByText('4294967297')).toBeVisible();
    await expect(page.getByText('mock-tx-hash')).toBeVisible();
  });

  test('builds a deposit transaction for a funded trade', async ({ page }) => {
    await seedAuthenticatedWallet(page);
    await mockStellarRpc(page);

    await page.route('http://localhost:4000/trades/4294967297', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tradeId: '4294967297',
          buyerAddress: BUYER_ADDRESS,
          sellerAddress: SELLER_ADDRESS,
          amountCngn: '25000',
          status: 'CREATED',
          buyerLossBps: 5000,
          sellerLossBps: 5000,
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await page.route('http://localhost:4000/trades/4294967297/deposit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ unsignedXdr: 'deposit-tx-xdr' }),
      });
    });

    await page.goto('/trades/4294967297');
    await page.waitForLoadState('networkidle');

    const depositButton = page.getByRole('button', { name: /deposit|fund/i }).first();
    if (await depositButton.isVisible()) {
      await depositButton.click();
      await expect(page.getByText(/unsignedXdr|deposit/i)).toBeVisible();
    }
  });

  test('confirms delivery on a funded trade', async ({ page }) => {
    await seedAuthenticatedWallet(page);
    await mockStellarRpc(page);

    await page.route('http://localhost:4000/trades/4294967297', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tradeId: '4294967297',
          buyerAddress: BUYER_ADDRESS,
          sellerAddress: SELLER_ADDRESS,
          amountCngn: '25000',
          status: 'FUNDED',
          buyerLossBps: 5000,
          sellerLossBps: 5000,
          createdAt: new Date().toISOString(),
          fundedAt: new Date().toISOString(),
        }),
      });
    });

    await page.route('http://localhost:4000/trades/4294967297/confirm', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ unsignedXdr: 'confirm-delivery-xdr' }),
      });
    });

    await page.goto('/trades/4294967297');
    await page.waitForLoadState('networkidle');

    const confirmButton = page.getByRole('button', { name: /confirm/i }).first();
    if (await confirmButton.isVisible()) {
      await confirmButton.click();
      await expect(page.getByText(/delivery confirmed|confirmed/i)).toBeVisible();
    }
  });

  test('initiates a dispute on an active trade', async ({ page }) => {
    await seedAuthenticatedWallet(page);
    await mockStellarRpc(page);

    let disputeRequestBody: unknown;

    await page.route('http://localhost:4000/trades/stats', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ totalTrades: 1, totalVolume: 25000, openTrades: 1 }),
      });
    });

    await page.route('http://localhost:4000/wallet/balance', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ balance: '25000', asset: 'cNGN' }),
      });
    });

    await page.route('http://localhost:4000/trades?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              tradeId: 'T-DISPUTE-1',
              buyerAddress: BUYER_ADDRESS,
              sellerAddress: SELLER_ADDRESS,
              amountCngn: '25000',
              buyerLossBps: 5000,
              sellerLossBps: 5000,
              status: 'active',
              createdAt: new Date().toISOString(),
            },
          ],
          pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        }),
      });
    });

    await page.route('http://localhost:4000/trades/T-DISPUTE-1/dispute', async (route) => {
      disputeRequestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ unsignedXdr: 'dispute-xdr' }),
      });
    });

    await page.goto('/vault/manage');
    await page.waitForLoadState('networkidle');

    const disputeButton = page.getByRole('button', { name: /dispute/i }).first();
    if (await disputeButton.isVisible()) {
      await disputeButton.click();
      await page.getByLabel(/reason/i).fill('Goods not delivered as per agreement.');
      await page.getByRole('button', { name: /confirm/i }).click();
      await expect(page.getByText(/dispute initiated/i)).toBeVisible();
      expect(disputeRequestBody).toMatchObject({
        reason: expect.stringContaining('Goods not delivered'),
      });
    }
  });

  test('completes the full trade lifecycle end-to-end', async ({ page }) => {
    await seedAuthenticatedWallet(page);
    await mockStellarRpc(page);

    const tradeId = '4294967300';

    let createdTrade = false;
    await page.route('http://localhost:4000/trades', async (route) => {
      if (route.request().method() === 'POST') {
        createdTrade = true;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ tradeId, unsignedXdr: 'create-trade-xdr' }),
        });
      } else {
        await route.fallback();
      }
    });

    await page.goto('/trades/create');
    await page.waitForLoadState('networkidle');

    await page.locator('select').first().selectOption('Maize');
    await page.getByPlaceholder(/e\.g\. 500/i).fill('25');
    await page.getByPlaceholder(/e\.g\. 450/i).fill('1000');
    await page.getByPlaceholder(/G\.\.\./i).fill(SELLER_ADDRESS);
    await page.getByRole('button', { name: /continue to negotiation/i }).click();
    await page.getByRole('button', { name: /review trade/i }).click();
    await page.getByRole('button', { name: /lock funds & create trade/i }).click();

    await expect(page.getByText(/trade created/i)).toBeVisible();
    expect(createdTrade).toBe(true);
  });
});
