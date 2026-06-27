import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { PrismaClient } from "@prisma/client";
import { createWebhookLogsRouter } from "../routes/webhooks.logs.routes";
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

const mockPrisma = {
  webhook: {
    findUnique: jest.fn(),
  },
  webhookDeliveryAttempt: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
} as unknown as PrismaClient & {
  webhook: { findUnique: jest.Mock };
  webhookDeliveryAttempt: { findMany: jest.Mock; count: jest.Mock };
};

const app = express();
app.use(express.json());
app.use("/", createWebhookLogsRouter(mockPrisma));
app.use(errorHandler);

describe("Webhook Logs Route", () => {
  const ownerAddress = StellarSdk.Keypair.random().publicKey();
  const otherAddress = StellarSdk.Keypair.random().publicKey();
  let ownerToken: string;
  let otherToken: string;

  beforeAll(() => {
    const secret = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
    const now = Math.floor(Date.now() / 1000);
    ownerToken = jwt.sign(
      {
        walletAddress: ownerAddress,
        jti: "webhook-logs-owner-jti",
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
      },
      secret,
      { algorithm: "HS256" },
    );
    otherToken = jwt.sign(
      {
        walletAddress: otherAddress,
        jti: "webhook-logs-other-jti",
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

  it("returns 200 with delivery attempts and pagination", async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue({
      id: 1,
      userAddress: ownerAddress,
    });
    mockPrisma.webhookDeliveryAttempt.findMany.mockResolvedValue([
      {
        timestamp: new Date("2025-01-01T00:00:00Z"),
        status: "success",
        statusCode: 200,
        responseBody: '{"ok":true}',
      },
      {
        timestamp: new Date("2025-01-02T00:00:00Z"),
        status: "failure",
        statusCode: 500,
        responseBody: null,
      },
    ]);
    mockPrisma.webhookDeliveryAttempt.count.mockResolvedValue(2);

    const res = await request(app)
      .get("/webhooks/1/logs")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.attempts).toHaveLength(2);
    expect(res.body.attempts[0]).toEqual({
      timestamp: "2025-01-01T00:00:00.000Z",
      status: "success",
      statusCode: 200,
      responseBody: '{"ok":true}',
    });
    expect(res.body.attempts[1]).toEqual({
      timestamp: "2025-01-02T00:00:00.000Z",
      status: "failure",
      statusCode: 500,
      responseBody: null,
    });
    expect(res.body.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 2,
      totalPages: 1,
    });
  });

  it("returns 401 without Authorization header", async () => {
    const res = await request(app).get("/webhooks/1/logs");

    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent webhook", async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get("/webhooks/999/logs")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Webhook not found");
  });

  it("returns 403 when caller is not the webhook owner", async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue({
      id: 1,
      userAddress: ownerAddress,
    });

    const res = await request(app)
      .get("/webhooks/1/logs")
      .set("Authorization", `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden: you do not own this webhook");
  });

  it("returns empty attempts list when no deliveries exist", async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue({
      id: 1,
      userAddress: ownerAddress,
    });
    mockPrisma.webhookDeliveryAttempt.findMany.mockResolvedValue([]);
    mockPrisma.webhookDeliveryAttempt.count.mockResolvedValue(0);

    const res = await request(app)
      .get("/webhooks/1/logs")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.attempts).toEqual([]);
    expect(res.body.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it("respects pagination query parameters", async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue({
      id: 1,
      userAddress: ownerAddress,
    });

    const allAttempts = Array.from({ length: 25 }, (_, i) => ({
      timestamp: new Date(`2025-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      status: "success",
      statusCode: 200,
      responseBody: null,
    }));

    mockPrisma.webhookDeliveryAttempt.findMany.mockImplementation(
      ({ skip, take }: { skip: number; take: number }) =>
        Promise.resolve(allAttempts.slice(skip, skip + take)),
    );
    mockPrisma.webhookDeliveryAttempt.count.mockResolvedValue(25);

    const res = await request(app)
      .get("/webhooks/1/logs?page=2&limit=10")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.attempts).toHaveLength(10);
    expect(res.body.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 25,
      totalPages: 3,
    });
  });
});
