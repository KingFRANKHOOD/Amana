import request from "supertest";
import express from "express";
import { createAdminRetentionRouter } from "../routes/admin.retention.routes";
import { dataRetentionService } from "../services/dataRetention.service";
import { dataArchivalService } from "../services/dataArchival.service";
import { storageMonitoringService } from "../services/storageMonitoring.service";

jest.mock("../middleware/auth.middleware", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 1, walletAddress: "GBADMIN123" };
    next();
  },
}));

jest.mock("../middleware/admin.middleware", () => ({
  adminMiddleware: (_req: any, _res: any, next: any) => next(),
}));

jest.mock("../services/dataRetention.service");
jest.mock("../services/dataArchival.service");
jest.mock("../services/storageMonitoring.service");

describe("Admin Retention Routes", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(createAdminRetentionRouter());
  });

  describe("GET /admin/retention/policy", () => {
    it("returns retention policy settings", async () => {
      (dataRetentionService.getPolicyConfig as jest.Mock).mockReturnValue({
        refreshTokenRetentionDays: 7,
        notificationReadRetentionDays: 30,
        notificationUnreadRetentionDays: 90,
      });
      (dataRetentionService.getLastPruneResult as jest.Mock).mockReturnValue(null);

      const res = await request(app).get("/admin/retention/policy");
      expect(res.status).toBe(200);
      expect(res.body.policies.refreshTokenRetentionDays).toBe(7);
    });
  });

  describe("POST /admin/retention/cleanup", () => {
    it("executes synchronous cleanup and returns result", async () => {
      (dataRetentionService.runAllRetentionJobs as jest.Mock).mockResolvedValue({
        totalPruned: 42,
        durationMs: 150,
      });

      const res = await request(app).post("/admin/retention/cleanup");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("completed");
      expect(res.body.result.totalPruned).toBe(42);
    });
  });

  describe("GET /admin/retention/archives", () => {
    it("lists existing archives", async () => {
      (dataArchivalService.listArchives as jest.Mock).mockReturnValue([
        {
          archiveId: "trades_123",
          recordCount: 10,
          checksumSha256: "abc",
        },
      ]);

      const res = await request(app).get("/admin/retention/archives");
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.archives[0].archiveId).toBe("trades_123");
    });
  });

  describe("POST /admin/retention/archives/run", () => {
    it("triggers cold trades archival", async () => {
      (dataArchivalService.archiveColdTrades as jest.Mock).mockResolvedValue({
        archiveId: "trades_456",
        recordCount: 5,
        checksumSha256: "def",
      });

      const res = await request(app)
        .post("/admin/retention/archives/run")
        .send({ thresholdDays: 180 });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("archived");
      expect(res.body.archive.recordCount).toBe(5);
    });
  });

  describe("GET /admin/retention/archives/:id/verify", () => {
    it("verifies archive integrity", async () => {
      (dataArchivalService.verifyArchive as jest.Mock).mockReturnValue({
        isValid: true,
        recordCount: 5,
        checksumMatch: true,
      });

      const res = await request(app).get("/admin/retention/archives/trades_456/verify");
      expect(res.status).toBe(200);
      expect(res.body.isValid).toBe(true);
    });
  });

  describe("GET /admin/retention/storage", () => {
    it("returns storage growth snapshot", async () => {
      (storageMonitoringService.collectStorageMetrics as jest.Mock).mockResolvedValue({
        databaseSizeBytes: 5242880,
        tables: [{ tableName: "Trade", rowCount: 10, totalSizeBytes: 10240 }],
        archiveStorageSizeBytes: 1048576,
        archiveFilesCount: 3,
        collectedAt: new Date().toISOString(),
      });

      const res = await request(app).get("/admin/retention/storage");
      expect(res.status).toBe(200);
      expect(res.body.databaseSizeBytes).toBe(5242880);
      expect(res.body.tables.length).toBe(1);
    });
  });
});
