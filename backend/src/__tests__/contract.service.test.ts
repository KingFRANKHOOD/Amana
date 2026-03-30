import { Account, Networks, rpc } from "@stellar/stellar-sdk";
import { __resetRetrySleepForTests, __setRetrySleepForTests } from "../lib/retry";
import {
  __resetRpcServerFactoryForTests,
  __setRpcServerFactoryForTests,
  ContractService,
} from "../services/contract.service";

describe("ContractService network resilience", () => {
  const buyerAddress = "GCKFBEIYTKP6ZCFWXHA5QB4MX2CSHKQJBM3NP5M4A4V4UMZQZK3Q4QVU";
  const sellerAddress = "GA6HCMBLTZS6UL2J3HPVG4JXZXA4HXK3YW5SGS2ZTD5RMDM4U3RMMOBR";
  const sleepMock = jest.fn().mockResolvedValue(undefined);

  const buildService = (overrides: Partial<rpc.Server> = {}) => {
    const server = {
      getAccount: jest
        .fn()
        .mockImplementation(async (accountId: string) => new Account(accountId, "1")),
      simulateTransaction: jest.fn().mockResolvedValue({
        result: { retval: { _value: "7" } },
      }),
      prepareTransaction: jest.fn().mockImplementation(async (tx) => tx),
      ...overrides,
    } as unknown as rpc.Server;

    __setRpcServerFactoryForTests(() => server);
    return {
      server,
      service: new ContractService(
        "https://rpc.example.com",
        process.env.AMANA_ESCROW_CONTRACT_ID!,
        process.env.USDC_CONTRACT_ID!,
        Networks.TESTNET,
      ),
    };
  };

  beforeEach(() => {
    __setRetrySleepForTests(sleepMock);
  });

  afterEach(() => {
    __resetRetrySleepForTests();
    __resetRpcServerFactoryForTests();
    sleepMock.mockClear();
    jest.restoreAllMocks();
  });

  it("retries Soroban simulation failures and succeeds", async () => {
    const { service, server } = buildService({
      simulateTransaction: jest
        .fn()
        .mockRejectedValueOnce({ response: { status: 503 } })
        .mockResolvedValueOnce({
          result: { retval: { value: () => undefined } },
        }),
    });

    jest.spyOn<any, any>(service as any, "extractTradeId").mockReturnValue("77");

    const result = await service.buildCreateTradeTx({
      buyerAddress,
      sellerAddress,
      amountUsdc: "12.5",
      buyerLossBps: 5000,
      sellerLossBps: 5000,
    });

    expect(result.tradeId).toBe("77");
    expect((server as any).simulateTransaction).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(1000);
  });

  it("retries prepareTransaction on rate limiting", async () => {
    const { service, server } = buildService({
      prepareTransaction: jest
        .fn()
        .mockRejectedValueOnce({ status: 429 })
        .mockImplementationOnce(async (tx) => tx),
    });

    const result = await service.buildDepositTx({
      tradeId: "7",
      buyerAddress,
      amountUsdc: "10",
    });

    expect(result.unsignedXdr).toEqual(expect.any(String));
    expect((server as any).prepareTransaction).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(1000);
  });

  it("does not retry non-retryable Soroban client errors", async () => {
    const { service, server } = buildService({
      getAccount: jest.fn().mockRejectedValue({ response: { status: 400 } }),
    });

    await expect(
      service.buildDepositTx({
        tradeId: "7",
        buyerAddress,
        amountUsdc: "10",
      }),
    ).rejects.toEqual(expect.objectContaining({ response: { status: 400 } }));
    expect((server as any).getAccount).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("fails after the retry budget is exhausted", async () => {
    const { service, server } = buildService({
      prepareTransaction: jest.fn().mockRejectedValue({ response: { status: 500 } }),
    });

    await expect(
      service.buildSubmitManifestTx({
        tradeId: "7",
        sellerAddress,
        driverNameHash: "driver-hash",
        driverIdHash: "id-hash",
      }),
    ).rejects.toEqual(expect.objectContaining({ response: { status: 500 } }));
    expect((server as any).prepareTransaction).toHaveBeenCalledTimes(4);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 2000);
    expect(sleepMock).toHaveBeenNthCalledWith(3, 4000);
  });
});
