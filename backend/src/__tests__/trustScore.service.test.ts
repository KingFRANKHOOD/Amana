import { TrustScoreService } from "../services/trustScore.service";

const TradeStatus = {
  COMPLETED: "COMPLETED",
  DISPUTED: "DISPUTED",
  FUNDED: "FUNDED",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
  CREATED: "CREATED",
} as const;

const DisputeStatus = {
  RESOLVED: "RESOLVED",
  CLOSED: "CLOSED",
  OPEN: "OPEN",
} as const;

describe("TrustScoreService", () => {
  let mockPrisma: {
    user: { findUnique: jest.Mock };
    trade: { aggregate: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
    dispute: { aggregate: jest.Mock; findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let service: TrustScoreService;

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
    mockPrisma.trade.findFirst.mockImplementation(({ where }: any) => {
      const trades = allTrades.filter((trade) => matchesTradeWhere(trade, where)) as any[];
      const latest = trades.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
      return Promise.resolve(latest ? { updatedAt: latest.updatedAt } : null);
    });
    mockPrisma.$queryRaw.mockResolvedValue([{
      totalVolumeUsdc: String(allTrades.reduce((sum, trade: any) => sum + Number(trade.amountUsdc), 0)),
    }]);
  }

  function setMockDisputes(disputes: Record<string, unknown>[]) {
    allDisputes.length = 0;
    allDisputes.push(...disputes);
    mockPrisma.dispute.aggregate.mockImplementation(({ where }: any) =>
      Promise.resolve({
        _count: { _all: allDisputes.filter((dispute: any) => dispute.initiator === where.initiator).length },
      }),
    );
    mockPrisma.dispute.findMany.mockImplementation(({ where, take }: any) =>
      Promise.resolve(
        allDisputes.filter((dispute: any) => dispute.initiator === where.initiator).slice(0, take),
      ),
    );
  }

  function makeTrade(overrides: Record<string, unknown> = {}) {
    const now = new Date();
    return {
      tradeId: overrides.tradeId ?? "trade-001",
      buyerAddress: overrides.buyerAddress ?? "gbuyer",
      sellerAddress: overrides.sellerAddress ?? "gseller",
      amountUsdc: overrides.amountUsdc ?? "1000",
      status: overrides.status ?? TradeStatus.COMPLETED,
      createdAt: overrides.createdAt ?? new Date(now.getTime() - 86400000),
      completedAt: overrides.completedAt ?? new Date(),
      updatedAt: overrides.updatedAt ?? new Date(),
    };
  }

  beforeEach(() => {
    mockPrisma = {
      user: { findUnique: jest.fn() },
      trade: { aggregate: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
      dispute: { aggregate: jest.fn(), findMany: jest.fn() },
      $queryRaw: jest.fn(),
    };
    setMockDisputes([]);
    service = new TrustScoreService(mockPrisma as any);
  });

  describe("calculateTrustScore", () => {
    it("should return full structure with no trades", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      setMockTrades([]);
      setMockDisputes([]);

      const result = await service.calculateTrustScore("guser");

      expect(result).toHaveProperty("trustScore");
      expect(result).toHaveProperty("breakdown");
      expect(result).toHaveProperty("stats");
      expect(result).toHaveProperty("tier");
      expect(result).toHaveProperty("history");
      expect(result.trustScore).toBe(50);
      expect(result.tier).toBe("developing");
    });

    it("should calculate trust score with completed trades", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        walletAddress: "guser",
        createdAt: new Date(Date.now() - 30 * 86400000),
      });
      setMockTrades([
        makeTrade({ tradeId: "t1", buyerAddress: "guser" }),
        makeTrade({ tradeId: "t2", buyerAddress: "guser" }),
      ]);
      setMockDisputes([]);

      const result = await service.calculateTrustScore("guser");

      expect(result.trustScore).toBeGreaterThan(50);
      expect(result.stats.totalTrades).toBe(2);
      expect(result.stats.completedTrades).toBe(2);
      expect(result.stats.successRate).toBe(100);
    });

    it("should apply dispute penalties", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        walletAddress: "guser",
        createdAt: new Date(Date.now() - 30 * 86400000),
      });
      setMockTrades([
        makeTrade({ tradeId: "t1", buyerAddress: "guser" }),
      ]);
      setMockDisputes([
        {
          id: 1,
          tradeId: "t1",
          status: DisputeStatus.RESOLVED,
          initiator: "guser",
          createdAt: new Date(),
        },
      ]);

      const result = await service.calculateTrustScore("guser");

      expect(result.breakdown.disputePenalty).toBeGreaterThan(0);
    });

    it.each([DisputeStatus.RESOLVED, DisputeStatus.CLOSED])(
      "does not label a %s dispute as lost without a recorded outcome (issue #1400)",
      async (status) => {
        mockPrisma.user.findUnique.mockResolvedValue({
          walletAddress: "guser",
          createdAt: new Date(Date.now() - 30 * 86400000),
        });
        setMockTrades([]);
        setMockDisputes([
          {
            id: 1,
            tradeId: "t1-dispute",
            status,
            initiator: "guser",
            createdAt: new Date(),
          },
        ]);

        const result = await service.calculateTrustScore("guser");
        const disputeEvent = result.history.find((event) => event.id === "dispute-1");

        expect(disputeEvent).toBeDefined();
        expect(disputeEvent!.type).toBe("dispute_initiated");
        expect(disputeEvent!.impact).toBe(-2);
        expect(disputeEvent!.event).not.toMatch(/against you/);
        expect(result.history.some((event) => event.type === "dispute_lost")).toBe(false);
      },
    );

    it("should return elite tier for high scores with custom config", async () => {
      const serviceHigh = new TrustScoreService(mockPrisma as any, {
        baseScore: 90,
        tradeCompletionPoints: 0,
        disputeInitiatedPenalty: 0,
        disputeLostPenalty: 0,
      });

      mockPrisma.user.findUnique.mockResolvedValue({
        walletAddress: "guser",
        createdAt: new Date(Date.now() - 30 * 86400000),
      });
      setMockTrades([]);
      setMockDisputes([]);

      const result = await serviceHigh.calculateTrustScore("guser");

      expect(result.tier).toBe("elite");
    });

    it("should calculate volume bonus correctly", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        walletAddress: "guser",
        createdAt: new Date(Date.now() - 30 * 86400000),
      });
      setMockTrades([
        makeTrade({ tradeId: "t1", buyerAddress: "guser", amountUsdc: "50000" }),
      ]);
      setMockDisputes([]);

      const result = await service.calculateTrustScore("guser");

      expect(result.breakdown.volumeBonus).toBeGreaterThanOrEqual(0);
    });

    it("should handle user with no trades gracefully", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      setMockTrades([]);
      setMockDisputes([]);

      const result = await service.calculateTrustScore("guser");

      expect(result.stats.lastTradeAt).toBeNull();
      expect(result.stats.accountAgeDays).toBe(0);
    });

    it("bounds activity data and combines buyer and seller lookups", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      setMockTrades([makeTrade({ buyerAddress: "guser" })]);
      setMockDisputes([]);

      await service.calculateTrustScore("GUSER");

      expect(mockPrisma.trade.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ buyerAddress: "guser" }, { sellerAddress: "guser" }] },
          take: 1000,
        }),
      );
      expect(mockPrisma.trade.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { buyerAddress: "guser" } }),
      );
    });
  });

  describe("getTrustTier", () => {
    it("should return newcomer for score below 35", () => {
      expect(service.getTrustTier(0)).toBe("newcomer");
      expect(service.getTrustTier(34)).toBe("newcomer");
    });

    it("should return developing for score 35-54", () => {
      expect(service.getTrustTier(35)).toBe("developing");
      expect(service.getTrustTier(54)).toBe("developing");
    });

    it("should return established for score 55-69", () => {
      expect(service.getTrustTier(55)).toBe("established");
      expect(service.getTrustTier(69)).toBe("established");
    });

    it("should return trusted for score 70-84", () => {
      expect(service.getTrustTier(70)).toBe("trusted");
      expect(service.getTrustTier(84)).toBe("trusted");
    });

    it("should return elite for score 85+", () => {
      expect(service.getTrustTier(85)).toBe("elite");
      expect(service.getTrustTier(100)).toBe("elite");
    });
  });
});
