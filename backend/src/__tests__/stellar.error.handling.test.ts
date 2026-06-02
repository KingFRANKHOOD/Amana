/**
 * stellar.error.handling.test.ts — Issue #581
 *
 * Covers error classification and surfacing for Stellar network failures:
 * - DUPLICATE and TRY_AGAIN_LATER RPC statuses
 * - Timeout / deadline-exceeded errors
 * - Connection-refused and generic network failures
 * - Error message deduplication (no double-wrapping)
 */

import { __resetRetrySleepForTests, __setRetrySleepForTests } from "../lib/retry";
import { StellarService } from "../services/stellar.service";
import { StrKey } from "@stellar/stellar-sdk";

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

function sendTxMock(): jest.Mock {
  const { sorobanRpcClient } = require("../config/stellar");
  return sorobanRpcClient.sendTransaction as jest.Mock;
}

function mockXdrParser() {
  const { TransactionBuilder } = require("@stellar/stellar-sdk");
  jest.spyOn(TransactionBuilder, "fromXDR").mockReturnValue({ toEnvelope: jest.fn() } as any);
}

// ── DUPLICATE status ──────────────────────────────────────────────────────────

describe("StellarService.submitTransaction — DUPLICATE status (#581)", () => {
  const sleepMock = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    __setRetrySleepForTests(sleepMock);
    sendTxMock().mockReset();
    jest.spyOn(StrKey, "isValidEd25519PublicKey").mockReturnValue(true);
    mockXdrParser();
  });

  afterEach(() => {
    __resetRetrySleepForTests();
    jest.restoreAllMocks();
  });

  it("returns the response when Stellar reports DUPLICATE (already submitted)", async () => {
    sendTxMock().mockResolvedValue({ status: "DUPLICATE", hash: "dup-hash-abc" });

    const service = new StellarService();
    const result = await service.submitTransaction("MOCKED_XDR");

    expect(result.status).toBe("DUPLICATE");
    expect(result.hash).toBe("dup-hash-abc");
  });

  it("does not throw when status is DUPLICATE", async () => {
    sendTxMock().mockResolvedValue({ status: "DUPLICATE", hash: "dup123" });

    const service = new StellarService();
    await expect(service.submitTransaction("MOCKED_XDR")).resolves.toBeDefined();
  });

  it("logs a warning (not an error) for DUPLICATE submissions", async () => {
    const { appLogger } = require("../middleware/logger");
    sendTxMock().mockResolvedValue({ status: "DUPLICATE", hash: "dup123" });

    const service = new StellarService();
    await service.submitTransaction("MOCKED_XDR");

    expect(appLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ hash: "dup123" }),
      expect.stringContaining("DUPLICATE"),
    );
    expect(appLogger.error).not.toHaveBeenCalled();
  });
});

// ── TRY_AGAIN_LATER status ────────────────────────────────────────────────────

describe("StellarService.submitTransaction — TRY_AGAIN_LATER status (#581)", () => {
  beforeEach(() => {
    sendTxMock().mockReset();
    mockXdrParser();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("throws an RPC error when Stellar node responds with TRY_AGAIN_LATER", async () => {
    sendTxMock().mockResolvedValue({ status: "TRY_AGAIN_LATER", hash: undefined });

    const service = new StellarService();
    await expect(service.submitTransaction("MOCKED_XDR")).rejects.toThrow(
      /rpc error.*try_again_later|stellar node unavailable/i,
    );
  });

  it("error message for TRY_AGAIN_LATER is not double-wrapped", async () => {
    sendTxMock().mockResolvedValue({ status: "TRY_AGAIN_LATER" });

    const service = new StellarService();
    const err = await service.submitTransaction("MOCKED_XDR").catch((e) => e);
    expect(err.message).not.toMatch(/transaction submission failed/i);
    expect(err.message).toMatch(/rpc error/i);
  });
});

// ── Timeout errors ────────────────────────────────────────────────────────────

describe("StellarService.submitTransaction — timeout errors (#581)", () => {
  beforeEach(() => {
    sendTxMock().mockReset();
    mockXdrParser();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports a timeout-specific message when the error message contains 'timeout'", async () => {
    sendTxMock().mockRejectedValue(new Error("Request timeout after 30000ms"));

    const service = new StellarService();
    const err = await service.submitTransaction("MOCKED_XDR").catch((e) => e);
    expect(err.message).toMatch(/timed out/i);
  });

  it("reports a timeout-specific message for 'timed out' phrasing", async () => {
    sendTxMock().mockRejectedValue(new Error("connection timed out"));

    const service = new StellarService();
    const err = await service.submitTransaction("MOCKED_XDR").catch((e) => e);
    expect(err.message).toMatch(/timed out/i);
  });

  it("reports a timeout-specific message when error code is ETIMEDOUT", async () => {
    const timeoutErr: any = new Error("ETIMEDOUT");
    timeoutErr.code = "ETIMEDOUT";
    sendTxMock().mockRejectedValue(timeoutErr);

    const service = new StellarService();
    const err = await service.submitTransaction("MOCKED_XDR").catch((e) => e);
    expect(err.message).toMatch(/timed out/i);
  });

  it("reports a timeout-specific message when error code is ECONNABORTED", async () => {
    const abortErr: any = new Error("socket hang up");
    abortErr.code = "ECONNABORTED";
    sendTxMock().mockRejectedValue(abortErr);

    const service = new StellarService();
    const err = await service.submitTransaction("MOCKED_XDR").catch((e) => e);
    expect(err.message).toMatch(/timed out/i);
  });

  it("logs the timeout error at error level with provider context", async () => {
    const { appLogger } = require("../middleware/logger");
    sendTxMock().mockRejectedValue(new Error("deadline exceeded after 10s"));

    const service = new StellarService();
    await service.submitTransaction("MOCKED_XDR").catch(() => {});

    expect(appLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "stellar" }),
      expect.stringContaining("timed out"),
    );
  });
});

// ── Generic network errors ────────────────────────────────────────────────────

describe("StellarService.submitTransaction — generic network errors (#581)", () => {
  beforeEach(() => {
    sendTxMock().mockReset();
    mockXdrParser();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("wraps ECONNREFUSED with 'Transaction submission failed' prefix", async () => {
    sendTxMock().mockRejectedValue(new Error("ECONNREFUSED"));

    const service = new StellarService();
    const err = await service.submitTransaction("MOCKED_XDR").catch((e) => e);
    expect(err.message).toMatch(/transaction submission failed/i);
  });

  it("does not double-wrap Contract Panic errors from the network", async () => {
    sendTxMock().mockRejectedValue(new Error("Contract Panic: escrow_locked"));

    const service = new StellarService();
    const err = await service.submitTransaction("MOCKED_XDR").catch((e) => e);
    expect(err.message).toBe("Contract Panic: escrow_locked");
  });

  it("does not double-wrap RPC Error messages from the network", async () => {
    sendTxMock().mockRejectedValue(new Error("RPC Error: 503"));

    const service = new StellarService();
    const err = await service.submitTransaction("MOCKED_XDR").catch((e) => e);
    expect(err.message).toBe("RPC Error: 503");
  });
});

// ── buildTransaction — timeout on Horizon ────────────────────────────────────

describe("StellarService.buildTransaction — Horizon timeout (#581)", () => {
  function horizonMock(): jest.Mock {
    const { horizonServer } = require("../config/stellar");
    return horizonServer.loadAccount as jest.Mock;
  }

  beforeEach(() => {
    horizonMock().mockReset();
    jest.spyOn(StrKey, "isValidEd25519PublicKey").mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("throws a descriptive error when Horizon times out", async () => {
    horizonMock().mockRejectedValue(new Error("network timeout after 30s"));

    const service = new StellarService();
    await expect(service.buildTransaction("VALID_KEY", [])).rejects.toThrow(
      /failed to build transaction/i,
    );
  });
});

// ── getAccountBalance — error surfacing ───────────────────────────────────────

describe("StellarService.getAccountBalance — error surfacing (#581)", () => {
  const sleepMock = jest.fn().mockResolvedValue(undefined);

  function horizonMock(): jest.Mock {
    const { horizonServer } = require("../config/stellar");
    return horizonServer.loadAccount as jest.Mock;
  }

  beforeEach(() => {
    __setRetrySleepForTests(sleepMock);
    horizonMock().mockReset();
    sleepMock.mockClear();
    jest.spyOn(StrKey, "isValidEd25519PublicKey").mockReturnValue(true);
  });

  afterEach(() => {
    __resetRetrySleepForTests();
    jest.restoreAllMocks();
  });

  it("throws 'Unable to fetch balance' for non-404 failures after exhausting retries", async () => {
    horizonMock().mockRejectedValue(new Error("network error"));

    const service = new StellarService();
    await expect(service.getAccountBalance("VALID_KEY")).rejects.toThrow(
      "Unable to fetch balance",
    );
  });

  it("throws 'Invalid Stellar public key' before any network call for bad keys", async () => {
    jest.spyOn(StrKey, "isValidEd25519PublicKey").mockReturnValue(false);

    const service = new StellarService();
    await expect(service.getAccountBalance("bad-key")).rejects.toThrow(
      "Invalid Stellar public key",
    );
    expect(horizonMock()).not.toHaveBeenCalled();
  });
});
