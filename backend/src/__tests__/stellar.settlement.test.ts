/**
 * stellar.settlement.test.ts
 *
 * Expands StellarService coverage for settlement submission, confirmation
 * polling, and recovery behaviour — Issue #414.
 *
 * Covers:
 *  - Submission success and failure paths
 *  - RPC vs contract-panic error differentiation
 *  - Malformed / invalid XDR handling
 *  - Malformed network responses (missing fields, unexpected status codes)
 *  - Dependency outages (Horizon down, Soroban RPC unreachable)
 */

import { __resetRetrySleepForTests, __setRetrySleepForTests } from "../lib/retry";
import { StellarService } from "../services/stellar.service";
import { StrKey } from "@stellar/stellar-sdk";
import { TOKEN_CONFIG } from "../config/token";

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock("../config/stellar", () => ({
  horizonServer: { loadAccount: jest.fn() },
  sorobanRpcClient: { sendTransaction: jest.fn() },
  networkPassphrase: "Test SDF Network ; September 2015",
}));

jest.mock("../middleware/logger", () => ({
  appLogger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSorobanMock() {
  const { sorobanRpcClient } = require("../config/stellar");
  return sorobanRpcClient.sendTransaction as jest.Mock;
}

function makeHorizonMock() {
  const { horizonServer } = require("../config/stellar");
  return horizonServer.loadAccount as jest.Mock;
}

/** Builds a minimal valid signed XDR string using the real SDK so the parser
 *  accepts it. Falls back to a known-invalid string for negative tests. */
const VALID_KEY = "GABC1234VALIDSTELLARKEY000000000000000000000000000000";
const INVALID_XDR = "not-valid-xdr-at-all";

// ── submitTransaction — success path ─────────────────────────────────────────

describe("StellarService.submitTransaction — success path (#414)", () => {
  let sendTxMock: jest.Mock;
  const sleepMock = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    __setRetrySleepForTests(sleepMock);
    sendTxMock = makeSorobanMock();
    sendTxMock.mockReset();
    sleepMock.mockClear();
    jest.spyOn(StrKey, "isValidEd25519PublicKey").mockReturnValue(true);
  });

  afterEach(() => {
    __resetRetrySleepForTests();
    jest.restoreAllMocks();
  });

  it("throws on invalid XDR before hitting the RPC", async () => {
    const service = new StellarService();
    await expect(service.submitTransaction(INVALID_XDR)).rejects.toThrow(
      /invalid transaction xdr|xdr|parse/i
    );
    expect(sendTxMock).not.toHaveBeenCalled();
  });

  it("returns the response when RPC status is PENDING", async () => {
    // We cannot build a fully valid XDR without a real account — mock the
    // XDR parser at the SDK level instead.
    const { TransactionBuilder } = require("@stellar/stellar-sdk");
    const mockTx = { toEnvelope: jest.fn() };
    jest
      .spyOn(TransactionBuilder, "fromXDR")
      .mockReturnValue(mockTx as any);

    sendTxMock.mockResolvedValue({ status: "PENDING", hash: "abc123" });

    const service = new StellarService();
    const result = await service.submitTransaction("MOCKED_XDR");
    expect(result.hash).toBe("abc123");
    expect(result.status).toBe("PENDING");
  });

  it("throws a Contract Panic error when status is ERROR with errorResult", async () => {
    const { TransactionBuilder } = require("@stellar/stellar-sdk");
    jest
      .spyOn(TransactionBuilder, "fromXDR")
      .mockReturnValue({ toEnvelope: jest.fn() } as any);

    sendTxMock.mockResolvedValue({
      status: "ERROR",
      hash: "deadbeef",
      errorResult: "insufficient_funds",
    });

    const service = new StellarService();
    await expect(service.submitTransaction("MOCKED_XDR")).rejects.toThrow(
      /contract panic/i
    );
  });

  it("throws an RPC Error when status is ERROR without errorResult", async () => {
    const { TransactionBuilder } = require("@stellar/stellar-sdk");
    jest
      .spyOn(TransactionBuilder, "fromXDR")
      .mockReturnValue({ toEnvelope: jest.fn() } as any);

    sendTxMock.mockResolvedValue({
      status: "ERROR",
      hash: "deadbeef",
    });

    const service = new StellarService();
    await expect(service.submitTransaction("MOCKED_XDR")).rejects.toThrow(
      /rpc error/i
    );
  });
});

// ── submitTransaction — network failure paths ─────────────────────────────────

describe("StellarService.submitTransaction — network failure paths (#414)", () => {
  let sendTxMock: jest.Mock;
  const sleepMock = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    __setRetrySleepForTests(sleepMock);
    sendTxMock = makeSorobanMock();
    sendTxMock.mockReset();
    sleepMock.mockClear();
  });

  afterEach(() => {
    __resetRetrySleepForTests();
    jest.restoreAllMocks();
  });

  it("wraps network-level errors with a descriptive message", async () => {
    const { TransactionBuilder } = require("@stellar/stellar-sdk");
    jest
      .spyOn(TransactionBuilder, "fromXDR")
      .mockReturnValue({ toEnvelope: jest.fn() } as any);

    sendTxMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const service = new StellarService();
    await expect(service.submitTransaction("MOCKED_XDR")).rejects.toThrow(
      /transaction submission failed/i
    );
  });

  it("treats a timeout as a submission failure and wraps the error", async () => {
    const { TransactionBuilder } = require("@stellar/stellar-sdk");
    jest
      .spyOn(TransactionBuilder, "fromXDR")
      .mockReturnValue({ toEnvelope: jest.fn() } as any);

    sendTxMock.mockRejectedValue(new Error("Request timeout after 30000ms"));

    const service = new StellarService();
    await expect(service.submitTransaction("MOCKED_XDR")).rejects.toThrow(
      /transaction submission failed/i
    );
  });

  it("propagates Contract Panic messages without double-wrapping", async () => {
    const { TransactionBuilder } = require("@stellar/stellar-sdk");
    jest
      .spyOn(TransactionBuilder, "fromXDR")
      .mockReturnValue({ toEnvelope: jest.fn() } as any);

    sendTxMock.mockRejectedValue(new Error("Contract Panic: escrow_locked"));

    const service = new StellarService();
    const err = await service.submitTransaction("MOCKED_XDR").catch((e) => e);
    // Should not be double-wrapped as "Transaction submission failed: Contract Panic: ..."
    expect(err.message).toBe("Contract Panic: escrow_locked");
  });

  it("propagates RPC Error messages without double-wrapping", async () => {
    const { TransactionBuilder } = require("@stellar/stellar-sdk");
    jest
      .spyOn(TransactionBuilder, "fromXDR")
      .mockReturnValue({ toEnvelope: jest.fn() } as any);

    sendTxMock.mockRejectedValue(new Error("RPC Error: 503"));

    const service = new StellarService();
    const err = await service.submitTransaction("MOCKED_XDR").catch((e) => e);
    expect(err.message).toBe("RPC Error: 503");
  });
});

// ── submitTransaction — malformed responses ───────────────────────────────────

describe("StellarService.submitTransaction — malformed network responses (#414)", () => {
  let sendTxMock: jest.Mock;

  beforeEach(() => {
    sendTxMock = makeSorobanMock();
    sendTxMock.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("throws on a completely empty response object", async () => {
    const { TransactionBuilder } = require("@stellar/stellar-sdk");
    jest
      .spyOn(TransactionBuilder, "fromXDR")
      .mockReturnValue({ toEnvelope: jest.fn() } as any);

    // Empty response — status field missing
    sendTxMock.mockResolvedValue({});

    const service = new StellarService();
    // Should not crash with an unhandled TypeError; must throw a formatted error
    await expect(service.submitTransaction("MOCKED_XDR")).rejects.toThrow();
  });

  it("handles a null response gracefully", async () => {
    const { TransactionBuilder } = require("@stellar/stellar-sdk");
    jest
      .spyOn(TransactionBuilder, "fromXDR")
      .mockReturnValue({ toEnvelope: jest.fn() } as any);

    sendTxMock.mockResolvedValue(null);

    const service = new StellarService();
    await expect(service.submitTransaction("MOCKED_XDR")).rejects.toThrow();
  });
});

// ── buildTransaction — Horizon outage ────────────────────────────────────────

describe("StellarService.buildTransaction — Horizon outage (#414)", () => {
  let loadAccountMock: jest.Mock;

  beforeEach(() => {
    loadAccountMock = makeHorizonMock();
    loadAccountMock.mockReset();
    jest.spyOn(StrKey, "isValidEd25519PublicKey").mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("throws a descriptive error when Horizon returns 404 for the source account", async () => {
    loadAccountMock.mockRejectedValue({ response: { status: 404 } });

    const service = new StellarService();
    await expect(
      service.buildTransaction(VALID_KEY, [])
    ).rejects.toThrow(/source account does not exist/i);
  });

  it("throws a descriptive error when Horizon is completely unreachable", async () => {
    loadAccountMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const service = new StellarService();
    await expect(
      service.buildTransaction(VALID_KEY, [])
    ).rejects.toThrow();
  });
});

// ── getAccountBalance — recovery / resilience ─────────────────────────────────

describe("StellarService.getAccountBalance — recovery coverage (#414)", () => {
  let loadAccountMock: jest.Mock;
  const sleepMock = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    __setRetrySleepForTests(sleepMock);
    loadAccountMock = makeHorizonMock();
    loadAccountMock.mockReset();
    sleepMock.mockClear();
    jest.spyOn(StrKey, "isValidEd25519PublicKey").mockReturnValue(true);
  });

  afterEach(() => {
    __resetRetrySleepForTests();
    jest.restoreAllMocks();
  });

  it("recovers after a transient 503 and returns the correct balance", async () => {
    loadAccountMock
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce({
        balances: [{ asset_code: TOKEN_CONFIG.symbol, balance: "42.00" }],
      } as any);

    const service = new StellarService();
    const balance = await service.getAccountBalance(VALID_KEY);
    expect(balance).toBe("42.00");
    expect(loadAccountMock).toHaveBeenCalledTimes(3);
  });

  it("returns '0' and does not retry when the account does not exist (404)", async () => {
    loadAccountMock.mockRejectedValue({ response: { status: 404 } });

    const service = new StellarService();
    const balance = await service.getAccountBalance(VALID_KEY);
    expect(balance).toBe("0");
    expect(loadAccountMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("returns the native XLM balance when assetCode is 'XLM'", async () => {
    loadAccountMock.mockResolvedValue({
      balances: [{ asset_type: "native", balance: "500.00" }],
    } as any);

    const service = new StellarService();
    const balance = await service.getAccountBalance(VALID_KEY, "XLM");
    expect(balance).toBe("500.00");
  });

  it("returns '0' when the account has no balance for the requested asset", async () => {
    loadAccountMock.mockResolvedValue({
      balances: [{ asset_code: "USDC", balance: "10.00" }],
    } as any);

    const service = new StellarService();
    const balance = await service.getAccountBalance(VALID_KEY, TOKEN_CONFIG.symbol);
    expect(balance).toBe("0");
  });

  it("throws 'Unable to fetch balance' after exhausting all retries during outage", async () => {
    loadAccountMock.mockRejectedValue(new Error("Network unreachable"));

    const service = new StellarService();
    await expect(service.getAccountBalance(VALID_KEY)).rejects.toThrow(
      "Unable to fetch balance"
    );
  });
});
