import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { PrismaClient } from "@prisma/client";
import { createNotificationsRouter } from "../routes/notifications.inapp.routes";
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
  inAppNotification: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
} as unknown as PrismaClient & {
  inAppNotification: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
};

const app = express();
app.use(express.json());
app.use("/", createNotificationsRouter(mockPrisma));
app.use(errorHandler);

describe("Notifications Route", () => {
  const userAddress = StellarSdk.Keypair.random().publicKey();
  const otherAddress = StellarSdk.Keypair.random().publicKey();
  let userToken: string;
  let otherToken: string;

  beforeAll(() => {
    const secret = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
    const now = Math.floor(Date.now() / 1000);
    userToken = jwt.sign(
      {
        walletAddress: userAddress,
        jti: "notifications-user-jti",
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
        jti: "notifications-other-jti",
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

  describe("GET /notifications", () => {
    it("returns paginated notifications", async () => {
      mockPrisma.inAppNotification.findMany.mockResolvedValue([
        {
          id: 1,
          title: "Trade completed",
          message: "Your trade #123 has been completed",
          type: "trade_update",
          isRead: false,
          metadata: { tradeId: "123" },
          createdAt: new Date("2025-01-02T00:00:00Z"),
        },
        {
          id: 2,
          title: "Dispute opened",
          message: "A dispute has been opened on trade #456",
          type: "dispute",
          isRead: true,
          metadata: { tradeId: "456" },
          createdAt: new Date("2025-01-01T00:00:00Z"),
        },
      ]);
      mockPrisma.inAppNotification.count
        .mockResolvedValueOnce(2) // total for current filter
        .mockResolvedValueOnce(1); // unreadCount

      const res = await request(app)
        .get("/notifications")
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.notifications).toHaveLength(2);
      expect(res.body.notifications[0]).toEqual({
        id: 1,
        title: "Trade completed",
        message: "Your trade #123 has been completed",
        type: "trade_update",
        isRead: false,
        metadata: { tradeId: "123" },
        createdAt: "2025-01-02T00:00:00.000Z",
      });
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
      expect(res.body.unreadCount).toBe(1);
    });

    it("filters by unreadOnly when query param is true", async () => {
      mockPrisma.inAppNotification.findMany.mockResolvedValue([
        {
          id: 1,
          title: "Trade completed",
          message: "Your trade #123 has been completed",
          type: "trade_update",
          isRead: false,
          metadata: null,
          createdAt: new Date("2025-01-02T00:00:00Z"),
        },
      ]);
      mockPrisma.inAppNotification.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1);

      const res = await request(app)
        .get("/notifications?unreadOnly=true")
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.notifications).toHaveLength(1);
      expect(mockPrisma.inAppNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userAddress: userAddress, isRead: false },
        }),
      );
    });

    it("returns empty list when no notifications exist", async () => {
      mockPrisma.inAppNotification.findMany.mockResolvedValue([]);
      mockPrisma.inAppNotification.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const res = await request(app)
        .get("/notifications")
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.notifications).toEqual([]);
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
      expect(res.body.unreadCount).toBe(0);
    });

    it("returns 401 without auth", async () => {
      const res = await request(app).get("/notifications");
      expect(res.status).toBe(401);
    });
  });

  describe("PATCH /notifications/:id/read", () => {
    it("marks a notification as read", async () => {
      mockPrisma.inAppNotification.findUnique.mockResolvedValue({
        id: 1,
        userAddress,
        isRead: false,
      });
      mockPrisma.inAppNotification.update.mockResolvedValue({
        id: 1,
        isRead: true,
      });

      const res = await request(app)
        .patch("/notifications/1/read")
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Notification marked as read");
      expect(mockPrisma.inAppNotification.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { isRead: true },
      });
    });

    it("returns 200 when notification is already read (idempotent)", async () => {
      mockPrisma.inAppNotification.findUnique.mockResolvedValue({
        id: 1,
        userAddress,
        isRead: true,
      });

      const res = await request(app)
        .patch("/notifications/1/read")
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Notification already marked as read");
      expect(mockPrisma.inAppNotification.update).not.toHaveBeenCalled();
    });

    it("returns 404 for non-existent notification", async () => {
      mockPrisma.inAppNotification.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .patch("/notifications/999/read")
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Notification not found");
    });

    it("returns 403 when notification belongs to another user", async () => {
      mockPrisma.inAppNotification.findUnique.mockResolvedValue({
        id: 1,
        userAddress,
        isRead: false,
      });

      const res = await request(app)
        .patch("/notifications/1/read")
        .set("Authorization", `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Forbidden: you do not own this notification");
    });
  });

  describe("POST /notifications/read-all", () => {
    it("marks all unread notifications as read", async () => {
      mockPrisma.inAppNotification.updateMany.mockResolvedValue({
        count: 3,
      });

      const res = await request(app)
        .post("/notifications/read-all")
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("All notifications marked as read");
      expect(res.body.count).toBe(3);
      expect(mockPrisma.inAppNotification.updateMany).toHaveBeenCalledWith({
        where: { userAddress, isRead: false },
        data: { isRead: true },
      });
    });

    it("returns count 0 when no unread notifications exist", async () => {
      mockPrisma.inAppNotification.updateMany.mockResolvedValue({
        count: 0,
      });

      const res = await request(app)
        .post("/notifications/read-all")
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
    });
  });
});
