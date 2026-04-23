import { __resetRetrySleepForTests, __setRetrySleepForTests } from "../lib/retry";
import { StellarService } from "../services/stellar.service";
import { PathPaymentService } from "../services/pathPayment.service";

describe("PathPaymentService network resilience", () => {
  const sleepMock = jest.fn().mockResolvedValue(undefined);
  let strictSendPathsCall: jest.Mock;

  beforeEach(() => {
    __setRetrySleepForTests(sleepMock);
    strictSendPathsCall = jest.fn();

    jest.spyOn(StellarService.prototype, "getServer").mockReturnValue({
      strictSendPaths: jest.fn(() => ({
        call: strictSendPathsCall,
      })),
    } as any);

    jest
      .spyOn(StellarService.prototype, "getNetworkPassphrase")
      .mockReturnValue("Public Global Stellar Network ; September 2015");
  });

  afterEach(() => {
    __resetRetrySleepForTests();
    jest.restoreAllMocks();
    sleepMock.mockClear();
  });

  it("returns mapped path quotes on the first attempt", async () => {
    strictSendPathsCall.mockResolvedValue({
      records: [
        {
          source_amount: "1000",
          source_asset_type: "native",
          source_asset_code: "XLM",
          destination_amount: "50",
          destination_asset_type: "credit_alphanum4",
          destination_asset_code: "USDC",
          path: [],
        },
      ],
    });

    const service = new PathPaymentService();
    const result = await service.getPathPaymentQuote("1000", "XLM");

    expect(result).toEqual([
      expect.objectContaining({
        source_amount: "1000",
        destination_amount: "50",
        destination_asset_code: "USDC",
      }),
    ]);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("retries on 500 errors and succeeds", async () => {
    strictSendPathsCall
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValueOnce({ records: [] });

    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "NGN")).resolves.toEqual([]);
    expect(strictSendPathsCall).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(1000);
  });

  it("retries on 429 rate limits and succeeds", async () => {
    strictSendPathsCall
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce({ records: [] });

    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "NGN")).resolves.toEqual([]);
    expect(strictSendPathsCall).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 2000);
  });

  it("does not retry 400 errors", async () => {
    strictSendPathsCall.mockRejectedValue({ response: { status: 400 } });

    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "NGN")).rejects.toThrow(
      "Failed to fetch path payment quotes",
    );
    expect(strictSendPathsCall).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("fails after exhausting retries on repeated 5xx errors", async () => {
    strictSendPathsCall.mockRejectedValue({ response: { status: 502 } });

    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "NGN")).rejects.toThrow(
      "Failed to fetch path payment quotes",
    );
    expect(strictSendPathsCall).toHaveBeenCalledTimes(4);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 2000);
    expect(sleepMock).toHaveBeenNthCalledWith(3, 4000);
  });
});
