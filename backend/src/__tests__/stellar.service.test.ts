import { __resetRetrySleepForTests, __setRetrySleepForTests } from "../lib/retry";
import { StellarService } from "../services/stellar.service";

describe("StellarService network resilience", () => {
  let service: StellarService;
  const sleepMock = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    __setRetrySleepForTests(sleepMock);
    service = new StellarService();
    sleepMock.mockClear();
  });

  afterEach(() => {
    __resetRetrySleepForTests();
    jest.restoreAllMocks();
  });

  it("returns the asset balance without retries on success", async () => {
    jest.spyOn(service.getServer(), "loadAccount").mockResolvedValue({
      balances: [{ asset_code: "USDC", balance: "25.50" }],
    } as any);

    await expect(service.getAccountBalance("GTEST")).resolves.toBe("25.50");
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("retries on 500 responses and eventually succeeds", async () => {
    const loadAccount = jest
      .spyOn(service.getServer(), "loadAccount")
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValueOnce({
        balances: [{ asset_code: "USDC", balance: "12.34" }],
      } as any);

    await expect(service.getAccountBalance("GTEST")).resolves.toBe("12.34");
    expect(loadAccount).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(1000);
  });

  it("retries on 429 responses before succeeding", async () => {
    const loadAccount = jest
      .spyOn(service.getServer(), "loadAccount")
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce({
        balances: [{ asset_type: "native", balance: "99.1" }],
      } as any);

    await expect(service.getAccountBalance("GTEST", "XLM")).resolves.toBe("99.1");
    expect(loadAccount).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 2000);
  });

  it("does not retry 404 responses", async () => {
    const loadAccount = jest
      .spyOn(service.getServer(), "loadAccount")
      .mockRejectedValue({ response: { status: 404 } });

    await expect(service.getAccountBalance("GTEST")).rejects.toThrow("Unable to fetch balance");
    expect(loadAccount).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("fails after the maximum retry budget is exhausted", async () => {
    const loadAccount = jest
      .spyOn(service.getServer(), "loadAccount")
      .mockRejectedValue({ response: { status: 503 } });

    await expect(service.getAccountBalance("GTEST")).rejects.toThrow("Unable to fetch balance");
    expect(loadAccount).toHaveBeenCalledTimes(4);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 2000);
    expect(sleepMock).toHaveBeenNthCalledWith(3, 4000);
  });
});
