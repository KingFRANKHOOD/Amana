process.env.JWT_SECRET = "a".repeat(32);
process.env.JWT_ISSUER = "amana";
process.env.JWT_AUDIENCE = "amana-api";
process.env.DATABASE_URL = "postgres://dummy";

import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";
import { createApp } from "../app";
import { AuthService } from "../services/auth.service";
import { prisma } from "../lib/db";

jest.mock("../lib/db");
jest.mock("../services/auth.service");

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
      expect(response.body).toHaveProperty("secret");
      expect(response.body.url).toBe("https://example.com/webhook");
      expect(response.body.events).toEqual(["trade.created", "trade.completed"]);
      expect(prisma.webhookSubscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://example.com/webhook",
          events: ["trade.created", "trade.completed"],
          userId: mockUserId,
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
      expect(response.body).toHaveProperty("secret");
      expect(prisma.webhookSubscription.create).toHaveBeenCalled();
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

      const response = await request(app)
        .get("/webhooks")
        .set("Authorization", "Bearer valid.jwt.token");

      expect(response.status).toBe(200);
      expect(response.body.webhooks).toHaveLength(2);
      expect(prisma.webhookSubscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: mockUserId },
        })
      );
    });

    it("should return 401 if not authenticated", async () => {
      const response = await request(app).get("/webhooks");

      expect(response.status).toBe(401);
    });
  });

  describe("DELETE /webhooks/:id", () => {
    it("should delete a webhook owned by the user", async () => {
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

      (prisma.webhookSubscription.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        url: "https://example.com/webhook",
        events: ["trade.created"],
        secretHash: "hashedsecret",
        isActive: true,
        userId: mockUserId,
        createdAt: new Date(),
      });

      (prisma.webhookSubscription.delete as jest.Mock).mockResolvedValue({});

      const response = await request(app)
        .delete("/webhooks/1")
        .set("Authorization", "Bearer valid.jwt.token");

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Webhook deleted successfully");
      expect(prisma.webhookSubscription.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it("should return 404 if webhook not found", async () => {
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

      (prisma.webhookSubscription.findUnique as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .delete("/webhooks/999")
        .set("Authorization", "Bearer valid.jwt.token");

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Webhook not found");
    });

    it("should return 403 if webhook belongs to another user", async () => {
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

      (prisma.webhookSubscription.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        url: "https://example.com/webhook",
        events: ["trade.created"],
        secretHash: "hashedsecret",
        isActive: true,
        userId: 999, // Different user
        createdAt: new Date(),
      });

      const response = await request(app)
        .delete("/webhooks/1")
        .set("Authorization", "Bearer valid.jwt.token");

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Forbidden");
    });

    it("should return 401 if not authenticated", async () => {
      const response = await request(app).delete("/webhooks/1");

      expect(response.status).toBe(401);
    });

    it("should return 400 for invalid webhook ID", async () => {
      (AuthService.validateToken as jest.Mock).mockResolvedValue({
        sub: mockWallet.toLowerCase(),
        walletAddress: mockWallet.toLowerCase(),
        jti: "test-jti",
      });
      (AuthService.isTokenRevoked as jest.Mock).mockResolvedValue(false);

      const response = await request(app)
        .delete("/webhooks/invalid")
        .set("Authorization", "Bearer valid.jwt.token");

      expect(response.status).toBe(400);
    });
  });
});
