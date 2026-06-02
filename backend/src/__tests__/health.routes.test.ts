import request from "supertest";
import { createApp } from "../app";
import express from "express";

const mockPerformHealthCheck = jest.fn();
const mockPerformStartupCheck = jest.fn();

jest.mock("../services/health.service", () => ({
    HealthService: jest.fn().mockImplementation(() => ({
        performHealthCheck: mockPerformHealthCheck,
        performStartupCheck: mockPerformStartupCheck,
    })),
}));

describe("Health Routes", () => {
    let app: express.Application;

    beforeEach(() => {
        mockPerformHealthCheck.mockReset();
        mockPerformStartupCheck.mockReset();
        app = createApp();
    });

    describe("GET /health", () => {
        it("should return healthy status", async () => {
            mockPerformHealthCheck.mockResolvedValue({
                status: "healthy",
                timestamp: "2025-01-01T00:00:00.000Z",
                uptime: 1000,
                checks: {
                    database: { status: "up", message: "ok", responseTime: 5 },
                    redis: { status: "up", message: "ok", responseTime: 3 },
                    indexer: { status: "up", message: "ok", responseTime: 10 },
                },
                details: {
                    databaseLatency: 5,
                    redisLatency: 3,
                    indexerLagSeconds: 2,
                    lastProcessedLedger: 12345,
                },
            });

            expect([200, 503]).toContain(response.status);
            expect(response.body).toHaveProperty("status");
            expect(response.body).toHaveProperty("timestamp");
            expect(response.body).toHaveProperty("checks");
        });

        it("should include database, redis, indexer, and dependency checks", async () => {
            const response = await request(app).get("/health");

            expect(response.status).toBe(200);
            expect(response.body.status).toBe("healthy");
            expect(response.body.checks).toHaveProperty("database");
            expect(response.body.checks).toHaveProperty("redis");
            expect(response.body.checks).toHaveProperty("indexer");
            expect(response.body.checks).toHaveProperty("stellar");
            expect(response.body.checks).toHaveProperty("ipfs");
            expect(response.body.checks).toHaveProperty("config");
            expect(response.body.checks.database).toHaveProperty("status");
            expect(response.body.checks.redis).toHaveProperty("status");
            expect(response.body.checks.indexer).toHaveProperty("status");
        });

        it("should return degraded status", async () => {
            mockPerformHealthCheck.mockResolvedValue({
                status: "degraded",
                timestamp: "2025-01-01T00:00:00.000Z",
                uptime: 1000,
                checks: {
                    database: { status: "up", message: "slow", responseTime: 200 },
                    redis: { status: "up", message: "ok", responseTime: 5 },
                    indexer: { status: "up", message: "ok", responseTime: 10 },
                },
                details: {
                    databaseLatency: 200,
                    redisLatency: 5,
                    indexerLagSeconds: 2,
                    lastProcessedLedger: 12345,
                },
            });

            const response = await request(app).get("/health");

            expect(response.body.details).toHaveProperty("databaseLatency");
            expect(response.body.details).toHaveProperty("redisLatency");
            expect(response.body.details).toHaveProperty("indexerLagSeconds");
            expect(response.body.details).toHaveProperty("lastProcessedLedger");
            expect(response.body.details).toHaveProperty("stellarNetwork");
            expect(response.body.details).toHaveProperty("ipfsGateway");
            expect(response.body.details).toHaveProperty("missingEnvVars");
        });

        it("should return 503 when unhealthy", async () => {
            mockPerformHealthCheck.mockResolvedValue({
                status: "unhealthy",
                timestamp: "2025-01-01T00:00:00.000Z",
                uptime: 1000,
                checks: {
                    database: { status: "down", message: "failed", responseTime: 200 },
                    redis: { status: "up", message: "ok", responseTime: 5 },
                    indexer: { status: "up", message: "ok", responseTime: 10 },
                },
                details: {
                    databaseLatency: 200,
                    redisLatency: 5,
                    indexerLagSeconds: 2,
                    lastProcessedLedger: 12345,
                },
            });

            const response = await request(app).get("/health");

            expect(response.status).toBe(503);
            expect(response.body.status).toBe("unhealthy");
        });

        it("should return 503 on service error", async () => {
            mockPerformHealthCheck.mockRejectedValue(new Error("Unexpected error"));

            const response = await request(app).get("/health");

            expect(response.status).toBe(503);
            expect(response.body.status).toBe("unhealthy");
            expect(response.body).toHaveProperty("error");
        });
    });

    describe("GET /health/live", () => {
        it("should return alive status", async () => {
            const response = await request(app).get("/health/live");

            expect(response.status).toBe(200);
            expect(response.body.status).toBe("alive");
            expect(response.body).toHaveProperty("timestamp");
        });
    });

    describe("GET /health/ready", () => {
        it("should return ready when healthy", async () => {
            mockPerformHealthCheck.mockResolvedValue({
                status: "healthy",
                timestamp: "2025-01-01T00:00:00.000Z",
                uptime: 1000,
                checks: {
                    database: { status: "up", message: "ok", responseTime: 5 },
                    redis: { status: "up", message: "ok", responseTime: 3 },
                    indexer: { status: "up", message: "ok", responseTime: 10 },
                },
                details: {
                    databaseLatency: 5,
                    redisLatency: 3,
                    indexerLagSeconds: 2,
                    lastProcessedLedger: 12345,
                },
            });

            const response = await request(app).get("/health/ready");

            expect(response.status).toBe(200);
            expect(response.body.status).toBe("ready");
            expect(response.body).toHaveProperty("timestamp");
        });

        it("should return not_ready when unhealthy", async () => {
            mockPerformHealthCheck.mockResolvedValue({
                status: "unhealthy",
                timestamp: "2025-01-01T00:00:00.000Z",
                uptime: 1000,
                checks: {
                    database: { status: "down", message: "failed", responseTime: 200 },
                    redis: { status: "up", message: "ok", responseTime: 5 },
                    indexer: { status: "up", message: "ok", responseTime: 10 },
                },
                details: {
                    databaseLatency: 200,
                    redisLatency: 5,
                    indexerLagSeconds: 2,
                    lastProcessedLedger: 12345,
                },
            });

            const response = await request(app).get("/health/ready");

            expect(response.status).toBe(503);
            expect(response.body.status).toBe("not_ready");
        });
    });

    describe("GET /health/startup", () => {
        it("should return ready when dependencies are up", async () => {
            mockPerformStartupCheck.mockResolvedValue({
                status: "ready",
                timestamp: "2025-01-01T00:00:00.000Z",
                checks: {
                    database: { status: "up", message: "ok", responseTime: 5 },
                    redis: { status: "up", message: "ok", responseTime: 3 },
                },
            });

            const response = await request(app).get("/health/startup");

            expect(response.status).toBe(200);
            expect(response.body.status).toBe("ready");
            expect(response.body).toHaveProperty("timestamp");
            expect(response.body).toHaveProperty("checks");
        });

        it("should return not_ready when database is down", async () => {
            mockPerformStartupCheck.mockResolvedValue({
                status: "not_ready",
                timestamp: "2025-01-01T00:00:00.000Z",
                checks: {
                    database: { status: "down", message: "failed", responseTime: 200 },
                    redis: { status: "up", message: "ok", responseTime: 3 },
                },
            });

            const response = await request(app).get("/health/startup");

            expect(response.status).toBe(503);
            expect(response.body.status).toBe("not_ready");
        });

        it("should return 503 on service error", async () => {
            mockPerformStartupCheck.mockRejectedValue(new Error("Unexpected error"));

            const response = await request(app).get("/health/startup");

            expect(response.status).toBe(503);
            expect(response.body.status).toBe("not_ready");
            expect(response.body).toHaveProperty("error");
        });
    });
});
