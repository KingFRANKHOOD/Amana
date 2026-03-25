import { PrismaClient, TradeStatus } from "@prisma/client";
import { TradeAccessDeniedError, TradeService } from "../services/trade.service";

function createMockPrisma() {
  return {
    trade: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
    },
  } as unknown as PrismaClient;
}

describe("TradeService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: TradeService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new TradeService(prisma);
  });

  it("GET /trades returns only caller's trades", async () => {
    prisma.trade.findMany = jest.fn().mockResolvedValue([
      {
        id: 1,
        tradeId: "T1",
        buyer: "GA_CALLER",
        seller: "GA_SELLER",
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
          OR: [{ buyer: "GA_CALLER" }, { seller: "GA_CALLER" }],
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
        buyer: "GA_CALLER",
        seller: "GA_S2",
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
          OR: [{ buyer: "GA_CALLER" }, { seller: "GA_CALLER" }],
          status: TradeStatus.FUNDED,
        },
      })
    );
  });

  it("GET /trades/:id returns 403 if caller is not party", async () => {
    prisma.trade.findFirst = jest.fn().mockResolvedValue({
      id: 10,
      tradeId: "T10",
      buyer: "GA_A",
      seller: "GA_B",
      amountUsdc: "900",
      status: TradeStatus.CREATED,
    });

    await expect(service.getTradeById("10", "GA_NOT_PARTY")).rejects.toBeInstanceOf(
      TradeAccessDeniedError
    );
  });

  it("GET /trades/stats returns correct counts and volume", async () => {
    prisma.trade.findMany = jest.fn().mockResolvedValue([
      { amountUsdc: "100", status: TradeStatus.CREATED },
      { amountUsdc: "25.5", status: TradeStatus.FUNDED },
      { amountUsdc: "50", status: TradeStatus.COMPLETED },
    ]);

    const stats = await service.getUserStats("GA_CALLER");

    expect(stats.totalTrades).toBe(3);
    expect(stats.totalVolume).toBeCloseTo(175.5);
    expect(stats.openTrades).toBe(2);
  });
});
