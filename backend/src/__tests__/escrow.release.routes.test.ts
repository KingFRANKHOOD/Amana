import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createEscrowReleaseRouter } from "../routes/escrow.release.routes";
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

describe("Escrow milestone release route", () => {
  const buyerAddress = StellarSdk.Keypair.random().publicKey();
  const sellerAddress = StellarSdk.Keypair.random().publicKey();
  let token: string;

  const mockPrisma = {
    trade: { findFirst: jest.fn() },
    escrowReleaseMilestone: { findMany: jest.fn() },
  } as any;
  const contractService = {
    buildReleaseMilestoneTx: jest.fn(),
  };

  const app = express();
  app.use(express.json());
  app.use("/trades", createEscrowReleaseRouter(mockPrisma, contractService as any));
  app.use(errorHandler);

  beforeAll(() => {
    const now = Math.floor(Date.now() / 1000);
    token = jwt.sign(
      {
        walletAddress: buyerAddress,
        jti: "escrow-release-jti",
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

  it("returns unsigned XDR for a due milestone", async () => {
    mockPrisma.escrowReleaseMilestone.findMany.mockResolvedValue([
      {
        milestoneIndex: 0,
        dueAt: new Date(Date.now() - 60_000),
        releasedAt: null,
      },
    ]);
    contractService.buildReleaseMilestoneTx.mockResolvedValue({ unsignedXdr: "AAAA-partial-xdr" });

    const res = await request(app)
      .post("/trades/4294967297/release/milestone")
      .set("Authorization", `Bearer ${token}`)
      .send({ milestoneIndex: 0 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unsignedXdr: "AAAA-partial-xdr" });
    expect(contractService.buildReleaseMilestoneTx).toHaveBeenCalledWith({
      tradeId: "4294967297",
      sourceAddress: buyerAddress,
      milestoneIndex: 0,
    });
  });

  it("rejects an early milestone with a clear error", async () => {
    mockPrisma.escrowReleaseMilestone.findMany.mockResolvedValue([
      {
        milestoneIndex: 0,
        dueAt: new Date(Date.now() + 60_000),
        releasedAt: null,
      },
    ]);

    const res = await request(app)
      .post("/trades/4294967297/release/milestone")
      .set("Authorization", `Bearer ${token}`)
      .send({ milestoneIndex: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Milestone is not due yet");
    expect(contractService.buildReleaseMilestoneTx).not.toHaveBeenCalled();
  });

  it("rejects a completed schedule", async () => {
    mockPrisma.escrowReleaseMilestone.findMany.mockResolvedValue([
      {
        milestoneIndex: 0,
        dueAt: new Date(Date.now() - 60_000),
        releasedAt: new Date(),
      },
      {
        milestoneIndex: 1,
        dueAt: new Date(Date.now() - 60_000),
        releasedAt: new Date(),
      },
    ]);

    const res = await request(app)
      .post("/trades/4294967297/release/milestone")
      .set("Authorization", `Bearer ${token}`)
      .send({ milestoneIndex: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Release schedule is already completed");
    expect(contractService.buildReleaseMilestoneTx).not.toHaveBeenCalled();
  });
});
