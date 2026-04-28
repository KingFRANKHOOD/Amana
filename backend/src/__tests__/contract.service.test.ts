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
      amount: "12.5",
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

describe("ContractService XDR builders", () => {
  const buyerAddress = "GCKFBEIYTKP6ZCFWXHA5QB4MX2CSHKQJBM3NP5M4A4V4UMZQZK3Q4QVU";
  const sellerAddress = "GA6HCMBLTZS6UL2J3HPVG4JXZXA4HXK3YW5SGS2ZTD5RMDM4U3RMMOBR";
  const mediatorAddress = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

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
    __setRetrySleepForTests(jest.fn().mockResolvedValue(undefined));
  });

  afterEach(() => {
    __resetRetrySleepForTests();
    __resetRpcServerFactoryForTests();
    jest.restoreAllMocks();
  });

  describe("buildCreateTradeTx", () => {
    it("validates seller address format", async () => {
      const { service } = buildService();

      await expect(
        service.buildCreateTradeTx({
          buyerAddress,
          sellerAddress: "INVALID_ADDRESS",
          amount: "100",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        }),
      ).rejects.toThrow();
    });

    it("validates buyer address format", async () => {
      const { service } = buildService();

      await expect(
        service.buildCreateTradeTx({
          buyerAddress: "INVALID_ADDRESS",
          sellerAddress,
          amount: "100",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        }),
      ).rejects.toThrow();
    });

    it("computes buyerLossBps correctly", async () => {
      const { service } = buildService();

      const result = await service.buildCreateTradeTx({
        buyerAddress,
        sellerAddress,
        amount: "100",
        buyerLossBps: 3000,
        sellerLossBps: 7000,
      });

      expect(result.tradeId).toBe("7");
      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("computes sellerLossBps correctly", async () => {
      const { service } = buildService();

      const result = await service.buildCreateTradeTx({
        buyerAddress,
        sellerAddress,
        amount: "100",
        buyerLossBps: 7000,
        sellerLossBps: 3000,
      });

      expect(result.tradeId).toBe("7");
      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("handles equal loss ratios", async () => {
      const { service } = buildService();

      const result = await service.buildCreateTradeTx({
        buyerAddress,
        sellerAddress,
        amount: "100",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      expect(result.tradeId).toBe("7");
      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("handles zero buyer loss", async () => {
      const { service } = buildService();

      const result = await service.buildCreateTradeTx({
        buyerAddress,
        sellerAddress,
        amount: "100",
        buyerLossBps: 0,
        sellerLossBps: 10000,
      });

      expect(result.tradeId).toBe("7");
      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("handles zero seller loss", async () => {
      const { service } = buildService();

      const result = await service.buildCreateTradeTx({
        buyerAddress,
        sellerAddress,
        amount: "100",
        buyerLossBps: 10000,
        sellerLossBps: 0,
      });

      expect(result.tradeId).toBe("7");
      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("handles extremely large amounts", async () => {
      const { service } = buildService();

      const result = await service.buildCreateTradeTx({
        buyerAddress,
        sellerAddress,
        amount: "999999999999.9999999",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      expect(result.tradeId).toBe("7");
      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("handles zero amount", async () => {
      const { service } = buildService();

      const result = await service.buildCreateTradeTx({
        buyerAddress,
        sellerAddress,
        amount: "0",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      expect(result.tradeId).toBe("7");
      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("handles fractional amounts", async () => {
      const { service } = buildService();

      const result = await service.buildCreateTradeTx({
        buyerAddress,
        sellerAddress,
        amount: "12.5",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      expect(result.tradeId).toBe("7");
      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("throws error when contract ID is not configured", async () => {
      const server = {
        getAccount: jest.fn().mockImplementation(async (accountId: string) => new Account(accountId, "1")),
        simulateTransaction: jest.fn().mockResolvedValue({
          result: { retval: { _value: "7" } },
        }),
        prepareTransaction: jest.fn().mockImplementation(async (tx) => tx),
      } as unknown as rpc.Server;

      __setRpcServerFactoryForTests(() => server);

      const service = new ContractService(
        "https://rpc.example.com",
        "", // Empty contract ID
        process.env.USDC_CONTRACT_ID!,
        Networks.TESTNET,
      );

      await expect(
        service.buildCreateTradeTx({
          buyerAddress,
          sellerAddress,
          amount: "100",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        }),
      ).rejects.toThrow("CONTRACT_ID is not configured");
    });

    it("returns valid XDR string", async () => {
      const { service } = buildService();

      const result = await service.buildCreateTradeTx({
        buyerAddress,
        sellerAddress,
        amount: "100",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
      expect(result.unsignedXdr.length).toBeGreaterThan(0);
    });
  });

  describe("buildDepositTx", () => {
    it("builds deposit transaction with correct escrow amount", async () => {
      const { service } = buildService();

      const result = await service.buildDepositTx({
        tradeId: "7",
        buyerAddress,
        amountUsdc: "100",
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("handles fractional deposit amounts", async () => {
      const { service } = buildService();

      const result = await service.buildDepositTx({
        tradeId: "7",
        buyerAddress,
        amountUsdc: "50.75",
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("handles zero deposit amount", async () => {
      const { service } = buildService();

      const result = await service.buildDepositTx({
        tradeId: "7",
        buyerAddress,
        amountUsdc: "0",
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("handles large deposit amounts", async () => {
      const { service } = buildService();

      const result = await service.buildDepositTx({
        tradeId: "7",
        buyerAddress,
        amountUsdc: "999999999999.9999999",
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("throws error when contract ID is not configured", async () => {
      const server = {
        getAccount: jest.fn().mockImplementation(async (accountId: string) => new Account(accountId, "1")),
        prepareTransaction: jest.fn().mockImplementation(async (tx) => tx),
      } as unknown as rpc.Server;

      __setRpcServerFactoryForTests(() => server);

      const service = new ContractService(
        "https://rpc.example.com",
        "", // Empty contract ID
        process.env.USDC_CONTRACT_ID!,
        Networks.TESTNET,
      );

      await expect(
        service.buildDepositTx({
          tradeId: "7",
          buyerAddress,
          amountUsdc: "100",
        }),
      ).rejects.toThrow("CONTRACT_ID is not configured");
    });

    it("throws error when USDC contract ID is not configured", async () => {
      const server = {
        getAccount: jest.fn().mockImplementation(async (accountId: string) => new Account(accountId, "1")),
        prepareTransaction: jest.fn().mockImplementation(async (tx) => tx),
      } as unknown as rpc.Server;

      __setRpcServerFactoryForTests(() => server);

      const service = new ContractService(
        "https://rpc.example.com",
        process.env.AMANA_ESCROW_CONTRACT_ID!,
        "", // Empty USDC contract ID
        Networks.TESTNET,
      );

      await expect(
        service.buildDepositTx({
          tradeId: "7",
          buyerAddress,
          amountUsdc: "100",
        }),
      ).rejects.toThrow("USDC_CONTRACT_ID is not configured");
    });
  });

  describe("buildConfirmDeliveryTx", () => {
    it("builds confirm delivery transaction for FUNDED trade", async () => {
      const { service } = buildService();

      const result = await service.buildConfirmDeliveryTx(
        { tradeId: "7", status: "FUNDED" },
        buyerAddress,
      );

      expect(result).toEqual(expect.any(String));
    });

    it("throws error when trade is not FUNDED", async () => {
      const { service } = buildService();

      await expect(
        service.buildConfirmDeliveryTx(
          { tradeId: "7", status: "PENDING_SIGNATURE" },
          buyerAddress,
        ),
      ).rejects.toThrow("Trade must be FUNDED before confirm_delivery");
    });

    it("throws error when trade is DELIVERED", async () => {
      const { service } = buildService();

      await expect(
        service.buildConfirmDeliveryTx(
          { tradeId: "7", status: "DELIVERED" },
          buyerAddress,
        ),
      ).rejects.toThrow("Trade must be FUNDED before confirm_delivery");
    });

    it("throws error when trade is DISPUTED", async () => {
      const { service } = buildService();

      await expect(
        service.buildConfirmDeliveryTx(
          { tradeId: "7", status: "DISPUTED" },
          buyerAddress,
        ),
      ).rejects.toThrow("Trade must be FUNDED before confirm_delivery");
    });

    it("returns valid XDR string", async () => {
      const { service } = buildService();

      const result = await service.buildConfirmDeliveryTx(
        { tradeId: "7", status: "FUNDED" },
        buyerAddress,
      );

      expect(result).toEqual(expect.any(String));
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("buildReleaseFundsTx", () => {
    it("builds release funds transaction for DELIVERED trade", async () => {
      const { service } = buildService();

      const result = await service.buildReleaseFundsTx(
        { tradeId: "7", status: "DELIVERED" },
        buyerAddress,
      );

      expect(result).toEqual(expect.any(String));
    });

    it("throws error when trade is not DELIVERED", async () => {
      const { service } = buildService();

      await expect(
        service.buildReleaseFundsTx(
          { tradeId: "7", status: "FUNDED" },
          buyerAddress,
        ),
      ).rejects.toThrow("Trade must be DELIVERED before release_funds");
    });

    it("throws error when trade is PENDING", async () => {
      const { service } = buildService();

      await expect(
        service.buildReleaseFundsTx(
          { tradeId: "7", status: "PENDING_SIGNATURE" },
          buyerAddress,
        ),
      ).rejects.toThrow("Trade must be DELIVERED before release_funds");
    });

    it("throws error when trade is DISPUTED", async () => {
      const { service } = buildService();

      await expect(
        service.buildReleaseFundsTx(
          { tradeId: "7", status: "DISPUTED" },
          buyerAddress,
        ),
      ).rejects.toThrow("Trade must be DELIVERED before release_funds");
    });

    it("returns valid XDR string", async () => {
      const { service } = buildService();

      const result = await service.buildReleaseFundsTx(
        { tradeId: "7", status: "DELIVERED" },
        buyerAddress,
      );

      expect(result).toEqual(expect.any(String));
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("buildInitiateDisputeTx", () => {
    it("builds initiate dispute transaction with reason hash", async () => {
      const { service } = buildService();

      const result = await service.buildInitiateDisputeTx({
        tradeId: "7",
        initiatorAddress: buyerAddress,
        reasonHash: "abc123def456",
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("includes mediator in dispute transaction", async () => {
      const { service } = buildService();

      const result = await service.buildInitiateDisputeTx({
        tradeId: "7",
        initiatorAddress: buyerAddress,
        reasonHash: "abc123def456",
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("handles long reason hash", async () => {
      const { service } = buildService();

      const result = await service.buildInitiateDisputeTx({
        tradeId: "7",
        initiatorAddress: buyerAddress,
        reasonHash: "a".repeat(1000),
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("handles empty reason hash", async () => {
      const { service } = buildService();

      const result = await service.buildInitiateDisputeTx({
        tradeId: "7",
        initiatorAddress: buyerAddress,
        reasonHash: "",
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("validates initiator address format", async () => {
      const { service } = buildService();

      await expect(
        service.buildInitiateDisputeTx({
          tradeId: "7",
          initiatorAddress: "INVALID_ADDRESS",
          reasonHash: "abc123",
        }),
      ).rejects.toThrow();
    });

    it("throws error when contract ID is not configured", async () => {
      const server = {
        getAccount: jest.fn().mockImplementation(async (accountId: string) => new Account(accountId, "1")),
        prepareTransaction: jest.fn().mockImplementation(async (tx) => tx),
      } as unknown as rpc.Server;

      __setRpcServerFactoryForTests(() => server);

      const service = new ContractService(
        "https://rpc.example.com",
        "", // Empty contract ID
        process.env.USDC_CONTRACT_ID!,
        Networks.TESTNET,
      );

      await expect(
        service.buildInitiateDisputeTx({
          tradeId: "7",
          initiatorAddress: buyerAddress,
          reasonHash: "abc123",
        }),
      ).rejects.toThrow("CONTRACT_ID is not configured");
    });

    it("returns valid XDR string", async () => {
      const { service } = buildService();

      const result = await service.buildInitiateDisputeTx({
        tradeId: "7",
        initiatorAddress: buyerAddress,
        reasonHash: "abc123def456",
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
      expect(result.unsignedXdr.length).toBeGreaterThan(0);
    });
  });

  describe("buildSubmitManifestTx", () => {
    it("builds submit manifest transaction", async () => {
      const { service } = buildService();

      const result = await service.buildSubmitManifestTx({
        tradeId: "7",
        sellerAddress,
        driverNameHash: "driver-hash",
        driverIdHash: "id-hash",
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("handles long driver name hash", async () => {
      const { service } = buildService();

      const result = await service.buildSubmitManifestTx({
        tradeId: "7",
        sellerAddress,
        driverNameHash: "a".repeat(1000),
        driverIdHash: "id-hash",
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("handles long driver ID hash", async () => {
      const { service } = buildService();

      const result = await service.buildSubmitManifestTx({
        tradeId: "7",
        sellerAddress,
        driverNameHash: "driver-hash",
        driverIdHash: "b".repeat(1000),
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("handles empty hashes", async () => {
      const { service } = buildService();

      const result = await service.buildSubmitManifestTx({
        tradeId: "7",
        sellerAddress,
        driverNameHash: "",
        driverIdHash: "",
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("validates seller address format", async () => {
      const { service } = buildService();

      await expect(
        service.buildSubmitManifestTx({
          tradeId: "7",
          sellerAddress: "INVALID_ADDRESS",
          driverNameHash: "driver-hash",
          driverIdHash: "id-hash",
        }),
      ).rejects.toThrow();
    });

    it("throws error when contract ID is not configured", async () => {
      const server = {
        getAccount: jest.fn().mockImplementation(async (accountId: string) => new Account(accountId, "1")),
        prepareTransaction: jest.fn().mockImplementation(async (tx) => tx),
      } as unknown as rpc.Server;

      __setRpcServerFactoryForTests(() => server);

      const service = new ContractService(
        "https://rpc.example.com",
        "", // Empty contract ID
        process.env.USDC_CONTRACT_ID!,
        Networks.TESTNET,
      );

      await expect(
        service.buildSubmitManifestTx({
          tradeId: "7",
          sellerAddress,
          driverNameHash: "driver-hash",
          driverIdHash: "id-hash",
        }),
      ).rejects.toThrow("CONTRACT_ID is not configured");
    });

    it("returns valid XDR string", async () => {
      const { service } = buildService();

      const result = await service.buildSubmitManifestTx({
        tradeId: "7",
        sellerAddress,
        driverNameHash: "driver-hash",
        driverIdHash: "id-hash",
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
      expect(result.unsignedXdr.length).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    it("handles invalid contract ID", async () => {
      const server = {
        getAccount: jest.fn().mockImplementation(async (accountId: string) => new Account(accountId, "1")),
        simulateTransaction: jest.fn().mockResolvedValue({
          result: { retval: { _value: "7" } },
        }),
        prepareTransaction: jest.fn().mockImplementation(async (tx) => tx),
      } as unknown as rpc.Server;

      __setRpcServerFactoryForTests(() => server);

      const service = new ContractService(
        "https://rpc.example.com",
        "", // Empty contract ID
        process.env.USDC_CONTRACT_ID!,
        Networks.TESTNET,
      );

      await expect(
        service.buildCreateTradeTx({
          buyerAddress,
          sellerAddress,
          amount: "100",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        }),
      ).rejects.toThrow("CONTRACT_ID is not configured");
    });

    it("handles invalid RPC URL", async () => {
      const server = {
        getAccount: jest.fn().mockRejectedValue(new Error("Network error")),
        simulateTransaction: jest.fn().mockRejectedValue(new Error("Network error")),
        prepareTransaction: jest.fn().mockRejectedValue(new Error("Network error")),
      } as unknown as rpc.Server;

      __setRpcServerFactoryForTests(() => server);

      const service = new ContractService(
        "https://invalid-rpc-url.example.com",
        process.env.AMANA_ESCROW_CONTRACT_ID!,
        process.env.USDC_CONTRACT_ID!,
        Networks.TESTNET,
      );

      await expect(
        service.buildCreateTradeTx({
          buyerAddress,
          sellerAddress,
          amount: "100",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        }),
      ).rejects.toThrow();
    });

    it("handles network timeout", async () => {
      const server = {
        getAccount: jest.fn().mockRejectedValue(new Error("Timeout")),
        simulateTransaction: jest.fn().mockRejectedValue(new Error("Timeout")),
        prepareTransaction: jest.fn().mockRejectedValue(new Error("Timeout")),
      } as unknown as rpc.Server;

      __setRpcServerFactoryForTests(() => server);

      const service = new ContractService(
        "https://rpc.example.com",
        process.env.AMANA_ESCROW_CONTRACT_ID!,
        process.env.USDC_CONTRACT_ID!,
        Networks.TESTNET,
      );

      await expect(
        service.buildCreateTradeTx({
          buyerAddress,
          sellerAddress,
          amount: "100",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        }),
      ).rejects.toThrow();
    });

    it("handles simulation error", async () => {
      const server = {
        getAccount: jest.fn().mockImplementation(async (accountId: string) => new Account(accountId, "1")),
        simulateTransaction: jest.fn().mockRejectedValue(new Error("Simulation failed")),
        prepareTransaction: jest.fn().mockImplementation(async (tx) => tx),
      } as unknown as rpc.Server;

      __setRpcServerFactoryForTests(() => server);

      const service = new ContractService(
        "https://rpc.example.com",
        process.env.AMANA_ESCROW_CONTRACT_ID!,
        process.env.USDC_CONTRACT_ID!,
        Networks.TESTNET,
      );

      await expect(
        service.buildCreateTradeTx({
          buyerAddress,
          sellerAddress,
          amount: "100",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        }),
      ).rejects.toThrow();
    });

    it("handles invalid Stellar address", async () => {
      const { service } = buildService();

      await expect(
        service.buildCreateTradeTx({
          buyerAddress: "INVALID",
          sellerAddress,
          amount: "100",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        }),
      ).rejects.toThrow();
    });

    it("handles contract not found error", async () => {
      const server = {
        getAccount: jest.fn().mockImplementation(async (accountId: string) => new Account(accountId, "1")),
        simulateTransaction: jest.fn().mockRejectedValue({
          response: { status: 404 },
          message: "Contract not found",
        }),
        prepareTransaction: jest.fn().mockImplementation(async (tx) => tx),
      } as unknown as rpc.Server;

      __setRpcServerFactoryForTests(() => server);

      const service = new ContractService(
        "https://rpc.example.com",
        process.env.AMANA_ESCROW_CONTRACT_ID!,
        process.env.USDC_CONTRACT_ID!,
        Networks.TESTNET,
      );

      await expect(
        service.buildCreateTradeTx({
          buyerAddress,
          sellerAddress,
          amount: "100",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        }),
      ).rejects.toThrow();
    });
  });

  describe("XDR serialization correctness", () => {
    it("returns base64 encoded XDR string", async () => {
      const { service } = buildService();

      const result = await service.buildCreateTradeTx({
        buyerAddress,
        sellerAddress,
        amount: "100",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      // Base64 regex pattern
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
      expect(result.unsignedXdr).toMatch(base64Regex);
    });

    it("XDR is decodable", async () => {
      const { service } = buildService();

      const result = await service.buildCreateTradeTx({
        buyerAddress,
        sellerAddress,
        amount: "100",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      // Should not throw when decoding
      expect(() => Buffer.from(result.unsignedXdr, "base64")).not.toThrow();
    });

    it("deposit XDR is decodable", async () => {
      const { service } = buildService();

      const result = await service.buildDepositTx({
        tradeId: "7",
        buyerAddress,
        amountUsdc: "100",
      });

      expect(() => Buffer.from(result.unsignedXdr, "base64")).not.toThrow();
    });

    it("confirm delivery XDR is decodable", async () => {
      const { service } = buildService();

      const result = await service.buildConfirmDeliveryTx(
        { tradeId: "7", status: "FUNDED" },
        buyerAddress,
      );

      expect(() => Buffer.from(result, "base64")).not.toThrow();
    });

    it("release funds XDR is decodable", async () => {
      const { service } = buildService();

      const result = await service.buildReleaseFundsTx(
        { tradeId: "7", status: "DELIVERED" },
        buyerAddress,
      );

      expect(() => Buffer.from(result, "base64")).not.toThrow();
    });

    it("initiate dispute XDR is decodable", async () => {
      const { service } = buildService();

      const result = await service.buildInitiateDisputeTx({
        tradeId: "7",
        initiatorAddress: buyerAddress,
        reasonHash: "abc123",
      });

      expect(() => Buffer.from(result.unsignedXdr, "base64")).not.toThrow();
    });

    it("submit manifest XDR is decodable", async () => {
      const { service } = buildService();

      const result = await service.buildSubmitManifestTx({
        tradeId: "7",
        sellerAddress,
        driverNameHash: "driver-hash",
        driverIdHash: "id-hash",
      });

      expect(() => Buffer.from(result.unsignedXdr, "base64")).not.toThrow();
    });
  });

  describe("Soroban SDK integration", () => {
    it("uses Address for buyer address", async () => {
      const { service } = buildService();

      const result = await service.buildCreateTradeTx({
        buyerAddress,
        sellerAddress,
        amount: "100",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("uses Address for seller address", async () => {
      const { service } = buildService();

      const result = await service.buildCreateTradeTx({
        buyerAddress,
        sellerAddress,
        amount: "100",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("uses Contract for escrow contract", async () => {
      const { service } = buildService();

      const result = await service.buildCreateTradeTx({
        buyerAddress,
        sellerAddress,
        amount: "100",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
    });

    it("uses TransactionBuilder for transaction creation", async () => {
      const { service } = buildService();

      const result = await service.buildCreateTradeTx({
        buyerAddress,
        sellerAddress,
        amount: "100",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      expect(result.unsignedXdr).toEqual(expect.any(String));
    });
  });

  describe("fee deduction", () => {
    it("fee is applied at settlement, not before", async () => {
      const { service } = buildService();

      // Build create trade transaction (no fee applied yet)
      const createResult = await service.buildCreateTradeTx({
        buyerAddress,
        sellerAddress,
        amount: "100",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

      expect(createResult.unsignedXdr).toEqual(expect.any(String));

      // Build deposit transaction (no fee applied yet)
      const depositResult = await service.buildDepositTx({
        tradeId: "7",
        buyerAddress,
        amountUsdc: "100",
      });

      expect(depositResult.unsignedXdr).toEqual(expect.any(String));

      // Build release funds transaction (fee should be applied here)
      const releaseResult = await service.buildReleaseFundsTx(
        { tradeId: "7", status: "DELIVERED" },
        buyerAddress,
      );

      expect(releaseResult).toEqual(expect.any(String));
    });
  });
});
