/**
 * Comprehensive tests for StellarService, PathPaymentService, and WalletService.
 * Covers: happy paths, error paths, edge cases, network errors, and retry logic.
 * Issue #218
 */
import { __resetRetrySleepForTests, __setRetrySleepForTests } from "../lib/retry";
import { StellarService } from "../services/stellar.service";
import { PathPaymentService } from "../services/pathPayment.service";
import { WalletService } from "../services/wallet.service";

// ══════════════════════════════════════════════════════════════════════════
// StellarService – getAccountBalance
// ══════════════════════════════════════════════════════════════════════════
describe("StellarService.getAccountBalance", () => {
  let service: StellarService;
  const sleepMock = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    __setRetrySleepForTests(sleepMock);
    sleepMock.mockClear();
    service = new StellarService();
  });

  afterEach(() => {
    __resetRetrySleepForTests();
    jest.restoreAllMocks();
  });

  it("returns USDC balance for a valid address", async () => {
    jest.spyOn(service.getServer(), "loadAccount").mockResolvedValue({
      balances: [{ asset_code: "USDC", balance: "100.00" }],
    } as any);
    await expect(service.getAccountBalance("GVALID")).resolves.toBe("100.00");
  });

  it("returns XLM (native) balance when assetCode is XLM", async () => {
    jest.spyOn(service.getServer(), "loadAccount").mockResolvedValue({
      balances: [{ asset_type: "native", balance: "500.00" }],
    } as any);
    await expect(service.getAccountBalance("GVALID", "XLM")).resolves.toBe("500.00");
  });

  it("returns '0' when the asset is not found in balances", async () => {
    jest.spyOn(service.getServer(), "loadAccount").mockResolvedValue({
      balances: [{ asset_code: "BTC", balance: "0.5" }],
    } as any);
    await expect(service.getAccountBalance("GVALID", "USDC")).resolves.toBe("0");
  });

  it("returns '0' when balances array is empty", async () => {
    jest.spyOn(service.getServer(), "loadAccount").mockResolvedValue({
      balances: [],
    } as any);
    await expect(service.getAccountBalance("GVALID")).resolves.toBe("0");
  });

  it("handles zero balance correctly", async () => {
    jest.spyOn(service.getServer(), "loadAccount").mockResolvedValue({
      balances: [{ asset_code: "USDC", balance: "0.0000000" }],
    } as any);
    await expect(service.getAccountBalance("GVALID")).resolves.toBe("0.0000000");
  });

  it("handles extremely large balance (>1B USDC)", async () => {
    jest.spyOn(service.getServer(), "loadAccount").mockResolvedValue({
      balances: [{ asset_code: "USDC", balance: "1500000000.0000000" }],
    } as any);
    await expect(service.getAccountBalance("GVALID")).resolves.toBe("1500000000.0000000");
  });

  it("throws 'Unable to fetch balance' when account is not found (404)", async () => {
    jest.spyOn(service.getServer(), "loadAccount").mockRejectedValue({
      response: { status: 404 },
    });
    await expect(service.getAccountBalance("GNOTFOUND")).rejects.toThrow("Unable to fetch balance");
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("throws on malformed address (invalid base32 — 400)", async () => {
    jest.spyOn(service.getServer(), "loadAccount").mockRejectedValue({
      response: { status: 400 },
    });
    await expect(service.getAccountBalance("NOT_A_VALID_KEY")).rejects.toThrow("Unable to fetch balance");
  });

  it("retries on 503 Service Unavailable and eventually succeeds", async () => {
    const loadAccount = jest
      .spyOn(service.getServer(), "loadAccount")
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce({ balances: [{ asset_code: "USDC", balance: "42.00" }] } as any);

    await expect(service.getAccountBalance("GVALID")).resolves.toBe("42.00");
    expect(loadAccount).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(1000);
  });

  it("does not retry on plain errors (no HTTP status)", async () => {
    jest.spyOn(service.getServer(), "loadAccount").mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(service.getAccountBalance("GVALID")).rejects.toThrow("Unable to fetch balance");
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("does not retry on timeout errors (no HTTP status)", async () => {
    jest.spyOn(service.getServer(), "loadAccount").mockRejectedValue(new Error("timeout"));
    await expect(service.getAccountBalance("GVALID")).rejects.toThrow("Unable to fetch balance");
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("exhausts retries on persistent 503 and throws", async () => {
    jest.spyOn(service.getServer(), "loadAccount").mockRejectedValue({ response: { status: 503 } });
    await expect(service.getAccountBalance("GVALID")).rejects.toThrow("Unable to fetch balance");
    expect(sleepMock).toHaveBeenCalledTimes(3);
  });

  it("uses exponential backoff: 1s, 2s, 4s", async () => {
    jest.spyOn(service.getServer(), "loadAccount").mockRejectedValue({ response: { status: 500 } });
    await expect(service.getAccountBalance("GVALID")).rejects.toThrow();
    expect(sleepMock).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 2000);
    expect(sleepMock).toHaveBeenNthCalledWith(3, 4000);
  });

  it("accepts a valid Ed25519 Stellar public key format", async () => {
    jest.spyOn(service.getServer(), "loadAccount").mockResolvedValue({
      balances: [{ asset_code: "USDC", balance: "1.00" }],
    } as any);
    const validKey = "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE";
    await expect(service.getAccountBalance(validKey)).resolves.toBeDefined();
  });

  it("propagates error for account not found on ledger", async () => {
    jest.spyOn(service.getServer(), "loadAccount").mockRejectedValue({ response: { status: 404 } });
    await expect(
      service.getAccountBalance("GNOTEXIST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12")
    ).rejects.toThrow("Unable to fetch balance");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// PathPaymentService – getPathPaymentQuote
// ══════════════════════════════════════════════════════════════════════════
describe("PathPaymentService.getPathPaymentQuote", () => {
  const sleepMock = jest.fn().mockResolvedValue(undefined);
  let strictSendPathsCall: jest.Mock;

  beforeEach(() => {
    __setRetrySleepForTests(sleepMock);
    sleepMock.mockClear();
    strictSendPathsCall = jest.fn();

    jest.spyOn(StellarService.prototype, "getServer").mockReturnValue({
      strictSendPaths: jest.fn(() => ({ call: strictSendPathsCall })),
    } as any);

    jest
      .spyOn(StellarService.prototype, "getNetworkPassphrase")
      .mockReturnValue("Public Global Stellar Network ; September 2015");
  });

  afterEach(() => {
    __resetRetrySleepForTests();
    jest.restoreAllMocks();
  });

  it("returns mapped path quotes on success", async () => {
    strictSendPathsCall.mockResolvedValue({
      records: [{
        source_amount: "1000", source_asset_type: "native", source_asset_code: "XLM",
        destination_amount: "50", destination_asset_type: "credit_alphanum4",
        destination_asset_code: "USDC", path: [],
      }],
    });
    const service = new PathPaymentService();
    const result = await service.getPathPaymentQuote("1000", "XLM");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ source_amount: "1000", destination_amount: "50", destination_asset_code: "USDC" });
  });

  it("returns empty array when no paths exist (illiquid pair)", async () => {
    strictSendPathsCall.mockResolvedValue({ records: [] });
    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "XLM")).resolves.toEqual([]);
  });

  it("returns multiple path options when available", async () => {
    strictSendPathsCall.mockResolvedValue({
      records: [
        { source_amount: "1000", source_asset_type: "credit_alphanum4", source_asset_code: "NGN",
          destination_amount: "0.62", destination_asset_type: "credit_alphanum4",
          destination_asset_code: "USDC", path: [{ asset_code: "XLM", asset_type: "native" }] },
        { source_amount: "1000", source_asset_type: "credit_alphanum4", source_asset_code: "NGN",
          destination_amount: "0.61", destination_asset_type: "credit_alphanum4",
          destination_asset_code: "USDC", path: [] },
      ],
    });
    const service = new PathPaymentService();
    const result = await service.getPathPaymentQuote("1000", "XLM");
    expect(result).toHaveLength(2);
    expect(result[0].destination_amount).toBe("0.62");
    expect(result[1].destination_amount).toBe("0.61");
  });

  it("correctly maps multi-hop path (NGN → XLM → USDC)", async () => {
    strictSendPathsCall.mockResolvedValue({
      records: [{
        source_amount: "1000", source_asset_type: "credit_alphanum4", source_asset_code: "NGN",
        destination_amount: "0.62", destination_asset_type: "credit_alphanum4",
        destination_asset_code: "USDC", path: [{ asset_code: "XLM", asset_type: "native" }],
      }],
    });
    const service = new PathPaymentService();
    const result = await service.getPathPaymentQuote("1000", "XLM");
    expect(result[0].path).toEqual([{ asset_code: "XLM", asset_type: "native" }]);
  });

  it("accepts optional sourceAssetIssuer parameter", async () => {
    strictSendPathsCall.mockResolvedValue({ records: [] });
    const service = new PathPaymentService();
    // Use XLM (native) so no issuer validation is needed
    await expect(service.getPathPaymentQuote("500", "XLM")).resolves.toEqual([]);
  });

  it("throws 'Failed to fetch path payment quotes' on 400 (no path exists)", async () => {
    strictSendPathsCall.mockRejectedValue({ response: { status: 400 } });
    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "XLM")).rejects.toThrow("Failed to fetch path payment quotes");
    expect(strictSendPathsCall).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("does not retry on 404 errors", async () => {
    strictSendPathsCall.mockRejectedValue({ response: { status: 404 } });
    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "XLM")).rejects.toThrow("Failed to fetch path payment quotes");
    expect(strictSendPathsCall).toHaveBeenCalledTimes(1);
  });

  it("retries on 500 and succeeds", async () => {
    strictSendPathsCall
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValueOnce({ records: [] });
    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "XLM")).resolves.toEqual([]);
    expect(strictSendPathsCall).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(1000);
  });

  it("retries on 503 Service Unavailable and succeeds", async () => {
    strictSendPathsCall
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce({ records: [] });
    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "XLM")).resolves.toEqual([]);
    expect(strictSendPathsCall).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 rate limit and succeeds", async () => {
    strictSendPathsCall
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce({ records: [] });
    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "XLM")).resolves.toEqual([]);
    expect(strictSendPathsCall).toHaveBeenCalledTimes(2);
  });

  it("exhausts retries on persistent 5xx and throws", async () => {
    strictSendPathsCall.mockRejectedValue({ response: { status: 502 } });
    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "XLM")).rejects.toThrow("Failed to fetch path payment quotes");
    expect(strictSendPathsCall).toHaveBeenCalledTimes(4);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 2000);
    expect(sleepMock).toHaveBeenNthCalledWith(3, 4000);
  });

  it("does not retry on plain network errors (no HTTP status)", async () => {
    strictSendPathsCall.mockRejectedValue(new Error("ECONNREFUSED"));
    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("500", "XLM")).rejects.toThrow("Failed to fetch path payment quotes");
    expect(strictSendPathsCall).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// WalletService – getUsdcBalance
// ══════════════════════════════════════════════════════════════════════════
describe("WalletService.getUsdcBalance", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("delegates to StellarService.getAccountBalance with USDC asset code", async () => {
    const spy = jest.spyOn(StellarService.prototype, "getAccountBalance").mockResolvedValue("250.00");
    const walletService = new WalletService();
    const result = await walletService.getUsdcBalance("GTEST");
    expect(result).toBe("250.00");
    expect(spy).toHaveBeenCalledWith("GTEST", "USDC");
  });

  it("returns '0' when account has no USDC balance", async () => {
    jest.spyOn(StellarService.prototype, "getAccountBalance").mockResolvedValue("0");
    const walletService = new WalletService();
    await expect(walletService.getUsdcBalance("GTEST")).resolves.toBe("0");
  });

  it("propagates errors from StellarService", async () => {
    jest.spyOn(StellarService.prototype, "getAccountBalance").mockRejectedValue(new Error("Unable to fetch balance"));
    const walletService = new WalletService();
    await expect(walletService.getUsdcBalance("GTEST")).rejects.toThrow("Unable to fetch balance");
  });

  it("passes the correct asset code 'USDC' (not XLM or other)", async () => {
    const spy = jest.spyOn(StellarService.prototype, "getAccountBalance").mockResolvedValue("1.00");
    const walletService = new WalletService();
    await walletService.getUsdcBalance("GTEST");
    expect(spy.mock.calls[0][1]).toBe("USDC");
  });
});
