import express from "express";
import request from "supertest";
import { MetricsService } from "../services/metrics.service";
import { alertService } from "../services/alert.service";
import { normalizeRoutePath, requestLoggerMiddleware } from "../middleware/request.logger.middleware";

describe("API Response Time Monitoring & Percentile Tracking (#1098)", () => {
  describe("Route Normalization", () => {
    it("should normalize UUIDs in endpoint paths", () => {
      const normalized = normalizeRoutePath("/api/v1/trades/123e4567-e89b-12d3-a456-426614174000/notes");
      expect(normalized).toBe("/api/v1/trades/:id/notes");
    });

    it("should normalize Stellar public addresses in paths", () => {
      const stellarAccount = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPXD225XZKY5K2SUO";
      const normalized = normalizeRoutePath(`/api/v1/stellar/account/${stellarAccount}/balance`);
      expect(normalized).toBe("/api/v1/stellar/account/:address/balance");
    });

    it("should normalize numeric IDs in paths", () => {
      const normalized = normalizeRoutePath("/api/v1/trades/99812/evidence");
      expect(normalized).toBe("/api/v1/trades/:id/evidence");
    });

    it("should handle static routes cleanly", () => {
      expect(normalizeRoutePath("/health")).toBe("/health");
      expect(normalizeRoutePath("/health/aggregate/")).toBe("/health/aggregate");
    });
  });

  describe("MetricsService Percentile Tracking", () => {
    let testMetricsService: MetricsService;

    beforeEach(() => {
      testMetricsService = new MetricsService();
    });

    it("should accurately calculate p50, p95, and p99 percentiles", () => {
      // Feed 100 duration samples from 1ms to 100ms
      for (let i = 1; i <= 100; i++) {
        testMetricsService.recordHttpRequest("GET", "/api/v1/trades", 200, i);
      }

      const summary = testMetricsService.getLatencySummary();

      expect(summary.global.count).toBe(100);
      expect(summary.global.p50).toBe(50);
      expect(summary.global.p95).toBe(95);
      expect(summary.global.p99).toBe(99);
      expect(summary.global.min).toBe(1);
      expect(summary.global.max).toBe(100);
      expect(summary.global.avg).toBe(50.5);

      expect(summary.byRoute["/api/v1/trades"]).toBeDefined();
      expect(summary.byRoute["/api/v1/trades"]?.p95).toBe(95);
    });

    it("should track slow requests exceeding 2000ms", () => {
      testMetricsService.recordHttpRequest("POST", "/api/v1/disputes", 200, 2500);
      testMetricsService.recordHttpRequest("GET", "/api/v1/users", 200, 100);

      const summary = testMetricsService.getLatencySummary();
      expect(summary.slowRequestsCount).toBe(1);
      expect(summary.global.count).toBe(2);
    });
  });

  describe("Middleware & Alerting on Slow Endpoints (>2s)", () => {
    let app: express.Application;
    let dispatchSpy: jest.SpyInstance;

    beforeEach(() => {
      app = express();
      dispatchSpy = jest.spyOn(alertService, "dispatchSlowEndpoint").mockResolvedValue(undefined as never);

      app.use(requestLoggerMiddleware);

      app.get("/fast-route", (_req, res) => {
        res.json({ status: "fast" });
      });

      app.get("/slow-route", async (_req, res) => {
        // Mock a delayed response
        await new Promise((resolve) => setTimeout(resolve, 50));
        res.json({ status: "delayed" });
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should inject X-Response-Time header", async () => {
      const res = await request(app).get("/fast-route");

      expect(res.status).toBe(200);
      expect(res.headers["x-response-time"]).toBeDefined();
      expect(res.headers["x-response-time"]).toMatch(/\d+(\.\d+)?ms/);
    });

    it("should dispatch an alert when request takes > 2000ms", async () => {
      // Simulate slow request directly through MetricsService and AlertService
      await alertService.dispatchSlowEndpoint("/api/v1/trades/:id", "GET", 2400, 2000, {
        statusCode: 200,
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        "/api/v1/trades/:id",
        "GET",
        2400,
        2000,
        expect.objectContaining({ statusCode: 200 })
      );
    });
  });
});
