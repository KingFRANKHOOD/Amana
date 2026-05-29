/**
 * metrics.stellar.test.ts
 *
 * Regression coverage for Stellar transaction success/latency metrics — Issue #521.
 */

import {
  __resetMetricsForTests,
  __setMetricsRecorderForTests,
  classifySubmissionError,
  recordRpcCall,
  recordTransactionSubmission,
  StellarMetricsRecorder,
} from "../lib/metrics";
import { StellarService } from "../services/stellar.service";

jest.mock("../config/stellar", () => ({
  horizonServer: { loadAccount: jest.fn() },
  sorobanRpcClient: { sendTransaction: jest.fn() },
  networkPassphrase: "Test SDF Network ; September 2015",
}));

jest.mock("../middleware/logger", () => ({
  appLogger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock("../config/tracing", () => ({
  TracingHelper: {
    withSpan: async (_name: string, fn: (span: { setAttributes: jest.Mock }) => Promise<unknown>) =>
      fn({ setAttributes: jest.fn() }),
    addEvent: jest.fn(),
  },
}));

function makeRecorder(): StellarMetricsRecorder & {
  submissions: Array<{
    operation: string;
    outcome: string;
    durationMs: number;
  }>;
  rpcCalls: Array<{
    rpcMethod: string;
    outcome: string;
    durationMs: number;
  }>;
} {
  const submissions: Array<{
    operation: string;
    outcome: string;
    durationMs: number;
  }> = [];
  const rpcCalls: Array<{
    rpcMethod: string;
    outcome: string;
    durationMs: number;
  }> = [];

  return {
    submissions,
    rpcCalls,
    recordTransactionSubmission(operation, outcome, durationMs) {
      submissions.push({ operation, outcome, durationMs });
    },
    recordRpcCall(rpcMethod, outcome, durationMs) {
      rpcCalls.push({ rpcMethod, outcome, durationMs });
    },
  };
}

function makeSendTxMock(): jest.Mock {
  const { sorobanRpcClient } = require("../config/stellar");
  return sorobanRpcClient.sendTransaction as jest.Mock;
}

describe("Stellar metrics (#521)", () => {
  let recorder: ReturnType<typeof makeRecorder>;

  beforeEach(() => {
    recorder = makeRecorder();
    __setMetricsRecorderForTests(recorder);
  });

  afterEach(() => {
    __resetMetricsForTests();
    jest.restoreAllMocks();
  });

  describe("classifySubmissionError", () => {
    it("maps known error messages to outcome labels", () => {
      expect(classifySubmissionError(new Error("Invalid transaction XDR: bad"))).toBe(
        "xdr_invalid",
      );
      expect(classifySubmissionError(new Error("Contract Panic: locked"))).toBe(
        "contract_panic",
      );
      expect(classifySubmissionError(new Error("RPC Error: ERROR"))).toBe("rpc_error");
      expect(classifySubmissionError(new Error("ECONNREFUSED"))).toBe("network_error");
    });
  });

  describe("recordTransactionSubmission", () => {
    it("forwards submission events to the test recorder", () => {
      recordTransactionSubmission("submit_transaction", "success", 42);

      expect(recorder.submissions).toEqual([
        { operation: "submit_transaction", outcome: "success", durationMs: 42 },
      ]);
    });
  });

  describe("recordRpcCall", () => {
    it("forwards RPC latency events to the test recorder", () => {
      recordRpcCall("simulateTransaction", "success", 15);

      expect(recorder.rpcCalls).toEqual([
        { rpcMethod: "simulateTransaction", outcome: "success", durationMs: 15 },
      ]);
    });
  });

  describe("StellarService.submitTransaction", () => {
    let sendTxMock: jest.Mock;

    beforeEach(() => {
      sendTxMock = makeSendTxMock();
      sendTxMock.mockReset();
    });

    it("records success metrics when RPC accepts the transaction", async () => {
      const { TransactionBuilder } = require("@stellar/stellar-sdk");
      jest
        .spyOn(TransactionBuilder, "fromXDR")
        .mockReturnValue({ toEnvelope: jest.fn() } as any);
      sendTxMock.mockResolvedValue({ status: "PENDING", hash: "abc123" });

      const service = new StellarService();
      await service.submitTransaction("MOCKED_XDR");

      expect(recorder.submissions).toEqual([
        expect.objectContaining({
          operation: "submit_transaction",
          outcome: "success",
        }),
      ]);
      expect(recorder.submissions[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it("records contract_panic metrics when the contract reverts", async () => {
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
        /contract panic/i,
      );

      expect(recorder.submissions).toEqual([
        expect.objectContaining({
          operation: "submit_transaction",
          outcome: "contract_panic",
        }),
      ]);
    });

    it("records rpc_error metrics when Soroban RPC returns an infrastructure error", async () => {
      const { TransactionBuilder } = require("@stellar/stellar-sdk");
      jest
        .spyOn(TransactionBuilder, "fromXDR")
        .mockReturnValue({ toEnvelope: jest.fn() } as any);
      sendTxMock.mockResolvedValue({ status: "ERROR", hash: "deadbeef" });

      const service = new StellarService();
      await expect(service.submitTransaction("MOCKED_XDR")).rejects.toThrow(
        /rpc error/i,
      );

      expect(recorder.submissions).toEqual([
        expect.objectContaining({
          operation: "submit_transaction",
          outcome: "rpc_error",
        }),
      ]);
    });

    it("records xdr_invalid metrics without calling Soroban RPC", async () => {
      const service = new StellarService();

      await expect(service.submitTransaction("not-valid-xdr-at-all")).rejects.toThrow(
        /invalid transaction xdr|xdr|parse/i,
      );

      expect(sendTxMock).not.toHaveBeenCalled();
      expect(recorder.submissions).toEqual([
        expect.objectContaining({
          operation: "submit_transaction",
          outcome: "xdr_invalid",
        }),
      ]);
    });

    it("records network_error metrics when the RPC call fails", async () => {
      const { TransactionBuilder } = require("@stellar/stellar-sdk");
      jest
        .spyOn(TransactionBuilder, "fromXDR")
        .mockReturnValue({ toEnvelope: jest.fn() } as any);
      sendTxMock.mockRejectedValue(new Error("ECONNREFUSED"));

      const service = new StellarService();
      await expect(service.submitTransaction("MOCKED_XDR")).rejects.toThrow(
        /transaction submission failed/i,
      );

      expect(recorder.submissions).toEqual([
        expect.objectContaining({
          operation: "submit_transaction",
          outcome: "network_error",
        }),
      ]);
    });
  });

  describe("StellarService.buildTransaction", () => {
    it("records success metrics when Horizon returns the source account", async () => {
      const { horizonServer } = require("../config/stellar");
      const { TransactionBuilder } = require("@stellar/stellar-sdk");
      (horizonServer.loadAccount as jest.Mock).mockResolvedValue({
        accountId: () =>
          "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        sequenceNumber: () => "1",
      });
      jest.spyOn(TransactionBuilder.prototype, "addOperation").mockReturnThis();
      jest.spyOn(TransactionBuilder.prototype, "setTimeout").mockReturnThis();
      jest
        .spyOn(TransactionBuilder.prototype, "build")
        .mockReturnValue({ toXDR: () => "MOCK_XDR" } as any);

      const service = new StellarService();
      const xdr = await service.buildTransaction(
        "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        [],
      );

      expect(xdr).toBe("MOCK_XDR");
      expect(recorder.submissions).toEqual([
        expect.objectContaining({
          operation: "build_transaction",
          outcome: "success",
        }),
      ]);
    });

    it("records network_error metrics when Horizon is unreachable", async () => {
      const { horizonServer } = require("../config/stellar");
      (horizonServer.loadAccount as jest.Mock).mockRejectedValue(
        new Error("ECONNREFUSED"),
      );

      const service = new StellarService();
      await expect(
        service.buildTransaction("GABC1234VALIDSTELLARKEY000000000000000000000000000000", []),
      ).rejects.toThrow();

      expect(recorder.submissions).toEqual([
        expect.objectContaining({
          operation: "build_transaction",
          outcome: "network_error",
        }),
      ]);
    });
  });
});
