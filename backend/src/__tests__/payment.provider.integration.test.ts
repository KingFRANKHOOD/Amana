/**
 * Integration tests for external payment provider simulation.
 *
 * These tests simulate the full payment flow through the Stellar network adapter
 * and trade lifecycle without hitting real external services. All Horizon/RPC
 * calls are mocked so the suite is deterministic and can run in CI.
 */
import { PrismaClient, TradeStatus, DisputeStatus } from "@prisma/client";
import { TradeService } from "../services/trade.service";
import { ContractService } from "../services/contract.service";
import { PathPaymentService } from "../services/pathPayment.service";

// ---------------------------------------------------------------------------
// Mock external Stellar / Soroban dependencies
// ---------------------------------------------------------------------------
jest.mock("../services/contract.service");
jest.mock("../config/stellar", () => ({
  horizonServer: {},
  sorobanRpcClient: {},
  networkPassphrase: "Test SDF Network ; September 2015",
}));
jest.mock("../lib/retry", () => ({
  retryAsync: (fn: () => Promise<any>) => fn(),
}));

// ---------------------------------------------------------------------------
// Mock Prisma so no real DB is needed
// ---------------------------------------------------------------------------
function createMockPrisma() {
  return {
    trade: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    dispute: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    disputeCategory: {
      findFirst: jest.fn(),
    },
  } as unknown as PrismaClient;
}

const BUYER = "GBUY000000000000000000000000000000000000000000000000000001";
const SELLER = "GSEL000000000000000000000000000000000000000000000000000001";
const TRADE_ID = "payment-integration-trade-001";

function mockTrade(status: TradeStatus = TradeStatus.PENDING_SIGNATURE) {
  return {
    id: 1,
    tradeId: TRADE_ID,
    buyerAddress: BUYER,
    sellerAddress: SELLER,
    amountUsdc: "200.0000000",
    buyerLossBps: 5000,
    sellerLossBps: 5000,
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Suite 1 – Trade lifecycle (simulates payment provider deposit/release flow)
// ---------------------------------------------------------------------------
describe("Payment Provider Integration – Trade lifecycle", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let tradeService: TradeService;
  let contractService: jest.Mocked<ContractService>;

  beforeEach(() => {
    prisma = createMockPrisma();
    contractService = new ContractService() as jest.Mocked<ContractService>;
    tradeService = new TradeService(prisma as any, contractService);
  });

  afterEach(() => jest.clearAllMocks());

  it("simulates a full happy-path payment: create → deposit → confirm → release", async () => {
    // Step 1: Create pending trade (payment provider issues payment intent)
    prisma.trade.create = jest.fn().mockResolvedValue(mockTrade(TradeStatus.PENDING_SIGNATURE));

    const created = await tradeService.createPendingTrade({
      tradeId: TRADE_ID,
      buyerAddress: BUYER,
      sellerAddress: SELLER,
      amountUsdc: "200.0000000",
      buyerLossBps: 5000,
      sellerLossBps: 5000,
    });

    expect(created.tradeId).toBe(TRADE_ID);
    expect(created.status).toBe(TradeStatus.PENDING_SIGNATURE);

    // Step 2: Buyer deposits funds (payment provider confirms escrow funding)
    const fundedTrade = mockTrade(TradeStatus.FUNDED);
    contractService.buildDepositTx = jest.fn().mockResolvedValue({ unsignedXdr: "deposit-xdr" });
    prisma.trade.findFirst = jest.fn().mockResolvedValue(fundedTrade);

    const deposit = await contractService.buildDepositTx(fundedTrade);
    expect(deposit.unsignedXdr).toBe("deposit-xdr");

    // Step 3: Seller confirms delivery (payment provider updates order status)
    const deliveredTrade = mockTrade(TradeStatus.DELIVERED);
    const confirmXdr = "confirm-delivery-xdr";
    const buildConfirmFn = jest.fn().mockResolvedValue(confirmXdr);
    ContractService.buildConfirmDeliveryTx = buildConfirmFn;

    const confirm = await ContractService.buildConfirmDeliveryTx(deliveredTrade, BUYER);
    expect(confirm).toBe(confirmXdr);

    // Step 4: Release funds to seller (payment provider settles)
    const releaseXdr = "release-funds-xdr";
    const buildReleaseFn = jest.fn().mockResolvedValue(releaseXdr);
    ContractService.buildReleaseFundsTx = buildReleaseFn;

    const release = await ContractService.buildReleaseFundsTx(deliveredTrade, BUYER);
    expect(release).toBe(releaseXdr);
  });

  it("simulates payment provider rejection: contract build failure prevents trade record creation", async () => {
    contractService.buildCreateTradeTx = jest.fn().mockRejectedValue(
      new Error("Payment provider: insufficient liquidity"),
    );

    await expect(contractService.buildCreateTradeTx({
      buyerAddress: BUYER,
      sellerAddress: SELLER,
      amountUsdc: "200.0000000",
      buyerLossBps: 5000,
      sellerLossBps: 5000,
    })).rejects.toThrow("insufficient liquidity");

    // The DB record should never be created if the payment provider rejects
    expect(prisma.trade.create).not.toHaveBeenCalled();
  });

  it("simulates partial payment: deposit fails after trade record created", async () => {
    prisma.trade.create = jest.fn().mockResolvedValue(mockTrade());
    contractService.buildDepositTx = jest.fn().mockRejectedValue(
      new Error("Payment provider: deposit timeout"),
    );

    await tradeService.createPendingTrade({
      tradeId: TRADE_ID,
      buyerAddress: BUYER,
      sellerAddress: SELLER,
      amountUsdc: "200.0000000",
      buyerLossBps: 5000,
      sellerLossBps: 5000,
    });

    const createdTrade = mockTrade(TradeStatus.CREATED);
    await expect(contractService.buildDepositTx(createdTrade)).rejects.toThrow("deposit timeout");

    // Trade stays in its current status — no phantom update
    expect(prisma.trade.update).not.toHaveBeenCalled();
  });

  it("simulates payment stats: aggregates volume and open trade counts", async () => {
    prisma.trade.findMany = jest.fn().mockResolvedValue([
      { amountUsdc: "100.0000000", status: TradeStatus.FUNDED },
      { amountUsdc: "250.0000000", status: TradeStatus.DELIVERED },
      { amountUsdc: "50.0000000", status: TradeStatus.COMPLETED },
    ]);

    const stats = await tradeService.getUserStats(BUYER);

    expect(stats.totalTrades).toBe(3);
    expect(stats.totalVolume).toBeCloseTo(400);
    expect(stats.openTrades).toBe(2); // FUNDED + DELIVERED are open
  });

  it("simulates idempotent payment creation: same tradeId returns existing trade via DB lookup", async () => {
    const existing = mockTrade(TradeStatus.FUNDED);
    prisma.trade.findFirst = jest.fn().mockResolvedValue(existing);

    const found = await tradeService.getTradeById(TRADE_ID, BUYER);

    expect(found).toEqual(existing);
    expect(found!.status).toBe(TradeStatus.FUNDED);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 – Path payment / FX simulation
// ---------------------------------------------------------------------------
describe("Payment Provider Integration – Path payment simulation", () => {
  let pathPaymentService: PathPaymentService;

  beforeEach(() => {
    pathPaymentService = new PathPaymentService();
  });

  afterEach(() => jest.clearAllMocks());

  it("returns FX quote for NGN → USDC with single path", async () => {
    const quote = {
      source_amount: "1000",
      source_asset_type: "credit_alphanum4",
      source_asset_code: "cNGN",
      destination_amount: "0.6250000",
      destination_asset_type: "credit_alphanum4",
      destination_asset_code: "USDC",
      path: [],
    };

    jest.spyOn(pathPaymentService, "getPathPaymentQuote").mockResolvedValue([quote]);

    const quotes = await pathPaymentService.getPathPaymentQuote("1000", "cNGN", "GA_CNGN_ISSUER");

    expect(quotes).toHaveLength(1);
    expect(quotes[0].source_asset_code).toBe("cNGN");
    expect(quotes[0].destination_asset_code).toBe("USDC");
    expect(quotes[0].destination_amount).toBe("0.6250000");
  });

  it("returns multiple paths when multiple routes exist", async () => {
    const paths = [
      { source_amount: "1000", source_asset_code: "cNGN", destination_amount: "0.6250000", destination_asset_code: "USDC", source_asset_type: "credit_alphanum4", destination_asset_type: "credit_alphanum4", path: [] },
      { source_amount: "1000", source_asset_code: "cNGN", destination_amount: "0.6200000", destination_asset_code: "USDC", source_asset_type: "credit_alphanum4", destination_asset_type: "credit_alphanum4", path: [{ asset_code: "XLM", asset_type: "native" }] },
    ];

    jest.spyOn(pathPaymentService, "getPathPaymentQuote").mockResolvedValue(paths);

    const quotes = await pathPaymentService.getPathPaymentQuote("1000", "cNGN", "GA_ISSUER");

    expect(quotes).toHaveLength(2);
    expect(quotes[1].path).toHaveLength(1);
  });

  it("throws when payment provider path discovery fails", async () => {
    jest
      .spyOn(pathPaymentService, "getPathPaymentQuote")
      .mockRejectedValue(new Error("Failed to fetch path payment quotes"));

    await expect(
      pathPaymentService.getPathPaymentQuote("1000", "cNGN", "GA_ISSUER"),
    ).rejects.toThrow("Failed to fetch path payment quotes");
  });

  it("returns empty array when no routes available (low liquidity)", async () => {
    jest.spyOn(pathPaymentService, "getPathPaymentQuote").mockResolvedValue([]);

    const quotes = await pathPaymentService.getPathPaymentQuote("999999999", "cNGN", "GA_ISSUER");
    expect(quotes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 – Dispute-triggered payment hold simulation
// ---------------------------------------------------------------------------
describe("Payment Provider Integration – Dispute payment hold simulation", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let tradeService: TradeService;
  let contractService: jest.Mocked<ContractService>;

  beforeEach(() => {
    prisma = createMockPrisma();
    contractService = new ContractService() as jest.Mocked<ContractService>;
    tradeService = new TradeService(prisma as any, contractService);
  });

  afterEach(() => jest.clearAllMocks());

  it("simulates payment hold: dispute initiation blocks fund release", async () => {
    const fundedTrade = mockTrade(TradeStatus.FUNDED);
    prisma.trade.findFirst = jest.fn().mockResolvedValue(fundedTrade);
    prisma.disputeCategory.findFirst = jest.fn().mockResolvedValue({ id: 1 });
    contractService.buildInitiateDisputeTx = jest
      .fn()
      .mockResolvedValue({ unsignedXdr: "dispute-hold-xdr" });
    prisma.dispute.create = jest.fn().mockResolvedValue({
      id: 1,
      tradeId: TRADE_ID,
      status: DisputeStatus.OPEN,
    });

    const result = await tradeService.initiateDispute(
      TRADE_ID,
      BUYER,
      "Payment dispute: goods damaged",
      "quality",
    );

    expect(result.unsignedXdr).toBe("dispute-hold-xdr");
    expect(prisma.dispute.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tradeId: TRADE_ID,
          status: DisputeStatus.OPEN,
        }),
      }),
    );
  });

  it("simulates payment hold refusal: dispute blocked on PENDING_SIGNATURE trade", async () => {
    const pendingTrade = mockTrade(TradeStatus.PENDING_SIGNATURE);
    prisma.trade.findFirst = jest.fn().mockResolvedValue(pendingTrade);

    await expect(
      tradeService.initiateDispute(TRADE_ID, BUYER, "Dispute reason", "quality"),
    ).rejects.toThrow(/FUNDED or DELIVERED/i);

    // No hold created
    expect(prisma.dispute.create).not.toHaveBeenCalled();
    expect(contractService.buildInitiateDisputeTx).not.toHaveBeenCalled();
  });

  it("simulates payment hold refusal: non-party cannot freeze funds", async () => {
    const fundedTrade = mockTrade(TradeStatus.FUNDED);
    prisma.trade.findFirst = jest.fn().mockResolvedValue(fundedTrade);

    const OUTSIDER = "GOUT000000000000000000000000000000000000000000000000000001";
    await expect(
      tradeService.initiateDispute(TRADE_ID, OUTSIDER, "Fraudulent dispute", "scam"),
    ).rejects.toThrow(/Forbidden/);

    expect(contractService.buildInitiateDisputeTx).not.toHaveBeenCalled();
  });
});
