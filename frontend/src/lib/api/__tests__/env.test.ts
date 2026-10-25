import { getWalletBalanceRefreshIntervalMs } from "../env";

describe("getWalletBalanceRefreshIntervalMs", () => {
  const original = process.env.NEXT_PUBLIC_WALLET_BALANCE_REFRESH_MS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.NEXT_PUBLIC_WALLET_BALANCE_REFRESH_MS;
    } else {
      process.env.NEXT_PUBLIC_WALLET_BALANCE_REFRESH_MS = original;
    }
  });

  it("defaults to 30 seconds when the env var is unset", () => {
    delete process.env.NEXT_PUBLIC_WALLET_BALANCE_REFRESH_MS;
    expect(getWalletBalanceRefreshIntervalMs()).toBe(30_000);
  });

  it("returns the configured interval when set to a valid value", () => {
    process.env.NEXT_PUBLIC_WALLET_BALANCE_REFRESH_MS = "5000";
    expect(getWalletBalanceRefreshIntervalMs()).toBe(5_000);
  });

  it("falls back to the default for non-numeric values", () => {
    process.env.NEXT_PUBLIC_WALLET_BALANCE_REFRESH_MS = "not-a-number";
    expect(getWalletBalanceRefreshIntervalMs()).toBe(30_000);
  });

  it("falls back to the default for non-positive values", () => {
    process.env.NEXT_PUBLIC_WALLET_BALANCE_REFRESH_MS = "0";
    expect(getWalletBalanceRefreshIntervalMs()).toBe(30_000);
  });
});
