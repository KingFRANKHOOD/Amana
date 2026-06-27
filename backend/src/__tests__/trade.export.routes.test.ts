import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createTradeExportRouter } from "../routes/trade.export.routes";
import { AuthService } from "../services/auth.service";
import { errorHandler } from "../middleware/errorHandler";

jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const jwt = require("jsonwebtoken");
      return jwt.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

describe("Trade export route", () => {
  const userAddress = StellarSdk.Keypair.random().publicKey();
  const sellerAddress = StellarSdk.Keypair.random().publicKey();
  let token: string;
  const mockPrisma = {
    trade: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  } as any;

  const app = express();
  app.use(express.json());
  app.use("/trades", createTradeExportRouter(mockPrisma));
  app.use(errorHandler);

  const trade = {
    id: 1,
    tradeId: "4294967297",
    buyerAddress: userAddress,
    sellerAddress,
    amountUsdc: "100",
    status: "FUNDED",
    fundedAt: new Date("2026-06-01T00:00:00.000Z"),
    deliveredAt: null,
    completedAt: null,
    createdAt: new Date("2026-05-30T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
  };

  beforeAll(() => {
    const now = Math.floor(Date.now() / 1000);
    token = jwt.sign(
      {
        walletAddress: userAddress,
        jti: "trade-export-jti",
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
      },
      process.env.JWT_SECRET!,
      { algorithm: "HS256" },
    );
  });

  beforeEach(() => {
    jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
    jest.clearAllMocks();
  });

  it("exports CSV with a BOM and headers", async () => {
    mockPrisma.trade.findMany.mockResolvedValue([trade]);

    const res = await request(app)
      .get("/trades/export?format=csv")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text).toContain("\"tradeId\",\"buyerAddress\",\"sellerAddress\",\"amountUsdc\",\"status\"");
    expect(res.text).toContain("4294967297");
  });

  it("exports paginated JSON", async () => {
    mockPrisma.trade.findMany.mockResolvedValue([trade]);
    mockPrisma.trade.count.mockResolvedValue(1);

    const res = await request(app)
      .get("/trades/export?format=json&page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].tradeId).toBe("4294967297");
    expect(res.body.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
  });

  it("applies status and date filters", async () => {
    mockPrisma.trade.findMany.mockResolvedValue([trade]);
    mockPrisma.trade.count.mockResolvedValue(1);

    const res = await request(app)
      .get("/trades/export?format=json&status=FUNDED&dateFrom=2026-05-01T00:00:00.000Z&dateTo=2026-06-30T00:00:00.000Z")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(mockPrisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "FUNDED",
          createdAt: {
            gte: new Date("2026-05-01T00:00:00.000Z"),
            lte: new Date("2026-06-30T00:00:00.000Z"),
          },
        }),
      }),
    );
  });

  it("returns an empty JSON result", async () => {
    mockPrisma.trade.findMany.mockResolvedValue([]);
    mockPrisma.trade.count.mockResolvedValue(0);

    const res = await request(app)
      .get("/trades/export?format=json")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });
});
