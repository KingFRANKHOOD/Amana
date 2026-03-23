/**
 * Unit tests for trade.service.ts
 *
 * Prisma singleton is mocked so no database connection is required.
 * Each public function (listUserTrades, getTradeById, getUserStats) is
 * exercised across normal, error, and boundary conditions.
 */

/* ------------------------------------------------------------------ */
/* Mock setup — must come before any import that transitively loads    */
/* ../config/prisma                                                   */
/* ------------------------------------------------------------------ */

const mockTrade = {
  findMany: jest.fn(),
  findUnique: jest.fn(),
  count: jest.fn(),
  aggregate: jest.fn(),
};

jest.mock("../config/prisma", () => ({
  __esModule: true,
  default: { trade: mockTrade },
}));

/* ------------------------------------------------------------------ */
/* Imports (after mock registration)                                   */
/* ------------------------------------------------------------------ */

import {
  listUserTrades,
  getTradeById,
  getUserStats,
  ValidationError,
} from "../services/trade.service";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const BUYER = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";
const SELLER = "GXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRS";
const THIRD_PARTY = "GTHIRDPARTYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

const baseTrade = {
  id: 1,
  trade_id: 100n,
  buyer: BUYER,
  seller: SELLER,
  amount_usdc: 1000,
  status: "Created",
  created_at: new Date("2024-01-01"),
  updated_at: new Date("2024-01-01"),
};

/* ------------------------------------------------------------------ */
/* listUserTrades                                                      */
/* ------------------------------------------------------------------ */

describe("listUserTrades", () => {
  it("returns paginated trades for the given address with default params", async () => {
    mockTrade.findMany.mockResolvedValue([baseTrade]);
    mockTrade.count.mockResolvedValue(1);

    const result = await listUserTrades(BUYER, {});

    expect(result).toEqual({
      trades: [baseTrade],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    // Default sort is created_at desc
    expect(mockTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { created_at: "desc" },
        skip: 0,
        take: 20,
      }),
    );
  });

  it("builds where clause with OR on buyer/seller", async () => {
    mockTrade.findMany.mockResolvedValue([]);
    mockTrade.count.mockResolvedValue(0);

    await listUserTrades(BUYER, {});

    const call = mockTrade.findMany.mock.calls[0][0];
    expect(call.where).toEqual(
      expect.objectContaining({
        OR: [{ buyer: BUYER }, { seller: BUYER }],
      }),
    );
  });

  it("applies status filter to where clause", async () => {
    mockTrade.findMany.mockResolvedValue([]);
    mockTrade.count.mockResolvedValue(0);

    await listUserTrades(BUYER, { status: "Funded" });

    const call = mockTrade.findMany.mock.calls[0][0];
    expect(call.where.status).toBe("Funded");
  });

  it("throws ValidationError for invalid status value", async () => {
    await expect(
      listUserTrades(BUYER, { status: "INVALID" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      listUserTrades(BUYER, { status: "INVALID" }),
    ).rejects.toThrow("Invalid status: INVALID");
  });

  it("respects page and limit parameters", async () => {
    mockTrade.findMany.mockResolvedValue([]);
    mockTrade.count.mockResolvedValue(50);

    const result = await listUserTrades(BUYER, { page: 3, limit: 10 });

    expect(result.page).toBe(3);
    expect(result.limit).toBe(10);
    expect(result.totalPages).toBe(5);
    expect(mockTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });

  it("clamps limit to max 100", async () => {
    mockTrade.findMany.mockResolvedValue([]);
    mockTrade.count.mockResolvedValue(0);

    const result = await listUserTrades(BUYER, { limit: 999 });

    expect(result.limit).toBe(100);
    expect(mockTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it("clamps limit minimum to 1", async () => {
    mockTrade.findMany.mockResolvedValue([]);
    mockTrade.count.mockResolvedValue(0);

    const result = await listUserTrades(BUYER, { limit: -5 });

    expect(result.limit).toBe(1);
  });

  it("clamps page minimum to 1", async () => {
    mockTrade.findMany.mockResolvedValue([]);
    mockTrade.count.mockResolvedValue(0);

    const result = await listUserTrades(BUYER, { page: -1 });

    expect(result.page).toBe(1);
    expect(mockTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 }),
    );
  });

  it("applies custom sort field and direction", async () => {
    mockTrade.findMany.mockResolvedValue([]);
    mockTrade.count.mockResolvedValue(0);

    await listUserTrades(BUYER, { sort: "amount_usdc:asc" });

    expect(mockTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { amount_usdc: "asc" },
      }),
    );
  });

  it("maps createdAt sort field to created_at column", async () => {
    mockTrade.findMany.mockResolvedValue([]);
    mockTrade.count.mockResolvedValue(0);

    await listUserTrades(BUYER, { sort: "createdAt:asc" });

    expect(mockTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { created_at: "asc" },
      }),
    );
  });

  it("defaults sort direction to desc when unspecified", async () => {
    mockTrade.findMany.mockResolvedValue([]);
    mockTrade.count.mockResolvedValue(0);

    await listUserTrades(BUYER, { sort: "updatedAt" });

    expect(mockTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { updated_at: "desc" },
      }),
    );
  });

  it("ignores unsortable fields and falls back to default", async () => {
    mockTrade.findMany.mockResolvedValue([]);
    mockTrade.count.mockResolvedValue(0);

    await listUserTrades(BUYER, { sort: "nonexistent:asc" });

    expect(mockTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { created_at: "desc" },
      }),
    );
  });

  it("computes totalPages correctly for partial last page", async () => {
    mockTrade.findMany.mockResolvedValue([]);
    mockTrade.count.mockResolvedValue(21);

    const result = await listUserTrades(BUYER, { limit: 10 });

    expect(result.totalPages).toBe(3); // ceil(21/10)
  });

  it("returns totalPages 0 when no trades exist", async () => {
    mockTrade.findMany.mockResolvedValue([]);
    mockTrade.count.mockResolvedValue(0);

    const result = await listUserTrades(BUYER, {});

    expect(result.totalPages).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* getTradeById                                                        */
/* ------------------------------------------------------------------ */

describe("getTradeById", () => {
  it("returns trade when caller is the buyer", async () => {
    mockTrade.findUnique.mockResolvedValue(baseTrade);

    const result = await getTradeById(1, BUYER);

    expect(result).toEqual({ trade: baseTrade, error: null });
    expect(mockTrade.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it("returns trade when caller is the seller", async () => {
    mockTrade.findUnique.mockResolvedValue(baseTrade);

    const result = await getTradeById(1, SELLER);

    expect(result).toEqual({ trade: baseTrade, error: null });
  });

  it("returns forbidden error when caller is a third party", async () => {
    mockTrade.findUnique.mockResolvedValue(baseTrade);

    const result = await getTradeById(1, THIRD_PARTY);

    expect(result).toEqual({ trade: null, error: "forbidden" });
  });

  it("returns not_found error when trade does not exist", async () => {
    mockTrade.findUnique.mockResolvedValue(null);

    const result = await getTradeById(999, BUYER);

    expect(result).toEqual({ trade: null, error: "not_found" });
  });

  it("queries by the exact numeric id", async () => {
    mockTrade.findUnique.mockResolvedValue(null);

    await getTradeById(42, BUYER);

    expect(mockTrade.findUnique).toHaveBeenCalledWith({ where: { id: 42 } });
  });
});

/* ------------------------------------------------------------------ */
/* getUserStats                                                        */
/* ------------------------------------------------------------------ */

describe("getUserStats", () => {
  it("returns aggregated stats for the given address", async () => {
    mockTrade.count
      .mockResolvedValueOnce(10) // totalTrades
      .mockResolvedValueOnce(3); // openTrades
    mockTrade.aggregate.mockResolvedValue({
      _sum: { amount_usdc: 50000 },
    });

    const stats = await getUserStats(BUYER);

    expect(stats).toEqual({
      totalTrades: 10,
      totalVolume: 50000,
      openTrades: 3,
    });
  });

  it("returns 0 volume when no trades exist", async () => {
    mockTrade.count.mockResolvedValue(0);
    mockTrade.aggregate.mockResolvedValue({
      _sum: { amount_usdc: null },
    });

    const stats = await getUserStats(BUYER);

    expect(stats.totalVolume).toBe(0);
    expect(stats.totalTrades).toBe(0);
    expect(stats.openTrades).toBe(0);
  });

  it("builds where clause scoped to the address", async () => {
    mockTrade.count.mockResolvedValue(0);
    mockTrade.aggregate.mockResolvedValue({ _sum: { amount_usdc: null } });

    await getUserStats(SELLER);

    // All three queries (count x2, aggregate) receive the same where clause
    for (const call of mockTrade.count.mock.calls) {
      const where = call[0].where;
      expect(where.OR).toEqual(
        expect.arrayContaining([
          { buyer: SELLER },
          { seller: SELLER },
        ]),
      );
    }
  });

  it("filters open trades by correct statuses", async () => {
    mockTrade.count.mockResolvedValue(0);
    mockTrade.aggregate.mockResolvedValue({ _sum: { amount_usdc: null } });

    await getUserStats(BUYER);

    // The second count call is for open trades
    const openCall = mockTrade.count.mock.calls[1][0];
    expect(openCall.where.status).toEqual({
      in: expect.arrayContaining(["Created", "Funded", "Delivered", "Disputed"]),
    });
    // Completed and Cancelled should NOT be in the open statuses
    expect(openCall.where.status.in).not.toContain("Completed");
    expect(openCall.where.status.in).not.toContain("Cancelled");
  });
});
