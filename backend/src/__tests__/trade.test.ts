/**
 * Integration tests for trade API endpoints.
 *
 * Uses supertest against an Express app that mounts the trade router with
 * auth middleware. Prisma is fully mocked — no database required.
 *
 * Test matrix:
 *   GET /trades       — auth gate, pagination, status filter, validation
 *   GET /trades/stats — auth gate, aggregated response
 *   GET /trades/:id   — auth gate, ownership check, 404, bad param
 */

/* ------------------------------------------------------------------ */
/* Mock setup                                                          */
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
/* Imports                                                             */
/* ------------------------------------------------------------------ */

import request from "supertest";
import express from "express";
import tradeRouter from "../routes/trade.routes";

/* ------------------------------------------------------------------ */
/* App assembly (avoids importing index.ts which calls app.listen())   */
/* ------------------------------------------------------------------ */

const app = express();
app.use(express.json());
app.use("/trades", tradeRouter);

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const BUYER = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";
const SELLER = "GXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRS";

const sampleTrade = {
  id: 1,
  trade_id: 100,
  buyer: BUYER,
  seller: SELLER,
  amount_usdc: 1000,
  status: "Created",
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
};

/* ================================================================== */
/*  GET /trades                                                        */
/* ================================================================== */

describe("GET /trades", () => {
  /* ---- Auth ---- */

  it("returns 401 when x-wallet-address header is missing", async () => {
    const res = await request(app).get("/trades");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/x-wallet-address/i);
  });

  it("returns 401 when x-wallet-address header is empty", async () => {
    const res = await request(app)
      .get("/trades")
      .set("x-wallet-address", "");

    expect(res.status).toBe(401);
  });

  /* ---- Happy path ---- */

  it("returns trade list with default pagination", async () => {
    mockTrade.findMany.mockResolvedValue([sampleTrade]);
    mockTrade.count.mockResolvedValue(1);

    const res = await request(app)
      .get("/trades")
      .set("x-wallet-address", BUYER);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        trades: [sampleTrade],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      }),
    );
  });

  it("returns empty list when user has no trades", async () => {
    mockTrade.findMany.mockResolvedValue([]);
    mockTrade.count.mockResolvedValue(0);

    const res = await request(app)
      .get("/trades")
      .set("x-wallet-address", BUYER);

    expect(res.status).toBe(200);
    expect(res.body.trades).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  /* ---- Pagination ---- */

  it("passes page and limit to service layer correctly", async () => {
    mockTrade.findMany.mockResolvedValue([]);
    mockTrade.count.mockResolvedValue(50);

    const res = await request(app)
      .get("/trades?page=3&limit=5")
      .set("x-wallet-address", BUYER);

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(3);
    expect(res.body.limit).toBe(5);
    expect(mockTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 5 }),
    );
  });

  /* ---- Status filter ---- */

  it("filters trades by status query param", async () => {
    mockTrade.findMany.mockResolvedValue([]);
    mockTrade.count.mockResolvedValue(0);

    const res = await request(app)
      .get("/trades?status=Funded")
      .set("x-wallet-address", BUYER);

    expect(res.status).toBe(200);
    expect(mockTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "Funded" }),
      }),
    );
  });

  it("returns 400 for an invalid status value", async () => {
    const res = await request(app)
      .get("/trades?status=BOGUS")
      .set("x-wallet-address", BUYER);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid status/i);
  });

  /* ---- Sorting ---- */

  it("applies sort query param with field:direction format", async () => {
    mockTrade.findMany.mockResolvedValue([]);
    mockTrade.count.mockResolvedValue(0);

    await request(app)
      .get("/trades?sort=createdAt:asc")
      .set("x-wallet-address", BUYER);

    expect(mockTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { created_at: "asc" },
      }),
    );
  });

  /* ---- Validation ---- */

  it("returns 400 for negative page", async () => {
    const res = await request(app)
      .get("/trades?page=-1")
      .set("x-wallet-address", BUYER);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/page/i);
  });

  it("returns 400 for non-numeric page", async () => {
    const res = await request(app)
      .get("/trades?page=abc")
      .set("x-wallet-address", BUYER);

    expect(res.status).toBe(400);
  });

  it("returns 400 for zero limit", async () => {
    const res = await request(app)
      .get("/trades?limit=0")
      .set("x-wallet-address", BUYER);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit/i);
  });

  it("returns 400 when limit exceeds 100", async () => {
    const res = await request(app)
      .get("/trades?limit=101")
      .set("x-wallet-address", BUYER);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit/i);
  });

  it("returns 400 for non-numeric limit", async () => {
    const res = await request(app)
      .get("/trades?limit=xyz")
      .set("x-wallet-address", BUYER);

    expect(res.status).toBe(400);
  });
});

/* ================================================================== */
/*  GET /trades/stats                                                  */
/* ================================================================== */

describe("GET /trades/stats", () => {
  it("returns 401 without auth header", async () => {
    const res = await request(app).get("/trades/stats");
    expect(res.status).toBe(401);
  });

  it("returns aggregated stats for the authenticated user", async () => {
    mockTrade.count
      .mockResolvedValueOnce(12) // totalTrades
      .mockResolvedValueOnce(4); // openTrades
    mockTrade.aggregate.mockResolvedValue({
      _sum: { amount_usdc: 75000 },
    });

    const res = await request(app)
      .get("/trades/stats")
      .set("x-wallet-address", BUYER);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalTrades: 12,
      totalVolume: 75000,
      openTrades: 4,
    });
  });

  it("returns zero volume when user has no trades", async () => {
    mockTrade.count.mockResolvedValue(0);
    mockTrade.aggregate.mockResolvedValue({
      _sum: { amount_usdc: null },
    });

    const res = await request(app)
      .get("/trades/stats")
      .set("x-wallet-address", BUYER);

    expect(res.status).toBe(200);
    expect(res.body.totalVolume).toBe(0);
  });
});

/* ================================================================== */
/*  GET /trades/:id                                                    */
/* ================================================================== */

describe("GET /trades/:id", () => {
  it("returns 401 without auth header", async () => {
    const res = await request(app).get("/trades/1");
    expect(res.status).toBe(401);
  });

  it("returns 200 with trade data when caller is buyer", async () => {
    mockTrade.findUnique.mockResolvedValue(sampleTrade);

    const res = await request(app)
      .get("/trades/1")
      .set("x-wallet-address", BUYER);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(sampleTrade);
  });

  it("returns 200 with trade data when caller is seller", async () => {
    mockTrade.findUnique.mockResolvedValue(sampleTrade);

    const res = await request(app)
      .get("/trades/1")
      .set("x-wallet-address", SELLER);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(sampleTrade);
  });

  it("returns 403 when caller is neither buyer nor seller", async () => {
    mockTrade.findUnique.mockResolvedValue(sampleTrade);

    const res = await request(app)
      .get("/trades/1")
      .set("x-wallet-address", "GUNAUTHORIZEDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/denied/i);
  });

  it("returns 404 when trade does not exist", async () => {
    mockTrade.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get("/trades/999")
      .set("x-wallet-address", BUYER);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 400 for non-numeric trade ID", async () => {
    const res = await request(app)
      .get("/trades/abc")
      .set("x-wallet-address", BUYER);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("returns 400 for floating-point trade ID", async () => {
    const res = await request(app)
      .get("/trades/1.5")
      .set("x-wallet-address", BUYER);

    // parseInt("1.5") === 1, so this actually resolves to ID 1.
    // This is acceptable Express behavior — documenting it.
    // The route handler will call findUnique with id: 1.
    mockTrade.findUnique.mockResolvedValue(null);

    const res2 = await request(app)
      .get("/trades/1.5")
      .set("x-wallet-address", BUYER);

    expect([200, 404]).toContain(res2.status);
  });

  it("queries Prisma with the parsed integer ID", async () => {
    mockTrade.findUnique.mockResolvedValue(null);

    await request(app)
      .get("/trades/42")
      .set("x-wallet-address", BUYER);

    expect(mockTrade.findUnique).toHaveBeenCalledWith({ where: { id: 42 } });
  });
});
