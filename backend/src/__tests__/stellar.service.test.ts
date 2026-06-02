import { __resetRetrySleepForTests, __setRetrySleepForTests } from "../lib/retry";
import { StellarService } from "../services/stellar.service";
import { StrKey, Account, Operation, Asset, TransactionBuilder } from "@stellar/stellar-sdk";
import { TOKEN_CONFIG } from "../config/token";

jest.mock("../config/stellar", () => ({
  horizonServer: {
    loadAccount: jest.fn(),
  },
  sorobanRpcClient: {
    sendTransaction: jest.fn(),
  },
  networkPassphrase: "Test SDF Network ; September 2015",
}));

describe("StellarService network resilience", () => {
  const sleepMock = jest.fn().mockResolvedValue(undefined);
  const validKey = "TEST_PUBLIC_KEY_FOR_MOCK";
  let loadAccountMock: jest.Mock;

  beforeEach(() => {
    __setRetrySleepForTests(sleepMock);
    const { horizonServer } = require("../config/stellar");
    loadAccountMock = horizonServer.loadAccount;
    loadAccountMock.mockReset();
    jest.spyOn(StrKey, "isValidEd25519PublicKey").mockImplementation((value) => value === validKey);
    sleepMock.mockClear();
  });

  afterEach(() => {
    __resetRetrySleepForTests();
    jest.restoreAllMocks();
  });

  it("returns the asset balance without retries on success", async () => {
    loadAccountMock.mockResolvedValue({
      balances: [{ asset_code: TOKEN_CONFIG.symbol, balance: "25.50" }],
    } as any);

    const service = new StellarService();
    await expect(service.getAccountBalance(validKey)).resolves.toBe("25.50");
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("retries on 500 responses and eventually succeeds", async () => {
    loadAccountMock
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValueOnce({
        balances: [{ asset_code: TOKEN_CONFIG.symbol, balance: "12.34" }],
      } as any);

    const service = new StellarService();
    await expect(service.getAccountBalance(validKey)).resolves.toBe("12.34");
    expect(loadAccountMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(1000);
  });

  it("retries on 429 responses before succeeding", async () => {
    loadAccountMock
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce({
        balances: [{ asset_type: "native", balance: "99.1" }],
      } as any);

    const service = new StellarService();
    await expect(service.getAccountBalance(validKey, "XLM")).resolves.toBe("99.1");
    expect(loadAccountMock).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 2000);
  });

  it("returns zero for account-not-found without bubbling errors", async () => {
    loadAccountMock.mockRejectedValue({ response: { status: 404 } });

    const service = new StellarService();
    await expect(service.getAccountBalance(validKey)).resolves.toBe("0");
    expect(loadAccountMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("fails after the maximum retry budget is exhausted", async () => {
    loadAccountMock.mockRejectedValue({ response: { status: 503 } });

    const service = new StellarService();
    await expect(service.getAccountBalance(validKey)).rejects.toThrow("Unable to fetch balance");
    expect(loadAccountMock).toHaveBeenCalledTimes(4);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 2000);
    expect(sleepMock).toHaveBeenNthCalledWith(3, 4000);
  });

  it("rejects malformed stellar addresses before RPC calls", async () => {
    const service = new StellarService();

    await expect(service.getAccountBalance("not-a-key")).rejects.toThrow(
      "Invalid Stellar public key",
    );
    expect(loadAccountMock).not.toHaveBeenCalled();
  });

  it("returns very large balances unchanged", async () => {
    loadAccountMock.mockResolvedValue({
      balances: [{ asset_code: TOKEN_CONFIG.symbol, balance: "1000000001.25" }],
    } as any);

    const service = new StellarService();
    await expect(service.getAccountBalance(validKey)).resolves.toBe("1000000001.25");
  });

  describe("buildTransaction", () => {
    const sourceAccount = "GDQ6SBYUQQSA2Q7G2NQDAPJ6YVGAX7QW4Q7G2NQDAPJ6YVGAX7QW4Q7";

    it("successfully builds a transaction and returns base64 XDR", async () => {
      const mockAccount = new Account(sourceAccount, "12345");
      loadAccountMock.mockResolvedValue(mockAccount);

      const op = TransactionBuilder.fromXDR(
        "AAAAAgAAAADg23/8uXJb4jHk4615a6oP64t4N7c5a3o2e3NzaWduZXIyAAAAAAAAAADg23/8uXJb4jHk4615a6oP64t4N7c5a3o2e3NzaWduZXIyAAAAAQAAAAAAAAAAAAAAAY637+gAAAAAAAAAAA==",
        "Test SDF Network ; September 2015"
      ).operations[0];

      const service = new StellarService();
      const xdr = await service.buildTransaction(sourceAccount, [op]);

      expect(xdr).toBeDefined();
      expect(typeof xdr).toBe("string");
      expect(loadAccountMock).toHaveBeenCalledWith(sourceAccount);
    });

    it("throws source account not found error on 404 response", async () => {
      loadAccountMock.mockRejectedValue({ response: { status: 404 } });

      const service = new StellarService();
      await expect(
        service.buildTransaction(sourceAccount, []),
      ).rejects.toThrow("Source account does not exist");
    });

    it("throws invalid transaction operations when building fails with operation error", async () => {
      const mockAccount = new Account(sourceAccount, "12345");
      loadAccountMock.mockResolvedValue(mockAccount);

      const service = new StellarService();
      await expect(
        service.buildTransaction(sourceAccount, [{}] as any),
      ).rejects.toThrow("Invalid transaction operations");
    });
  });

  describe("submitTransaction", () => {
    let sendTransactionMock: jest.Mock;
    let signedXdr: string;

    beforeEach(() => {
      const { sorobanRpcClient } = require("../config/stellar");
      sendTransactionMock = sorobanRpcClient.sendTransaction;
      sendTransactionMock.mockReset();

      const mockAccount = new Account("GDQ6SBYUQQSA2Q7G2NQDAPJ6YVGAX7QW4Q7G2NQDAPJ6YVGAX7QW4Q7", "12345");
      const tx = new TransactionBuilder(mockAccount, {
        fee: "100",
        networkPassphrase: "Test SDF Network ; September 2015",
      })
        .addOperation(Operation.payment({
          destination: "GDQ6SBYUQQSA2Q7G2NQDAPJ6YVGAX7QW4Q7G2NQDAPJ6YVGAX7QW4Q7",
          asset: Asset.native(),
          amount: "1",
        }))
        .setTimeout(30)
        .build();
      signedXdr = tx.toXDR();
    });

    it("successfully submits transaction and returns response", async () => {
      sendTransactionMock.mockResolvedValue({
        status: "PENDING",
        hash: "some-hash",
      });

      const service = new StellarService();
      const response = await service.submitTransaction(signedXdr);

      expect(response.status).toBe("PENDING");
      expect(response.hash).toBe("some-hash");
      expect(sendTransactionMock).toHaveBeenCalled();
    });

    it("returns duplicate response without error", async () => {
      sendTransactionMock.mockResolvedValue({
        status: "DUPLICATE",
        hash: "dup-hash",
      });

      const service = new StellarService();
      const response = await service.submitTransaction(signedXdr);

      expect(response.status).toBe("DUPLICATE");
      expect(response.hash).toBe("dup-hash");
    });

    it("throws Node unavailable on TRY_AGAIN_LATER status", async () => {
      sendTransactionMock.mockResolvedValue({
        status: "TRY_AGAIN_LATER",
        hash: "try-hash",
      });

      const service = new StellarService();
      await expect(service.submitTransaction(signedXdr)).rejects.toThrow(
        "RPC Error: Stellar node unavailable (TRY_AGAIN_LATER)"
      );
    });

    it("throws Contract Panic when status is ERROR with errorResult", async () => {
      sendTransactionMock.mockResolvedValue({
        status: "ERROR",
        hash: "err-hash",
        errorResult: "panic error message",
      });

      const service = new StellarService();
      await expect(service.submitTransaction(signedXdr)).rejects.toThrow(
        "Contract Panic: panic error message"
      );
    });

    it("throws general RPC Error when status is ERROR without errorResult", async () => {
      sendTransactionMock.mockResolvedValue({
        status: "ERROR",
        hash: "err-hash",
      });

      const service = new StellarService();
      await expect(service.submitTransaction(signedXdr)).rejects.toThrow(
        "RPC Error: ERROR"
      );
    });

    it("throws timeout error on ETIMEDOUT code or message", async () => {
      const timeoutError = new Error("Connection timeout");
      (timeoutError as any).code = "ETIMEDOUT";
      sendTransactionMock.mockRejectedValue(timeoutError);

      const service = new StellarService();
      await expect(service.submitTransaction(signedXdr)).rejects.toThrow(
        "Transaction submission failed: Stellar RPC timed out — Connection timeout"
      );
    });

    it("throws general error for unexpected submission failures", async () => {
      sendTransactionMock.mockRejectedValue(new Error("unexpected crash"));

      const service = new StellarService();
      await expect(service.submitTransaction(signedXdr)).rejects.toThrow(
        "Transaction submission failed: unexpected crash"
      );
    });
  });
});
