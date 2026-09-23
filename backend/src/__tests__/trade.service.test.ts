import { PrismaClient, TradeStatus } from "@prisma/client";
import { Keypair } from "@stellar/stellar-sdk";
import { TradeAccessDeniedError, TradeService } from "../services/trade.service";

jest.mock("../lib/cache", () => ({
  cacheService: {
    getOrSet: jest.fn((key: string, _ttl: number, fn: () => Promise<any>) => fn()),
    invalidateOne: jest.fn(),
    invalidate: jest.fn(),
  },
  cacheGet: jest.fn(),
  cacheSet: jest.fn(),
}));

jest.mock("ioredis", () =>
  jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    scan: jest.fn().mockResolvedValue(["0", []]),
  }))
);

function createMockPrisma() {
  const prisma: Record<string, unknown> = {
    trade: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      groupBy: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    user: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  prisma.$transaction = jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma));
  prisma.$queryRaw = jest.fn().mockResolvedValue([{ total_volume: "0" }]);
  return prisma as unknown as PrismaClient;
}

describe("TradeService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: TradeService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new TradeService(prisma, {} as any);
  });

  it("stores a pending trade with PENDING_SIGNATURE status", async () => {
    (prisma.trade.create as jest.Mock).mockResolvedValue({ tradeId: "4294967297" });

    await service.createPendingTrade({
      tradeId: "4294967297",
      buyerAddress: "buyer-address",
      sellerAddress: "seller-address",
      amountUsdc: "15.5000000",
      buyerLossBps: 5000,
      sellerLossBps: 5000,
    });

    expect(prisma.trade.create).toHaveBeenCalledWith({
      data: {
        tradeId: "4294967297",
        buyerAddress: "buyer-address",
        sellerAddress: "seller-address",
        amountUsdc: "15.5000000",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
        status: TradeStatus.PENDING_SIGNATURE,
      },
    });
  });

  it("records an audit log entry for trade creation", async () => {
    (prisma.trade.create as jest.Mock).mockResolvedValue({ tradeId: "4294967297" });

    await service.createPendingTrade({
      tradeId: "4294967297",
      buyerAddress: "buyer-address",
      sellerAddress: "seller-address",
      amountUsdc: "15.5000000",
      buyerLossBps: 5000,
      sellerLossBps: 5000,
    });

    expect((prisma as any).auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tradeId: "4294967297",
          eventType: "TradeCreationRequested",
          toStatus: TradeStatus.PENDING_SIGNATURE,
          actor: "buyer-address",
        }),
      }),
    );
  });

  it("GET /trades returns only caller's trades", async () => {
    prisma.trade.findMany = jest.fn().mockResolvedValue([
      {
        id: 1,
        tradeId: "T1",
        buyerAddress: "GA_CALLER",
        sellerAddress: "GA_SELLER",
        amountUsdc: "100",
        status: TradeStatus.CREATED,
      },
    ]);
    prisma.trade.count = jest.fn().mockResolvedValue(1);

    const result = await service.listUserTrades("GA_CALLER", {
      page: 1,
      limit: 20,
      sort: "createdAt:desc",
    });

    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ buyerAddress: "GA_CALLER" }, { sellerAddress: "GA_CALLER" }],
        },
      })
    );
    expect(result.items).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
  });

  it("GET /trades?status=FUNDED filters correctly", async () => {
    prisma.trade.findMany = jest.fn().mockResolvedValue([
      {
        id: 2,
        tradeId: "T2",
        buyerAddress: "GA_CALLER",
        sellerAddress: "GA_S2",
        amountUsdc: "200",
        status: TradeStatus.FUNDED,
      },
    ]);
    prisma.trade.count = jest.fn().mockResolvedValue(1);

    await service.listUserTrades("GA_CALLER", {
      status: TradeStatus.FUNDED,
      page: 1,
      limit: 20,
      sort: "createdAt:desc",
    });

    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ buyerAddress: "GA_CALLER" }, { sellerAddress: "GA_CALLER" }],
          status: TradeStatus.FUNDED,
        },
      })
    );
  });

  it("uses a stable default order with an id tie-breaker", async () => {
    prisma.trade.findMany = jest.fn().mockResolvedValue([]);
    prisma.trade.count = jest.fn().mockResolvedValue(0);

    await service.listUserTrades("GA_CALLER", {
      page: 1,
      limit: 20,
    });

    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: 0,
        take: 20,
      })
    );
  });

  it("keeps custom pagination sorts deterministic under identical sort values", async () => {
    prisma.trade.findMany = jest.fn().mockResolvedValue([]);
    prisma.trade.count = jest.fn().mockResolvedValue(0);

    await service.listUserTrades("GA_CALLER", {
      page: 2,
      limit: 5,
      sort: "createdAt:asc",
    });

    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: 5,
        take: 5,
      })
    );
  });

  it("falls back to stable default ordering for unsupported sort fields", async () => {
    prisma.trade.findMany = jest.fn().mockResolvedValue([]);
    prisma.trade.count = jest.fn().mockResolvedValue(0);

    await service.listUserTrades("GA_CALLER", {
      sort: "randomField:asc",
    });

    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    );
  });

  it("GET /trades/:id returns 403 if caller is not party", async () => {
    prisma.trade.findFirst = jest.fn().mockResolvedValue({
      id: 10,
      tradeId: "T10",
      buyerAddress: "GA_A",
      sellerAddress: "GA_B",
      amountUsdc: "900",
      status: TradeStatus.CREATED,
    });

    await expect(service.getTradeById("10", "GA_NOT_PARTY")).rejects.toBeInstanceOf(
      TradeAccessDeniedError
    );
  });

  it("GET /trades/stats returns correct counts and volume", async () => {
    (prisma.trade.count as jest.Mock).mockResolvedValue(3);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ total_volume: "175.5" }]);
    (prisma.trade.groupBy as jest.Mock).mockResolvedValue([
      { status: TradeStatus.PENDING_SIGNATURE, _count: { _all: 1 } },
      { status: TradeStatus.FUNDED, _count: { _all: 1 } },
      { status: TradeStatus.COMPLETED, _count: { _all: 1 } },
    ]);

    const stats = await service.getUserStats("GA_CALLER");

    expect(stats.totalTrades).toBe(3);
    expect(stats.totalVolume).toBeCloseTo(175.5);
    expect(stats.openTrades).toBe(2);
  });

  it("ensures Prisma user rows for fresh buyer and seller before creating trade (FK integrity)", async () => {
    const buyer = Keypair.random().publicKey();
    const seller = Keypair.random().publicKey();
    (prisma.trade.create as jest.Mock).mockResolvedValue({ tradeId: "T-FRESH" });

    await service.createPendingTrade({
      tradeId: "T-FRESH",
      buyerAddress: buyer,
      sellerAddress: seller,
      amountUsdc: "10.0000000",
      buyerLossBps: 5000,
      sellerLossBps: 5000,
    });

    // Upsert should be called for both buyer and seller (lowercased) — ensures FK integrity for fresh Supabase-only users
    expect((prisma as any).user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { walletAddress: buyer.toLowerCase() } }),
    );
    expect((prisma as any).user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { walletAddress: seller.toLowerCase() } }),
    );
    expect(prisma.trade.create).toHaveBeenCalled();
  });

  it("creates trade successfully for a fresh user who exists only in Supabase (no prior Prisma row)", async () => {
    const freshBuyer = Keypair.random().publicKey();
    const freshSeller = Keypair.random().publicKey();
    (prisma.trade.create as jest.Mock).mockResolvedValue({ tradeId: "T-INTEGRATION-FRESH" });

    // Simulate fresh users: Prisma findUnique would return null, but upsert handles creation
    await expect(
      service.createPendingTrade({
        tradeId: "T-INTEGRATION-FRESH",
        buyerAddress: freshBuyer,
        sellerAddress: freshSeller,
        amountUsdc: "25.00",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      }),
    ).resolves.toEqual(expect.objectContaining({ tradeId: "T-INTEGRATION-FRESH" }));

    expect((prisma as any).user.upsert).toHaveBeenCalled();
  });
});
