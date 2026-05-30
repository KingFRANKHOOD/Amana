import request from "supertest";
import { createApp } from "../app";

describe("GET /health", () => {
  describe("without Prisma client", () => {
    it("should return 200 with ok status when no DB configured", async () => {
      const app = createApp();
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: "ok",
        service: "amana-backend",
        db: "not_configured",
      });
      expect(res.body.timestamp).toBeDefined();
      expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    });
  });

  describe("with mocked Prisma client", () => {
    it("should return 200 with connected DB", async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
      };
      const app = createApp(mockPrisma as any);
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: "ok",
        db: "connected",
      });
    });

    it("should return 503 when DB is disconnected", async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockRejectedValue(new Error("connection failed")),
      };
      const app = createApp(mockPrisma as any);
      const res = await request(app).get("/health");

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        status: "degraded",
        db: "disconnected",
      });
    });

    it("should include valid ISO timestamp in all states", async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockRejectedValue(new Error("down")),
      };
      const app = createApp(mockPrisma as any);
      const res = await request(app).get("/health");

      expect(res.status).toBe(503);
      expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    });
  });

  const integrationDescribe = process.env.DATABASE_URL ? describe : describe.skip;
  integrationDescribe("integration with real database", () => {
    let prisma: any;

    beforeAll(async () => {
      const { prisma: db } = await import("../lib/db");
      prisma = db;
    });

    it("should return 200 with connected DB status", async () => {
      const app = createApp(prisma);
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: "ok",
        service: "amana-backend",
        db: "connected",
      });
      expect(res.body.timestamp).toBeDefined();
    });
  });
});
