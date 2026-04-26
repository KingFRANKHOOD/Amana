import { __resetRetrySleepForTests, __setRetrySleepForTests } from "../lib/retry";
import { StellarService } from "../services/stellar.service";
import { StrKey } from "@stellar/stellar-sdk";
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
});
