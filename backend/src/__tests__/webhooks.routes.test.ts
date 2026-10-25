process.env.JWT_SECRET = "a".repeat(32);
process.env.JWT_ISSUER = "amana";
process.env.JWT_AUDIENCE = "amana-api";
process.env.DATABASE_URL = "postgres://dummy";
process.env.STELLAR_NETWORK = "testnet";

import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";
import { createApp } from "../app";
import { AuthService } from "../services/auth.service";
import { prisma } from "../lib/db";

jest.mock("../lib/db", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    webhookSubscription: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    webhookDeadLetter: {
      create: jest.fn(),
    },
  },
}));
jest.mock("../services/auth.service");
jest.mock("../jobs/queue", () => ({
  notificationQueue: { add: jest.fn() },
  evidenceVerificationQueue: { add: jest.fn() },
  exportQueue: { add: jest.fn() },
  webhookQueue: { add: jest.fn() },
  trustScoreQueue: { add: jest.fn() },
}));
jest.mock("dns/promises", () => ({
  __esModule: true,
  lookup: jest.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
}));
jest.mock("../services/feature-flags.service", () => ({
  featureFlagService: { isEnabled: jest.fn().mockResolvedValue(false) },
}));

describe("Webhooks Routes", () => {
  let app: any;
  const mockWallet = Keypair.random().publicKey();
  const mockUserId = 1;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /webhooks", () => {
    it("should register a webhook with auto-generated secret", async () => {
      (AuthService.validateToken as jest.Mock).mockResolvedValue({
        sub: mockWallet.toLowerCase(),
        walletAddress: mockWallet.toLowerCase(),
        jti: "test-jti",
      });
      (AuthService.isTokenRevoked as jest.Mock).mockResolvedValue(false);

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: mockUserId,
        walletAddress: mockWallet.toLowerCase(),
      });

      (prisma.webhookSubscription.create as jest.Mock).mockResolvedValue({
        id: 1,
        url: "https://example.com/webhook",
        events: ["trade.created", "trade.completed"],
        secretHash: "hashedsecret123",
        isActive: true,
        userId: mockUserId,
        createdAt: new Date(),
      });

      const response = await request(app)
        .post("/webhooks")
        .set("Authorization", "Bearer valid.jwt.token")
        .send({
          url: "https://example.com/webhook",
          events: ["trade.created", "trade.completed"],
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("id");
      expect(response.body).not.toHaveProperty("secret");
      expect(response.headers["x-webhook-secret"]).toBeDefined();
      expect(response.headers["x-webhook-secret-warning"]).toBe("shown-only-once");
      expect(response.body.warning).toContain("shown only once");
      expect(response.body.url).toBe("https://example.com/webhook");
      expect(response.body.events).toEqual(["trade.created", "trade.completed"]);
      expect(prisma.webhookSubscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            url: "https://example.com/webhook",
            events: ["trade.created", "trade.completed"],
            userId: mockUserId,
            secretHash: expect.any(String),
          }),
        })
      );
    });

    it("should register a webhook with provided secret", async () => {
      (AuthService.validateToken as jest.Mock).mockResolvedValue({
        sub: mockWallet.toLowerCase(),
        walletAddress: mockWallet.toLowerCase(),
        jti: "test-jti",
      });
      (AuthService.isTokenRevoked as jest.Mock).mockResolvedValue(false);

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: mockUserId,
        walletAddress: mockWallet.toLowerCase(),
      });

      (prisma.webhookSubscription.create as jest.Mock).mockResolvedValue({
        id: 2,
        url: "https://example.com/webhook",
        events: ["trade.created"],
        secretHash: "hashedcustomsecret",
        isActive: true,
        userId: mockUserId,
        createdAt: new Date(),
      });

      const response = await request(app)
        .post("/webhooks")
        .set("Authorization", "Bearer valid.jwt.token")
        .send({
          url: "https://example.com/webhook",
          events: ["trade.created"],
          secret: "custom-secret",
        });

      expect(response.status).toBe(201);
      expect(response.body).not.toHaveProperty("secret");
      expect(response.headers["x-webhook-secret"]).toBe("custom-secret");
      expect(prisma.webhookSubscription.create).toHaveBeenCalled();
    });

    it("should not throw ReferenceError for undefined encryptSecret (regression #1397)", async () => {
      (AuthService.validateToken as jest.Mock).mockResolvedValue({
        sub: mockWallet.toLowerCase(),
        walletAddress: mockWallet.toLowerCase(),
        jti: "test-jti",
      });
      (AuthService.isTokenRevoked as jest.Mock).mockResolvedValue(false);

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: mockUserId,
        walletAddress: mockWallet.toLowerCase(),
      });

      (prisma.webhookSubscription.create as jest.Mock).mockResolvedValue({
        id: 3,
        url: "https://example.com/webhook",
        events: ["trade.created"],
        secretHash: "hashedsecret",
        isActive: true,
        userId: mockUserId,
        createdAt: new Date(),
      });

      const response = await request(app)
        .post("/webhooks")
        .set("Authorization", "Bearer valid.jwt.token")
        .send({
          url: "https://example.com/webhook",
          events: ["trade.created"],
        });

      expect(response.status).not.toBe(500);
      expect(response.status).toBe(201);
      expect(response.body.error).toBeUndefined();
      expect(prisma.webhookSubscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            secretHash: expect.any(String),
          }),
        })
      );
    });

    it("should return 400 for invalid URL", async () => {
      (AuthService.validateToken as jest.Mock).mockResolvedValue({
        sub: mockWallet.toLowerCase(),
        walletAddress: mockWallet.toLowerCase(),
        jti: "test-jti",
      });
      (AuthService.isTokenRevoked as jest.Mock).mockResolvedValue(false);

      const response = await request(app)
        .post("/webhooks")
        .set("Authorization", "Bearer valid.jwt.token")
        .send({
          url: "not-a-valid-url",
          events: ["trade.created"],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it("should return 400 for empty events array", async () => {
      (AuthService.validateToken as jest.Mock).mockResolvedValue({
        sub: mockWallet.toLowerCase(),
        walletAddress: mockWallet.toLowerCase(),
        jti: "test-jti",
      });
      (AuthService.isTokenRevoked as jest.Mock).mockResolvedValue(false);

      const response = await request(app)
        .post("/webhooks")
        .set("Authorization", "Bearer valid.jwt.token")
        .send({
          url: "https://example.com/webhook",
          events: [],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it("should return 401 if not authenticated", async () => {
      const response = await request(app)
        .post("/webhooks")
        .send({
          url: "https://example.com/webhook",
          events: ["trade.created"],
        });

      expect(response.status).toBe(401);
    });
  });

  describe("GET /webhooks", () => {
    it("should list all webhooks for authenticated user", async () => {
      (AuthService.validateToken as jest.Mock).mockResolvedValue({
        sub: mockWallet.toLowerCase(),
        walletAddress: mockWallet.toLowerCase(),
        jti: "test-jti",
      });
      (AuthService.isTokenRevoked as jest.Mock).mockResolvedValue(false);

      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: mockUserId,
        walletAddress: mockWallet.toLowerCase(),
      });

      (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: 1,
          url: "https://example.com/webhook1",
          events: ["trade.created"],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 2,
          url: "https://example.com/webhook2",
          events: ["trade.completed"],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      (prisma.webhookSubscription.count as jest.Mock).mockResolvedValue(2);

      const response = await request(app)
        .get("/webhooks")
        .set("Authorization", "Bearer valid.jwt.token");

      expect(response.status).toBe(200);
      expect(response.body.webhooks).toHaveLength(2);
      expect(response.body.pagination).toEqual(expect.objectContaining({ page: 1, limit: 20, total: 2 }));
      expect(prisma.webhookSubscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: mockUserId },
        })
      );
    });
  });
});
