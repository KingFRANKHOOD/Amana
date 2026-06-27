import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createNotificationPreferencesRouter } from "../routes/notifications.preferences.routes";
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

describe("Notification preferences route", () => {
  const userAddress = StellarSdk.Keypair.random().publicKey();
  let token: string;
  const mockPrisma = {
    notificationPreference: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  } as any;

  const app = express();
  app.use(express.json());
  app.use("/", createNotificationPreferencesRouter(mockPrisma));
  app.use(errorHandler);

  beforeAll(() => {
    const now = Math.floor(Date.now() / 1000);
    token = jwt.sign(
      {
        walletAddress: userAddress,
        jti: "notification-preferences-jti",
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

  it("reads persisted preferences", async () => {
    mockPrisma.notificationPreference.findUnique.mockResolvedValue({
      preferences: { trade_funded: ["email", "in-app"] },
    });

    const res = await request(app)
      .get("/notifications/preferences")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.preferences).toEqual({ trade_funded: ["email", "in-app"] });
  });

  it("updates preferences", async () => {
    mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);
    mockPrisma.notificationPreference.upsert.mockResolvedValue({
      preferences: { trade_funded: ["push"] },
    });

    const res = await request(app)
      .put("/notifications/preferences")
      .set("Authorization", `Bearer ${token}`)
      .send({ trade_funded: ["push"] });

    expect(res.status).toBe(200);
    expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userAddress },
      create: { userAddress, preferences: { trade_funded: ["push"] } },
      update: { preferences: { trade_funded: ["push"] } },
    });
    expect(res.body.preferences).toEqual({ trade_funded: ["push"] });
  });

  it("merges partial updates with existing preferences", async () => {
    mockPrisma.notificationPreference.findUnique.mockResolvedValue({
      preferences: {
        trade_funded: ["email"],
        trade_delivered: ["in-app"],
      },
    });
    mockPrisma.notificationPreference.upsert.mockImplementation(async (args: any) => ({
      preferences: args.update.preferences,
    }));

    const res = await request(app)
      .put("/notifications/preferences")
      .set("Authorization", `Bearer ${token}`)
      .send({ trade_funded: ["push"] });

    expect(res.status).toBe(200);
    expect(res.body.preferences).toEqual({
      trade_funded: ["push"],
      trade_delivered: ["in-app"],
    });
  });

  it("rejects an invalid channel", async () => {
    const res = await request(app)
      .put("/notifications/preferences")
      .set("Authorization", `Bearer ${token}`)
      .send({ trade_funded: ["sms"] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid enum value/i);
    expect(mockPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });
});
