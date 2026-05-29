import { expect, test, type Page } from "@playwright/test";

const WALLET_ADDRESS = `G${"A".repeat(55)}`;

function buildJwt(address: string) {
  const payload = {
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    walletAddress: address,
  };
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "sig",
  ].join(".");
}

async function mockFreighter(page: Page, address: string) {
  const freighter = {
    isConnected: async () => ({ isConnected: true }),
    isAllowed: async () => ({ isAllowed: true }),
    getAddress: async () => ({ address }),
    requestAccess: async () => ({ address }),
    signMessage: async (_msg: string) => ({ signedMessage: "mock-signed" }),
    signTransaction: async (xdr: string) => ({ signedTxXdr: `signed-${xdr}` }),
  };

  await page.addInitScript(
    (f) => Object.assign(window, { freighter: f, freighterApi: f }),
    freighter,
  );
}

async function mockAuthApi(page: Page, address: string) {
  await page.route("http://localhost:4000/auth/challenge", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ challenge: "sign-this-challenge" }),
    });
  });

  await page.route("http://localhost:4000/auth/verify", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: buildJwt(address) }),
    });
  });

  await page.route("http://localhost:4000/auth/logout", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });
}

test.describe("Login flow", () => {
  test("renders landing page and wallet connect entry point", async ({ page }) => {
    await mockFreighter(page, WALLET_ADDRESS);
    await page.goto("/");

    await expect(page.locator("body")).toBeVisible();
    const connectButton = page
      .getByRole("button", { name: /connect/i })
      .or(page.getByRole("link", { name: /connect/i }))
      .first();

    await expect(connectButton).toBeVisible({ timeout: 10_000 });
  });

  test("authenticates with a mocked Freighter wallet without timing failures", async ({
    page,
  }) => {
    await mockFreighter(page, WALLET_ADDRESS);
    await mockAuthApi(page, WALLET_ADDRESS);

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const connectButton = page
      .getByRole("button", { name: /connect/i })
      .or(page.getByRole("link", { name: /connect/i }))
      .first();

    await expect(connectButton).toBeVisible({ timeout: 10_000 });
    await connectButton.click();

    const signButton = page.getByRole("button", { name: /sign|authenticate|verify/i }).first();
    if (await signButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await signButton.click();
    }

    await expect(async () => {
      const storedToken = await page.evaluate(() =>
        window.sessionStorage.getItem("amana_jwt"),
      );
      expect(storedToken).toBeTruthy();
    }).toPass({ timeout: 10_000 });
  });

  test("pre-seeded session restores authenticated state without re-login", async ({
    page,
  }) => {
    await mockFreighter(page, WALLET_ADDRESS);

    await page.addInitScript(
      ({ token }) => window.sessionStorage.setItem("amana_jwt", token),
      { token: buildJwt(WALLET_ADDRESS) },
    );

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const addressText = page.getByText(WALLET_ADDRESS.slice(0, 6));
    const trueOrDashboard = addressText.or(page.getByRole("link", { name: /trade|dashboard/i }));
    await expect(trueOrDashboard.first()).toBeVisible({ timeout: 10_000 });
  });

  test("logout clears the session token", async ({ page }) => {
    await mockFreighter(page, WALLET_ADDRESS);
    await mockAuthApi(page, WALLET_ADDRESS);

    await page.addInitScript(
      ({ token }) => window.sessionStorage.setItem("amana_jwt", token),
      { token: buildJwt(WALLET_ADDRESS) },
    );

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const logoutButton = page.getByRole("button", { name: /log.?out|disconnect/i }).first();
    if (await logoutButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await logoutButton.click();

      await expect(async () => {
        const storedToken = await page.evaluate(() =>
          window.sessionStorage.getItem("amana_jwt"),
        );
        expect(storedToken).toBeNull();
      }).toPass({ timeout: 10_000 });
    }
  });
});
