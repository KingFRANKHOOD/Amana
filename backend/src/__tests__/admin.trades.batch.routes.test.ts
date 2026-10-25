import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { PrismaClient, TradeStatus } from "@prisma/client";
import { createAdminTradeBatchRouter } from "../routes/admin.trades.batch.routes";
import { AuthService } from "../services/auth.service";
import { errorHandler } from "../middleware/errorHandler";
import { auditLogService } from "../services/auditLog.service";
import { feeAccountingService } from "../services/feeAccounting.service";

jest.mock("../services/auditLog.service", () => ({
  auditLogService: { record: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("../services/feeAccounting.service", () => ({
  feeAccountingService: { recordFee: jest.fn().mockResolvedValue({}) },
}));

jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const jwt = require("jsonwebtoken");
      return jwt.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

const mockPrisma = {
  trade: {
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(mockPrisma)),
} as unknown as PrismaClient & {
  trade: { findFirst: jest.Mock; updateMany: jest.Mock };
};

const app = express();
app.use(express.json());
app.use("/", createAdminTradeBatchRouter(mockPrisma));
app.use(errorHandler);

describe("Admin Trade Batch Route", () => {
  const adminAddress = StellarSdk.Keypair.random().publicKey();
  const nonAdminAddress = StellarSdk.Keypair.random().publicKey();
  let adminToken: string;
  let nonAdminToken: string;

  beforeAll(() => {
    process.env.ADMIN_STELLAR_PUBKEYS = adminAddress;
    const secret = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
    const now = Math.floor(Date.now() / 1000);
    adminToken = jwt.sign(
      {
        walletAddress: adminAddress,
        jti: "batch-admin-jti",
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
      },
      secret,
      { algorithm: "HS256" },
    );
    nonAdminToken = jwt.sign(
      {
        walletAddress: nonAdminAddress,
        jti: "batch-nonadmin-jti",
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
      },
      secret,
      { algorithm: "HS256" },
    );
  });

  beforeEach(() => {
    jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns 200 with all succeeded when all transitions are valid", async () => {
    mockPrisma.trade.findFirst
      .mockResolvedValueOnce({ tradeId: "trade-1", status: TradeStatus.CREATED, version: 5 })
      .mockResolvedValueOnce({ tradeId: "trade-2", status: TradeStatus.FUNDED, version: 3 });
    mockPrisma.trade.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    const res = await request(app)
      .post("/admin/trades/batch/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        updates: [
          { tradeId: "trade-1", status: TradeStatus.CANCELLED },
          { tradeId: "trade-2", status: TradeStatus.CANCELLED },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toEqual(["trade-1", "trade-2"]);
    expect(res.body.failed).toEqual([]);
  });

  it("returns partial failures when some trades are not found or transitions are invalid", async () => {
    mockPrisma.trade.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ tradeId: "trade-2", status: TradeStatus.FUNDED, version: 1 })
      .mockResolvedValueOnce({ tradeId: "trade-3", status: TradeStatus.COMPLETED, version: 2 });
    mockPrisma.trade.updateMany
      .mockResolvedValueOnce({ count: 1 });

    const res = await request(app)
      .post("/admin/trades/batch/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        updates: [
          { tradeId: "unknown-trade", status: TradeStatus.CANCELLED },
          { tradeId: "trade-2", status: TradeStatus.CANCELLED },
          { tradeId: "trade-3", status: TradeStatus.CANCELLED },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toEqual(["trade-2"]);
    expect(res.body.failed).toHaveLength(2);
    expect(res.body.failed[0]).toEqual({
      tradeId: "unknown-trade",
      reason: "Trade not found",
    });
    expect(res.body.failed[1]).toEqual({
      tradeId: "trade-3",
      reason: "Invalid transition from COMPLETED to CANCELLED",
    });
  });

  it("handles concurrency conflicts", async () => {
    mockPrisma.trade.findFirst
      .mockResolvedValueOnce({ tradeId: "trade-1", status: TradeStatus.CREATED, version: 5 });
    mockPrisma.trade.updateMany
      .mockResolvedValueOnce({ count: 0 });

    const res = await request(app)
      .post("/admin/trades/batch/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        updates: [
          { tradeId: "trade-1", status: TradeStatus.CANCELLED },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toEqual([]);
    expect(res.body.failed).toEqual([
      { tradeId: "trade-1", reason: "Concurrency conflict: trade was modified" },
    ]);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post("/admin/trades/batch/status")
      .send({ updates: [{ tradeId: "trade-1", status: TradeStatus.CANCELLED }] });

    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin users", async () => {
    const res = await request(app)
      .post("/admin/trades/batch/status")
      .set("Authorization", `Bearer ${nonAdminToken}`)
      .send({ updates: [{ tradeId: "trade-1", status: TradeStatus.CANCELLED }] });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden: admin access required");
  });

  it("returns 400 for empty updates array", async () => {
    const res = await request(app)
      .post("/admin/trades/batch/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ updates: [] });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid status value", async () => {
    const res = await request(app)
      .post("/admin/trades/batch/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ updates: [{ tradeId: "trade-1", status: "INVALID_STATUS" }] });

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing tradeId", async () => {
    const res = await request(app)
      .post("/admin/trades/batch/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ updates: [{ status: TradeStatus.CANCELLED }] });

    expect(res.status).toBe(400);
  });

  it("records an audit log and platform fee when batch-completing a trade", async () => {
    mockPrisma.trade.findFirst.mockResolvedValueOnce({
      tradeId: "trade-9",
      status: TradeStatus.DELIVERED,
      version: 2,
      amountUsdc: "250.00",
    });
    mockPrisma.trade.updateMany.mockResolvedValueOnce({ count: 1 });

    const res = await request(app)
      .post("/admin/trades/batch/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ updates: [{ tradeId: "trade-9", status: TradeStatus.COMPLETED }] });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toEqual(["trade-9"]);
    expect(auditLogService.record).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        tradeId: "trade-9",
        toStatus: TradeStatus.COMPLETED,
        actor: adminAddress,
        metadata: { fromStatus: TradeStatus.DELIVERED },
      }),
    );
    expect(feeAccountingService.recordFee).toHaveBeenCalledWith(mockPrisma, "trade-9", "250.00");
  });

  it("does not record a fee for non-COMPLETED transitions", async () => {
    mockPrisma.trade.findFirst.mockResolvedValueOnce({
      tradeId: "trade-10",
      status: TradeStatus.CREATED,
      version: 1,
      amountUsdc: "10.00",
    });
    mockPrisma.trade.updateMany.mockResolvedValueOnce({ count: 1 });

    await request(app)
      .post("/admin/trades/batch/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ updates: [{ tradeId: "trade-10", status: TradeStatus.CANCELLED }] });

    expect(auditLogService.record).toHaveBeenCalledTimes(1);
    expect(feeAccountingService.recordFee).not.toHaveBeenCalled();
  });
});
