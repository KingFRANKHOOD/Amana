import { expect, test, type Page } from "@playwright/test";

const MEDIATOR_ADDRESS = "GEXAMPLEMEDIATORPUBLICKEY1";
const SELLER_ADDRESS = `G${"S".repeat(55)}`;

function testJwt() {
  const payload = {
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    walletAddress: MEDIATOR_ADDRESS,
  };

  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "e2e",
  ].join(".");
}

async function seedAuthenticatedWallet(page: Page) {
  await page.addInitScript(
    ({ token, address }) => {
      window.sessionStorage.setItem("amana_jwt", token);

      const freighter = {
        isConnected: async () => ({ isConnected: true }),
        isAllowed: async () => ({ isAllowed: true }),
        getAddress: async () => ({ address }),
        requestAccess: async () => ({ address }),
        signMessage: async () => ({ signedMessage: "signed-message" }),
        signTransaction: async (xdr: string) => ({ signedTxXdr: `signed-${xdr}` }),
      };

      Object.assign(window, {
        freighter,
        freighterApi: freighter,
      });
    },
    { token: testJwt(), address: MEDIATOR_ADDRESS },
  );
}

async function mockRpc(page: Page) {
  await page.route("https://soroban-testnet.stellar.org/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { hash: "mock-tx-hash" } }),
    });
  });
}

test.describe("E2E coverage gaps", () => {
  test("covers complete trade creation through transaction submission", async ({ page }) => {
    await seedAuthenticatedWallet(page);
    await mockRpc(page);

    await page.route("http://localhost:4000/trades", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }

      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          tradeId: "4294967297",
          unsignedXdr: "create-trade-xdr",
        }),
      });
    });

    await page.goto("/trades/create");
    await page.locator("select").first().selectOption("Maize");
    await page.getByPlaceholder("e.g. 500").fill("25");
    await page.getByPlaceholder("e.g. 450").fill("1000");
    await page.getByPlaceholder("G...").fill(SELLER_ADDRESS);
    await page.getByRole("button", { name: "Continue to Negotiation" }).click();
    await page.getByRole("button", { name: "Review Trade" }).click();
    await page.getByRole("button", { name: "Lock Funds & Create Trade" }).click();

    await expect(page.getByText("Trade Created")).toBeVisible();
    await expect(page.getByText("4294967297")).toBeVisible();
    await expect(page.getByText("mock-tx-hash")).toBeVisible();
  });

  test("covers initiating a dispute from vault management", async ({ page }) => {
    await seedAuthenticatedWallet(page);

    let disputeRequestBody: unknown;

    await page.route("http://localhost:4000/trades/stats", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ totalTrades: 1, totalVolume: 25000, openTrades: 1 }),
      });
    });
    await page.route("http://localhost:4000/wallet/balance", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ balance: "25000", asset: "cNGN" }),
      });
    });
    await page.route("http://localhost:4000/trades?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              tradeId: "T-DISPUTE-1",
              buyerAddress: MEDIATOR_ADDRESS,
              sellerAddress: SELLER_ADDRESS,
              amountCngn: "25000",
              buyerLossBps: 5000,
              sellerLossBps: 5000,
              status: "active",
              createdAt: "2026-05-27T00:00:00.000Z",
              updatedAt: "2026-05-27T00:00:00.000Z",
            },
          ],
          pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        }),
      });
    });
    await page.route("http://localhost:4000/trades/T-DISPUTE-1/dispute", async (route) => {
      disputeRequestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ unsignedXdr: "dispute-xdr" }),
      });
    });

    await page.goto("/vault/manage");
    await page.getByRole("button", { name: "Dispute" }).click();
    await page.getByLabel("Reason").fill("Delivery documents do not match the agreed manifest.");
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByText("Dispute initiated successfully.")).toBeVisible();
    expect(disputeRequestBody).toMatchObject({
      reason: "Delivery documents do not match the agreed manifest.",
      category: "non_delivery",
    });
  });

  test("covers mediator dashboard list and resolution handoff", async ({ page }) => {
    await seedAuthenticatedWallet(page);
    await mockRpc(page);

    await page.route("http://localhost:4000/disputes?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: 1,
              tradeId: "4294967297",
              initiator: SELLER_ADDRESS,
              reason: "Shipment evidence conflicts with manifest.",
              status: "OPEN",
              createdAt: "2026-05-27T00:00:00.000Z",
              updatedAt: "2026-05-27T00:00:00.000Z",
              trade: {
                buyerAddress: MEDIATOR_ADDRESS,
                sellerAddress: SELLER_ADDRESS,
                amountUsdc: "25000",
              },
            },
          ],
          pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
        }),
      });
    });
    await page.route("http://localhost:4000/trades/4294967297/evidence", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ evidence: [] }),
      });
    });

    await page.goto("/mediator/disputes");
    await expect(page.getByText("Mediator Disputes")).toBeVisible();
    await page.getByText("Trade 4294967297").click();
    await expect(page.getByText("Resolve Dispute")).toBeVisible();
    await page.getByRole("button", { name: "Resolve — Equal Split (50/50)" }).click();
    await expect(page.getByText("Confirm Resolution")).toBeVisible();
    await expect(page.getByText("Seller Receives:")).toBeVisible();
    await expect(page.getByText("50/50")).toBeVisible();
  });
});
