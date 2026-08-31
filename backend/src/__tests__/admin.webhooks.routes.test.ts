import request from "supertest";
import express from "express";
import { createAdminWebhooksRouter } from "../routes/admin.webhooks.routes";
import { webhookService } from "../services/webhook.service";

jest.mock("../services/webhook.service", () => ({
  webhookService: {
    isConfigured: jest.fn(),
  },
}));

jest.mock("../middleware/auth.middleware", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 1, walletAddress: "GBADMIN123" };
    next();
  },
}));

jest.mock("../middleware/admin.middleware", () => ({
  adminMiddleware: (_req: any, _res: any, next: any) => next(),
}));

jest.mock("../lib/db", () => ({
  prisma: {
    webhookSubscription: {
      count: jest.fn(),
    },
    webhookDeadLetter: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

const mockPrisma = require("../lib/db").prisma;

describe("Admin Webhooks Routes", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(createAdminWebhooksRouter());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /admin/webhooks/status", () => {
    it("returns webhook status summary", async () => {
      mockPrisma.webhookSubscription.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8);
      mockPrisma.webhookDeadLetter.count.mockResolvedValue(2);
      mockPrisma.webhookDeadLetter.findMany.mockResolvedValue([
        {
          id: 1,
          webhookUrl: "https://example.com/hook",
          event: "trade.created",
          tradeId: "trade-1",
          attempts: 3,
          lastError: "500",
          deadLetteredAt: new Date("2026-08-30T19:00:00Z"),
        },
      ]);

      const res = await request(app).get("/admin/webhooks/status");

      expect(res.status).toBe(200);
      expect(res.body.subscriptions.total).toBe(10);
      expect(res.body.subscriptions.active).toBe(8);
      expect(res.body.deadLetter.total).toBe(2);
      expect(res.body.deadLetter.recent).toHaveLength(1);
    });
  });

  describe("GET /admin/webhooks/dead-letters", () => {
    it("returns paginated dead-letter entries", async () => {
      mockPrisma.webhookDeadLetter.count.mockResolvedValue(1);
      mockPrisma.webhookDeadLetter.findMany.mockResolvedValue([
        {
          id: 1,
          webhookUrl: "https://example.com/hook",
          event: "trade.created",
          tradeId: "trade-1",
          attempts: 3,
          lastError: "500",
          deadLetteredAt: new Date("2026-08-30T19:00:00Z"),
        },
      ]);

      const res = await request(app).get("/admin/webhooks/dead-letters?page=1&limit=10");

      expect(res.status).toBe(200);
      expect(res.body.deadLetters).toHaveLength(1);
      expect(res.body.pagination.total).toBe(1);
    });

    it("filters by webhookUrl", async () => {
      mockPrisma.webhookDeadLetter.count.mockResolvedValue(1);
      mockPrisma.webhookDeadLetter.findMany.mockResolvedValue([]);

      const res = await request(app).get(
        "/admin/webhooks/dead-letters?webhookUrl=https://example.com/hook",
      );

      expect(res.status).toBe(200);
      expect(mockPrisma.webhookDeadLetter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            webhookUrl: expect.stringContaining("https://example.com/hook"),
          }),
        }),
      );
    });

    it("filters by tradeId", async () => {
      mockPrisma.webhookDeadLetter.count.mockResolvedValue(0);
      mockPrisma.webhookDeadLetter.findMany.mockResolvedValue([]);

      const res = await request(app).get(
        "/admin/webhooks/dead-letters?tradeId=trade-1",
      );

      expect(res.status).toBe(200);
      expect(mockPrisma.webhookDeadLetter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tradeId: "trade-1",
          }),
        }),
      );
    });
  });
});
