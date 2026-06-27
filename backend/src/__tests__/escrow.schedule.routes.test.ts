import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createEscrowScheduleRouter } from "../routes/escrow.schedule.routes";
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

describe("Escrow schedule route", () => {
  const buyerAddress = StellarSdk.Keypair.random().publicKey();
  const sellerAddress = StellarSdk.Keypair.random().publicKey();
  let token: string;

  const mockPrisma = {
    trade: { findFirst: jest.fn() },
    escrowReleaseMilestone: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
  } as any;

  const app = express();
  app.use(express.json());
  app.use("/trades", createEscrowScheduleRouter(mockPrisma));
  app.use(errorHandler);

  beforeAll(() => {
    const now = Math.floor(Date.now() / 1000);
    token = jwt.sign(
      {
        walletAddress: buyerAddress,
        jti: "escrow-schedule-jti",
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
    mockPrisma.trade.findFirst.mockResolvedValue({
      tradeId: "4294967297",
      buyerAddress,
      sellerAddress,
      status: "FUNDED",
    });
  });

  const validMilestones = [
    {
      milestoneIndex: 0,
      amountUsdc: "5000.0000000",
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      conditionHash: "0xabc123",
    },
    {
      milestoneIndex: 1,
      amountUsdc: "5000.0000000",
      dueAt: new Date(Date.now() + 604800000).toISOString(),
    },
  ];

  describe("POST /trades/:id/schedule", () => {
    it("creates a release schedule for a funded trade", async () => {
      mockPrisma.escrowReleaseMilestone.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.escrowReleaseMilestone.create
        .mockResolvedValueOnce({
          id: 1,
          tradeId: "4294967297",
          milestoneIndex: 0,
          amountUsdc: "5000.0000000",
          dueAt: new Date(Date.now() + 86400000),
          conditionHash: "0xabc123",
          releasedAt: null,
        })
        .mockResolvedValueOnce({
          id: 2,
          tradeId: "4294967297",
          milestoneIndex: 1,
          amountUsdc: "5000.0000000",
          dueAt: new Date(Date.now() + 604800000),
          conditionHash: null,
          releasedAt: null,
        });

      const res = await request(app)
        .post("/trades/4294967297/schedule")
        .set("Authorization", `Bearer ${token}`)
        .send({ milestones: validMilestones });

      expect(res.status).toBe(201);
      expect(res.body.tradeId).toBe("4294967297");
      expect(res.body.milestoneCount).toBe(2);
      expect(res.body.milestones).toHaveLength(2);
      expect(res.body.milestones[0].conditionHash).toBe("0xabc123");
      expect(res.body.milestones[1].conditionHash).toBeNull();
      expect(res.body.nextReleaseDate).toBeDefined();
      expect(mockPrisma.escrowReleaseMilestone.deleteMany).toHaveBeenCalledWith({
        where: { tradeId: "4294967297" },
      });
    });

    it("returns 404 when trade is not found", async () => {
      mockPrisma.trade.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post("/trades/9999999999/schedule")
        .set("Authorization", `Bearer ${token}`)
        .send({ milestones: validMilestones });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Trade not found");
    });

    it("returns 400 when trade is not in CREATED or FUNDED status", async () => {
      mockPrisma.trade.findFirst.mockResolvedValue({
        tradeId: "4294967297",
        buyerAddress,
        sellerAddress,
        status: "COMPLETED",
      });

      const res = await request(app)
        .post("/trades/4294967297/schedule")
        .set("Authorization", `Bearer ${token}`)
        .send({ milestones: validMilestones });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("CREATED or FUNDED");
    });

    it("returns 400 for invalid milestone data", async () => {
      const res = await request(app)
        .post("/trades/4294967297/schedule")
        .set("Authorization", `Bearer ${token}`)
        .send({
          milestones: [{ milestoneIndex: -1, amountUsdc: "bad", dueAt: "not-a-date" }],
        });

      expect(res.status).toBe(400);
    });

    it("returns 400 when milestones array is empty", async () => {
      const res = await request(app)
        .post("/trades/4294967297/schedule")
        .set("Authorization", `Bearer ${token}`)
        .send({ milestones: [] });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /trades/:id/schedule", () => {
    it("returns the release schedule with next release date", async () => {
      const futureDate = new Date(Date.now() + 86400000);
      const pastDate = new Date(Date.now() - 86400000);

      mockPrisma.escrowReleaseMilestone.findMany.mockResolvedValue([
        {
          milestoneIndex: 0,
          amountUsdc: "5000.0000000",
          dueAt: futureDate,
          conditionHash: "0xabc123",
          releasedAt: null,
        },
        {
          milestoneIndex: 1,
          amountUsdc: "5000.0000000",
          dueAt: pastDate,
          conditionHash: null,
          releasedAt: new Date(),
        },
      ]);

      const res = await request(app)
        .get("/trades/4294967297/schedule")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.tradeId).toBe("4294967297");
      expect(res.body.milestoneCount).toBe(2);
      expect(res.body.milestones).toHaveLength(2);
      expect(res.body.nextReleaseDate).toBeDefined();
      expect(res.body.milestones[0].released).toBe(false);
      expect(res.body.milestones[1].released).toBe(true);
    });

    it("returns empty schedule when no milestones exist", async () => {
      mockPrisma.escrowReleaseMilestone.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get("/trades/4294967297/schedule")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.milestoneCount).toBe(0);
      expect(res.body.milestones).toEqual([]);
      expect(res.body.nextReleaseDate).toBeNull();
    });

    it("returns 404 when trade is not found", async () => {
      mockPrisma.trade.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get("/trades/9999999999/schedule")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Trade not found");
    });
  });
});
