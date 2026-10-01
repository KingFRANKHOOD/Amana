import { ReputationService } from "../services/reputation.service";

const TradeStatus = {
  COMPLETED: "COMPLETED",
  DISPUTED: "DISPUTED",
  FUNDED: "FUNDED",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
  CREATED: "CREATED",
} as const;

describe("ReputationService", () => {
  let mockPrisma: {
    trade: { aggregate: jest.Mock; findMany: jest.Mock };
    dispute: { aggregate: jest.Mock; findMany: jest.Mock };
  };
  let service: ReputationService;

  const allTrades: Record<string, unknown>[] = [];
  const allDisputes: Record<string, unknown>[] = [];

  function matchesTradeWhere(trade: any, where: any) {
    const participantMatches = where.OR.some(
      (condition: any) =>
        trade.buyerAddress === condition.buyerAddress ||
        trade.sellerAddress === condition.sellerAddress,
    );
    return participantMatches && (!where.status || trade.status === where.status);
  }

  function setMockTrades(trades: Record<string, unknown>[]) {
    allTrades.length = 0;
    allTrades.push(...trades);
    mockPrisma.trade.aggregate.mockImplementation(({ where }: any) =>
      Promise.resolve({ _count: { _all: allTrades.filter((trade) => matchesTradeWhere(trade, where)).length } }),
    );
    mockPrisma.trade.findMany.mockImplementation(({ where, take }: any) =>
      Promise.resolve(allTrades.filter((trade) => matchesTradeWhere(trade, where)).slice(0, take)),
    );
  }

  function setMockDisputes(disputes: Record<string, unknown>[]) {
    allDisputes.length = 0;
    allDisputes.push(...disputes);
    const matches = (dispute: any, where: any) =>
      dispute.initiator === where.initiator &&
      (!where.status?.in || where.status.in.includes(dispute.status));
    mockPrisma.dispute.aggregate.mockImplementation(({ where }: any) =>
      Promise.resolve({ _count: { _all: allDisputes.filter((dispute) => matches(dispute, where)).length } }),
    );
    mockPrisma.dispute.findMany.mockImplementation(({ where, take }: any) =>
      Promise.resolve(allDisputes.filter((dispute) => matches(dispute, where)).slice(0, take)),
    );
  }

  function makeTrade(overrides: Record<string, unknown> = {}) {
    return {
      tradeId: overrides.tradeId ?? "trade-001",
      buyerAddress: overrides.buyerAddress ?? "gbuyer",
      sellerAddress: overrides.sellerAddress ?? "gseller",
      amountUsdc: overrides.amountUsdc ?? "1000",
      status: overrides.status ?? TradeStatus.COMPLETED,
      createdAt: overrides.createdAt ?? new Date("2025-01-01"),
      completedAt: overrides.completedAt ?? new Date("2025-01-15"),
      updatedAt: overrides.updatedAt ?? new Date("2025-01-15"),
    };
  }

  beforeEach(() => {
    mockPrisma = {
      trade: { aggregate: jest.fn(), findMany: jest.fn() },
      dispute: { aggregate: jest.fn(), findMany: jest.fn() },
    };
    setMockDisputes([]);
    service = new ReputationService(mockPrisma as any);
  });

  describe("getUserReputation", () => {
    it("should return default values when user has no trades", async () => {
      setMockTrades([]);
      setMockDisputes([]);

      const result = await service.getUserReputation("guser");

      expect(result.trustScore).toBe(50);
      expect(result.totalTrades).toBe(0);
      expect(result.completedTrades).toBe(0);
      expect(result.disputedTrades).toBe(0);
      expect(result.successRate).toBe(100);
      expect(result.history).toEqual([]);
    });

    it("should increase trust score for completed trades as buyer", async () => {
      setMockTrades(
        Array.from({ length: 3 }, (_, i) =>
          makeTrade({ tradeId: `trade-${i}`, buyerAddress: "guser" }),
        ),
      );
      setMockDisputes([]);

      const result = await service.getUserReputation("guser");

      expect(result.trustScore).toBe(65);
      expect(result.totalTrades).toBe(3);
      expect(result.completedTrades).toBe(3);
    });

    it("should apply dispute penalties to trust score", async () => {
      setMockTrades([]);
      setMockDisputes([
        {
          id: 1,
          tradeId: "trade-001",
          status: "RESOLVED",
          initiator: "guser",
          createdAt: new Date("2025-01-10"),
        },
        {
          id: 2,
          tradeId: "trade-002",
          status: "OPEN",
          initiator: "guser",
          createdAt: new Date("2025-01-11"),
        },
      ]);

      const result = await service.getUserReputation("guser");

      // Only the initiation penalty applies: a RESOLVED status carries no outcome.
      expect(result.trustScore).toBe(46);
      expect(result.disputedTrades).toBe(0);
    });

    it("does not treat a resolved dispute as lost (issue #1400)", async () => {
      setMockTrades([]);
      setMockDisputes([
        {
          id: 1,
          tradeId: "trade-001",
          status: "RESOLVED",
          initiator: "guser",
          createdAt: new Date("2025-01-10"),
        },
      ]);

      const result = await service.getUserReputation("guser");

      expect(result.trustScore).toBe(48);
      expect(result.history).toHaveLength(1);
      expect(result.history[0]!.impact).toBe(-2);
      expect(result.history[0]!.event).not.toMatch(/against you/);
    });

    it("should compute success rate correctly", async () => {
      setMockTrades([
        makeTrade({ buyerAddress: "guser", status: TradeStatus.COMPLETED }),
        makeTrade({ buyerAddress: "guser", status: TradeStatus.COMPLETED }),
        makeTrade({ buyerAddress: "guser", status: TradeStatus.DISPUTED }),
        makeTrade({ buyerAddress: "guser", status: TradeStatus.FUNDED }),
      ]);
      setMockDisputes([]);

      const result = await service.getUserReputation("guser");

      expect(result.successRate).toBe(50);
      expect(result.totalTrades).toBe(4);
      expect(result.completedTrades).toBe(2);
    });

    it("should clamp trust score to 0-100 range", async () => {
      setMockTrades(
        Array.from({ length: 100 }, (_, i) =>
          makeTrade({ tradeId: `trade-${i}`, buyerAddress: "guser" }),
        ),
      );
      setMockDisputes([]);

      const result = await service.getUserReputation("guser");

      expect(result.trustScore).toBe(100);
    });

    it("should cap history at 20 entries", async () => {
      setMockTrades(
        Array.from({ length: 30 }, (_, i) =>
          makeTrade({ tradeId: `trade-${i}`, buyerAddress: "guser" }),
        ),
      );
      setMockDisputes([]);

      const result = await service.getUserReputation("guser");

      expect(result.history.length).toBeLessThanOrEqual(20);
    });

    it("should handle seller role correctly in history", async () => {
      setMockTrades([
        makeTrade({
          tradeId: "trade-seller",
          buyerAddress: "gbuyer",
          sellerAddress: "guser",
        }),
      ]);
      setMockDisputes([]);

      const result = await service.getUserReputation("guser");

      expect(result.history[0]!.event).toContain("seller");
    });

    it("should handle buyer role correctly in history", async () => {
      setMockTrades([
        makeTrade({
          tradeId: "trade-buyer",
          buyerAddress: "guser",
          sellerAddress: "gseller",
        }),
      ]);
      setMockDisputes([]);

      const result = await service.getUserReputation("guser");

      expect(result.history[0]!.event).toContain("buyer");
    });

    it("uses one bounded OR query for recent trade history", async () => {
      setMockTrades([makeTrade({ buyerAddress: "guser" })]);
      setMockDisputes([]);

      await service.getUserReputation("GUSER");

      expect(mockPrisma.trade.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.trade.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ buyerAddress: "guser" }, { sellerAddress: "guser" }],
          }),
          take: 5,
        }),
      );
    });
  });
});
