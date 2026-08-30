import express from "express";
import request from "supertest";
import { createHealthDetailRouter } from "../routes/health.detail.routes";
import { HealthService } from "../services/health.service";

jest.mock("../services/health.service");
jest.mock("../middleware/logger", () => ({ appLogger: { info: jest.fn(), error: jest.fn() } }));

const upCheck = (latency = 5) => ({ status: "up" as const, message: "ok", responseTime: latency });
const downCheck = (msg = "timeout") => ({ status: "down" as const, message: msg, responseTime: 5000 });

function makeHealthResult(overrides: Partial<{ status: "healthy" | "degraded" | "unhealthy"; checks: any }> = {}) {
    return {
        status: "healthy" as const,
        timestamp: new Date().toISOString(),
        uptime: 100,
        apiResponseTimeMs: 12,
        checks: {
            database: upCheck(),
            indexer: upCheck(),
            stellar: upCheck(),
            ipfs: upCheck(),
            redis: upCheck(),
            config: upCheck(),
            encryptionKey: upCheck(),
        },
        details: {
            databaseLatency: 5,
            redisLatency: 5,
            indexerLagSeconds: 0,
            lastProcessedLedger: 1,
            stellarNetwork: "testnet",
            ipfsGateway: "",
            missingEnvVars: [],
            encryptionKeyConfigured: true,
            circuitBreakers: [],
            websocketConnections: { total: 0, perUserLimit: 5, globalLimit: 1000, maxPerUser: 0 },
        },
        ...overrides,
    };
}

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use("/health", createHealthDetailRouter());
    return app;
}

describe("GET /health/detail (#729)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns 200 with per-service status and latency when all healthy", async () => {
        (HealthService.prototype.performHealthCheck as jest.Mock).mockResolvedValue(makeHealthResult());

        const res = await request(buildApp()).get("/health/detail");

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("healthy");
        expect(res.body.apiResponseTimeMs).toBeDefined();
        expect(res.body.checks.database).toMatchObject({ status: "up", latency: expect.any(Number) });
        expect(res.body.checks.redis).toMatchObject({ status: "up", latency: expect.any(Number) });
    });

    it("returns 200 with degraded status when one service is down", async () => {
        (HealthService.prototype.performHealthCheck as jest.Mock).mockResolvedValue(
            makeHealthResult({
                status: "degraded",
                checks: {
                    database: upCheck(),
                    indexer: downCheck("connection refused"),
                    stellar: upCheck(),
                    ipfs: upCheck(),
                    redis: upCheck(),
                    config: upCheck(),
                    encryptionKey: upCheck(),
                },
            })
        );

        const res = await request(buildApp()).get("/health/detail");

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("degraded");
        expect(res.body.checks.indexer.status).toBe("down");
        expect(res.body.checks.indexer.error).toBe("connection refused");
    });

    it("returns 503 when all services are down (unhealthy)", async () => {
        (HealthService.prototype.performHealthCheck as jest.Mock).mockResolvedValue(
            makeHealthResult({
                status: "unhealthy",
                checks: {
                    database: downCheck("DB unreachable"),
                    indexer: downCheck(),
                    stellar: downCheck(),
                    ipfs: downCheck(),
                    redis: downCheck(),
                    config: downCheck(),
                    encryptionKey: downCheck(),
                },
            })
        );

        const res = await request(buildApp()).get("/health/detail");

        expect(res.status).toBe(503);
        expect(res.body.status).toBe("unhealthy");
    });

    it("does not include error field for healthy services", async () => {
        (HealthService.prototype.performHealthCheck as jest.Mock).mockResolvedValue(makeHealthResult());

        const res = await request(buildApp()).get("/health/detail");

        expect(res.body.checks.database.error).toBeUndefined();
    });

    it("returns 503 with error field when performHealthCheck throws", async () => {
        (HealthService.prototype.performHealthCheck as jest.Mock).mockRejectedValue(new Error("unexpected"));

        const res = await request(buildApp()).get("/health/detail");

        expect(res.status).toBe(503);
        expect(res.body.status).toBe("down");
        expect(res.body.error).toBeDefined();
    });
});
