import request from "supertest";
import express from "express";
import { createHealthRouter } from "../routes/health.routes";
import { HealthService } from "../services/health.service";

jest.mock("../services/health.service");

describe("GET /health/aggregate and /health/summary", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use("/health", createHealthRouter());
  });

  describe("GET /health/aggregate", () => {
    it("returns 200 with complete aggregated dependencies report when healthy", async () => {
      (HealthService.prototype.performAggregatedHealthCheck as jest.Mock).mockResolvedValue({
        status: "healthy",
        systemHealthScore: 100,
        timestamp: "2026-08-30T12:00:00.000Z",
        uptimeSeconds: 3600,
        version: "1.0.0",
        environment: "test",
        summary: {
          totalDependencies: 9,
          healthyCount: 9,
          degradedCount: 0,
          unhealthyCount: 0,
          criticalFailingCount: 0,
        },
        dependencies: {
          database: { name: "PostgreSQL Database", status: "healthy", isCritical: true, latencyMs: 5, message: "OK" },
          redis: { name: "Redis Cache", status: "healthy", isCritical: true, latencyMs: 2, message: "OK" },
          stellarRpc: { name: "Stellar RPC", status: "healthy", isCritical: true, latencyMs: 80, message: "OK" },
          eventIndexer: { name: "Event Indexer", status: "healthy", isCritical: true, latencyMs: 10, message: "OK" },
          ipfsStorage: { name: "IPFS Storage", status: "healthy", isCritical: false, latencyMs: 50, message: "OK" },
          workerQueues: { name: "Worker Queues", status: "healthy", isCritical: false, latencyMs: 3, message: "OK" },
          localStorage: { name: "Local Disk Storage", status: "healthy", isCritical: false, latencyMs: 1, message: "OK" },
          configuration: { name: "Configuration", status: "healthy", isCritical: true, latencyMs: 0, message: "OK" },
          encryptionKey: { name: "Encryption Key", status: "healthy", isCritical: true, latencyMs: 0, message: "OK" },
        },
        details: { circuitBreakers: [], websocketConnections: { total: 0, perUserLimit: 5, globalLimit: 1000, maxPerUser: 0 } },
      });

      const res = await request(app).get("/health/aggregate");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
      expect(res.body.systemHealthScore).toBe(100);
      expect(res.body.dependencies.database.status).toBe("healthy");
      expect(res.body.summary.totalDependencies).toBe(9);
    });

    it("returns 200 with degraded status when non-critical dependency is degraded", async () => {
      (HealthService.prototype.performAggregatedHealthCheck as jest.Mock).mockResolvedValue({
        status: "degraded",
        systemHealthScore: 85,
        timestamp: "2026-08-30T12:00:00.000Z",
        uptimeSeconds: 3600,
        version: "1.0.0",
        environment: "test",
        summary: {
          totalDependencies: 9,
          healthyCount: 8,
          degradedCount: 1,
          unhealthyCount: 0,
          criticalFailingCount: 0,
        },
        dependencies: {
          ipfsStorage: { name: "IPFS Storage", status: "degraded", isCritical: false, latencyMs: 3500, message: "Slow IPFS gateway" },
        },
        details: { circuitBreakers: [], websocketConnections: { total: 0, perUserLimit: 5, globalLimit: 1000, maxPerUser: 0 } },
      });

      const res = await request(app).get("/health/aggregate");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("degraded");
      expect(res.body.systemHealthScore).toBe(85);
    });

    it("returns 503 when critical dependency is failing", async () => {
      (HealthService.prototype.performAggregatedHealthCheck as jest.Mock).mockResolvedValue({
        status: "unhealthy",
        systemHealthScore: 40,
        timestamp: "2026-08-30T12:00:00.000Z",
        uptimeSeconds: 3600,
        version: "1.0.0",
        environment: "test",
        summary: {
          totalDependencies: 9,
          healthyCount: 7,
          degradedCount: 0,
          unhealthyCount: 2,
          criticalFailingCount: 1,
        },
        dependencies: {
          database: { name: "PostgreSQL Database", status: "unhealthy", isCritical: true, latencyMs: 250, message: "Connection refused", error: "Connection refused" },
        },
        details: { circuitBreakers: [], websocketConnections: { total: 0, perUserLimit: 5, globalLimit: 1000, maxPerUser: 0 } },
      });

      const res = await request(app).get("/health/aggregate");
      expect(res.status).toBe(503);
      expect(res.body.status).toBe("unhealthy");
      expect(res.body.summary.criticalFailingCount).toBe(1);
    });
  });

  describe("GET /health/summary", () => {
    it("returns concise summary of system health", async () => {
      (HealthService.prototype.performAggregatedHealthCheck as jest.Mock).mockResolvedValue({
        status: "healthy",
        systemHealthScore: 98,
        timestamp: "2026-08-30T12:00:00.000Z",
        summary: {
          totalDependencies: 9,
          healthyCount: 9,
          degradedCount: 0,
          unhealthyCount: 0,
          criticalFailingCount: 0,
        },
      });

      const res = await request(app).get("/health/summary");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
      expect(res.body.systemHealthScore).toBe(98);
      expect(res.body.summary.healthyCount).toBe(9);
    });
  });
});
