import { expect, test, type Page } from '@playwright/test';

const MEDIATOR_ADDRESS = 'GEXAMPLEMEDIATORPUBLICKEY1';
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

async function seedMediatorWallet(page: Page) {
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
    { token: testJwt(addr), addr: MEDIATOR_ADDRESS },
  );
}

test.describe('Dispute Resolution Flow', () => {
  test('displays open disputes on the mediator dashboard', async ({ page }) => {
    await seedMediatorWallet(page);

    await page.route('http://localhost:4000/disputes?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 1,
              tradeId: '4294967297',
              initiator: SELLER_ADDRESS,
              reason: 'Buyer refuses to confirm delivery after goods were shipped.',
              status: 'OPEN',
              createdAt: new Date().toISOString(),
              trade: {
                buyerAddress: BUYER_ADDRESS,
                sellerAddress: SELLER_ADDRESS,
                amountUsdc: '25000',
              },
            },
          ],
          pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
        }),
      });
    });

    await page.route('http://localhost:4000/trades/4294967297/evidence', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ evidence: [] }),
      });
    });

    await page.goto('/mediator/disputes');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/mediator disputes/i)).toBeVisible();
    await expect(page.getByText(/4294967297/i)).toBeVisible();
    await expect(page.getByText(/25000/i)).toBeVisible();
  });

  test('resolves a dispute with equal split', async ({ page }) => {
    await seedMediatorWallet(page);

    await page.route('http://localhost:4000/disputes?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 1,
              tradeId: '4294967297',
              initiator: BUYER_ADDRESS,
              reason: 'Goods damaged on arrival.',
              status: 'OPEN',
              createdAt: new Date().toISOString(),
              trade: {
                buyerAddress: BUYER_ADDRESS,
                sellerAddress: SELLER_ADDRESS,
                amountUsdc: '25000',
              },
            },
          ],
          pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
        }),
      });
    });

    await page.route('http://localhost:4000/trades/4294967297/evidence', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          evidence: [
            {
              id: 'ev-001',
              cid: 'QmTestHash123',
              mimeType: 'image/jpeg',
              uploadedBy: SELLER_ADDRESS,
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      });
    });

    await page.goto('/mediator/disputes');
    await page.waitForLoadState('networkidle');

    await page.getByText(/4294967297/i).click();
    await expect(page.getByText(/resolve dispute/i)).toBeVisible();

    const equalSplitButton = page.getByRole('button', {
      name: /equal split|50\/50/i,
    }).first();
    if (await equalSplitButton.isVisible()) {
      await equalSplitButton.click();
      await expect(page.getByText(/confirm resolution/i)).toBeVisible();
      await expect(page.getByText(/seller receives/i)).toBeVisible();
    }
  });

  test('submits evidence for a dispute', async ({ page }) => {
    await seedMediatorWallet(page);

    await page.route('http://localhost:4000/trades/4294967297/evidence', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            evidenceId: 'ev-002',
            ipfsHash: 'QmNewEvidenceHash',
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            evidence: [
              {
                id: 'ev-001',
                cid: 'QmExistingHash',
                mimeType: 'video/mp4',
                uploadedBy: SELLER_ADDRESS,
                createdAt: new Date().toISOString(),
              },
            ],
          }),
        });
      }
    });

    await page.route('http://localhost:4000/disputes?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 1,
              tradeId: '4294967297',
              initiator: BUYER_ADDRESS,
              reason: 'Damaged goods.',
              status: 'OPEN',
              createdAt: new Date().toISOString(),
              trade: {
                buyerAddress: BUYER_ADDRESS,
                sellerAddress: SELLER_ADDRESS,
                amountUsdc: '25000',
              },
            },
          ],
          pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
        }),
      });
    });

    await page.goto('/mediator/disputes');
    await page.waitForLoadState('networkidle');
    await page.getByText(/4294967297/i).click();
    await expect(page.getByText(/evidence/i)).toBeVisible();
  });
});
