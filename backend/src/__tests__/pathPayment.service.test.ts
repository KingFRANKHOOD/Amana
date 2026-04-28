import { __resetRetrySleepForTests, __setRetrySleepForTests } from "../lib/retry";
import * as StellarSdk from "@stellar/stellar-sdk";
import { StellarService } from "../services/stellar.service";
import { PathPaymentService } from "../services/pathPayment.service";

describe("PathPaymentService network resilience", () => {
  const sleepMock = jest.fn().mockResolvedValue(undefined);
  let strictSendPathsCall: jest.Mock;
  let strictSendPathsMock: jest.Mock;

  beforeEach(() => {
    __setRetrySleepForTests(sleepMock);
    strictSendPathsCall = jest.fn();
    strictSendPathsMock = jest.fn(() => ({
      call: strictSendPathsCall,
    }));

    jest.spyOn(StellarService.prototype, "getServer").mockReturnValue({
      strictSendPaths: strictSendPathsMock,
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

  it("keeps multi-hop path metadata in mapped quote responses", async () => {
    strictSendPathsCall.mockResolvedValue({
      records: [
        {
          source_amount: "1000",
          source_asset_type: "credit_alphanum4",
          source_asset_code: "NGN",
          destination_amount: "0.62",
          destination_asset_type: "credit_alphanum4",
          destination_asset_code: "USDC",
          path: [{ asset_code: "XLM", asset_type: "native" }],
        },
      ],
    });

    const service = new PathPaymentService();
    const [quote] = await service.getPathPaymentQuote("1000", "XLM");

    expect(quote.path).toEqual([{ asset_code: "XLM", asset_type: "native" }]);
    expect(quote.destination_asset_code).toBe("USDC");
  });

  it("returns an empty list when no path exists", async () => {
    strictSendPathsCall.mockResolvedValue({ records: [] });

    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "XLM")).resolves.toEqual([]);
  });

  it("retries on 500 errors and succeeds", async () => {
    strictSendPathsCall
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValueOnce({ records: [] });

    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "XLM")).resolves.toEqual([]);
    expect(strictSendPathsCall).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(1000);
  });

  it("retries on 429 rate limits and succeeds", async () => {
    strictSendPathsCall
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce({ records: [] });

    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "XLM")).resolves.toEqual([]);
    expect(strictSendPathsCall).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 2000);
  });

  it("retries timeout-like 504 responses and then succeeds", async () => {
    strictSendPathsCall
      .mockRejectedValueOnce({ response: { status: 504 } })
      .mockResolvedValueOnce({ records: [] });

    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "XLM")).resolves.toEqual([]);
    expect(strictSendPathsCall).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(1000);
  });

  it("does not retry 400 errors", async () => {
    strictSendPathsCall.mockRejectedValue({ response: { status: 400 } });

    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "XLM")).rejects.toThrow(
      "Failed to fetch path payment quotes",
    );
    expect(strictSendPathsCall).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("stops retrying when a terminal non-retryable error is encountered", async () => {
    strictSendPathsCall
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockRejectedValueOnce({ response: { status: 400 } });

    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "XLM")).rejects.toThrow(
      "Failed to fetch path payment quotes",
    );
    expect(strictSendPathsCall).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 2000);
  });

  it("bubbles timeout-like network failures after retries", async () => {
    strictSendPathsCall.mockRejectedValue(new Error("connect ETIMEDOUT"));

    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "XLM")).rejects.toThrow(
      "Failed to fetch path payment quotes",
    );
  });

  it("fails clearly on malformed upstream responses", async () => {
    strictSendPathsCall.mockResolvedValue({} as any);

    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "XLM")).rejects.toThrow(
      "Failed to fetch path payment quotes",
    );
  });

  it("uses caller-provided issuer for non-native source assets", async () => {
    strictSendPathsCall.mockResolvedValue({ records: [] });
    const issuer = StellarSdk.Keypair.random().publicKey();

    const service = new PathPaymentService();
    await service.getPathPaymentQuote("50", "NGN", issuer);

    const sourceAsset = strictSendPathsMock.mock.calls[0][0] as StellarSdk.Asset;
    expect(sourceAsset.getCode()).toBe("NGN");
    expect(sourceAsset.getIssuer()).toBe(issuer);
  });

  it("fails after exhausting retries on repeated 5xx errors", async () => {
    strictSendPathsCall.mockRejectedValue({ response: { status: 502 } });

    const service = new PathPaymentService();
    await expect(service.getPathPaymentQuote("1000", "XLM")).rejects.toThrow(
      "Failed to fetch path payment quotes",
    );
    expect(strictSendPathsCall).toHaveBeenCalledTimes(4);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 2000);
    expect(sleepMock).toHaveBeenNthCalledWith(3, 4000);
  });
});
