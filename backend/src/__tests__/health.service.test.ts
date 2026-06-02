jest.mock("../config/stellar", () => ({
  horizonServer: {
    loadAccount: jest.fn().mockResolvedValue({}),
  },
  sorobanRpcClient: {},
}));

jest.mock("../config/ipfs", () => ({
  getPinataClient: jest.fn().mockReturnValue({
    testAuthentication: jest.fn().mockResolvedValue(true),
  }),
}));

import { HealthService } from "../services/health.service";
import { AlertService } from "../services/alert.service";

describe("HealthService", () => {
    let healthService: HealthService;
    let mockPrisma: any;
    let mockRedis: { ping: jest.Mock };
    let mockAlerts: { dispatch: jest.Mock };

    beforeEach(() => {
        mockPrisma = {
            $queryRaw: jest.fn(),
            processedEvent: {
                findFirst: jest.fn(),
            },
        };
        mockRedis = {
            ping: jest.fn().mockResolvedValue("PONG"),
        };
        mockAlerts = {
            dispatch: jest.fn().mockResolvedValue(undefined),
        };

        healthService = new HealthService(
            mockPrisma,
            mockRedis,
            mockAlerts as unknown as AlertService,
        );
    });

    describe("performHealthCheck", () => {
        it("should return healthy status when all checks pass", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);
            mockRedis.ping.mockResolvedValue("PONG");
            mockPrisma.processedEvent.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: new Date(),
            });

            const result = await healthService.performHealthCheck();

            expect(result.status).toBe("healthy");
            expect(result.checks.database.status).toBe("up");
            expect(result.checks.redis.status).toBe("up");
            expect(result.checks.indexer.status).toBe("up");
            expect(result.details.lastProcessedLedger).toBe(12345);
            expect(mockAlerts.dispatch).not.toHaveBeenCalled();
        });

        it("should return unhealthy status when database check fails", async () => {
            mockPrisma.$queryRaw.mockRejectedValue(new Error("Connection failed"));
            mockRedis.ping.mockResolvedValue("PONG");
            mockPrisma.processedEvent.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: new Date(),
            });

            const result = await healthService.performHealthCheck();

            expect(result.status).toBe("unhealthy");
            expect(result.checks.database.status).toBe("down");
            expect(mockAlerts.dispatch).toHaveBeenCalledWith(
                "db_connection_failure",
                expect.stringContaining("Database check failed"),
                expect.objectContaining({ responseTime: expect.any(Number) }),
            );
        });

        it("should return degraded status and alert when redis check fails", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);
            mockRedis.ping.mockRejectedValue(new Error("Redis connection refused"));
            mockPrisma.processedLedger.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: new Date(),
            });

            const result = await healthService.performHealthCheck();

            expect(result.status).toBe("degraded");
            expect(result.checks.redis.status).toBe("down");
            expect(mockAlerts.dispatch).toHaveBeenCalledWith(
                "redis_connection_failure",
                expect.stringContaining("Redis check failed"),
                expect.objectContaining({ responseTime: expect.any(Number) }),
            );
        });

        it("should return unhealthy status when Redis check fails", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);
            mockRedis.ping.mockRejectedValue(new Error("Connection refused"));
            mockPrisma.processedEvent.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: new Date(),
            });

            const result = await healthService.performHealthCheck();

            expect(result.status).toBe("unhealthy");
            expect(result.checks.redis.status).toBe("down");
        });

        it("should return unhealthy status when indexer lag exceeds threshold", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);
            mockRedis.ping.mockResolvedValue("PONG");

            const oldDate = new Date(Date.now() - 20 * 1000);
            mockPrisma.processedEvent.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: oldDate,
            });

            const result = await healthService.performHealthCheck();

            expect(result.status).toBe("unhealthy");
            expect(result.checks.indexer.status).toBe("down");
            expect(result.details.indexerLagSeconds).toBeGreaterThan(15);
        });

        it("should return unhealthy status when no processed events exist", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);
            mockRedis.ping.mockResolvedValue("PONG");
            mockPrisma.processedEvent.findFirst.mockResolvedValue(null);

            const result = await healthService.performHealthCheck();

            expect(result.status).toBe("unhealthy");
            expect(result.checks.indexer.status).toBe("down");
            expect(result.details.lastProcessedLedger).toBeNull();
        });

        it("should return degraded status when response times are high", async () => {
            mockPrisma.$queryRaw.mockImplementation(
                () =>
                    new Promise((resolve) =>
                        setTimeout(() => resolve([{ health_check: 1 }]), 160)
                    )
            );
            mockRedis.ping.mockResolvedValue("PONG");
            mockPrisma.processedEvent.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: new Date(),
            });

            const result = await healthService.performHealthCheck();

            expect(result.status).toBe("degraded");
            expect(result.checks.database.responseTime).toBeGreaterThan(150);
        });

        it("should include uptime in response", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);
            mockRedis.ping.mockResolvedValue("PONG");
            mockPrisma.processedEvent.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: new Date(),
            });

            const result = await healthService.performHealthCheck();

            expect(result.uptime).toBeGreaterThanOrEqual(0);
            expect(result.timestamp).toBeDefined();
            expect(result.details.redisLatency).toBeGreaterThanOrEqual(0);
        });

        it("should handle database query timeout", async () => {
            mockPrisma.$queryRaw.mockImplementation(
                () =>
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error("Timeout")), 250)
                    )
            );
            mockRedis.ping.mockResolvedValue("PONG");
            mockPrisma.processedEvent.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: new Date(),
            });

            const result = await healthService.performHealthCheck();

            expect(result.checks.database.status).toBe("down");
        });

        it("should handle Redis ping timeout", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);
            mockRedis.ping.mockImplementation(
                () =>
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error("Timeout")), 250)
                    )
            );
            mockPrisma.processedEvent.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: new Date(),
            });

            const result = await healthService.performHealthCheck();

            expect(result.checks.redis.status).toBe("down");
        });

        it("should calculate indexer lag correctly", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);
            mockRedis.ping.mockResolvedValue("PONG");

            const recentDate = new Date(Date.now() - 5 * 1000);
            mockPrisma.processedEvent.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: recentDate,
            });

            const result = await healthService.performHealthCheck();

            expect(result.status).toBe("healthy");
            expect(result.details.indexerLagSeconds).toBeLessThan(10);
            expect(result.details.indexerLagSeconds).toBeGreaterThan(0);
        });

        it("should include redis latency in details", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);
            mockRedis.ping.mockResolvedValue("PONG");
            mockPrisma.processedEvent.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: new Date(),
            });

            const result = await healthService.performHealthCheck();

            expect(result.details).toHaveProperty("redisLatency");
            expect(result.details.redisLatency).toBeGreaterThanOrEqual(0);
        });
    });

    describe("performStartupCheck", () => {
        it("should return ready when database and redis are up", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);
            mockRedis.ping.mockResolvedValue("PONG");

            const result = await healthService.performStartupCheck();

            expect(result.status).toBe("ready");
            expect(result.checks.database.status).toBe("up");
            expect(result.checks.redis.status).toBe("up");
        });

        it("should return not_ready when database is down", async () => {
            mockPrisma.$queryRaw.mockRejectedValue(new Error("Connection failed"));
            mockRedis.ping.mockResolvedValue("PONG");

            const result = await healthService.performStartupCheck();

            expect(result.status).toBe("not_ready");
            expect(result.checks.database.status).toBe("down");
        });

        it("should return not_ready when redis is down", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);
            mockRedis.ping.mockRejectedValue(new Error("Connection refused"));

            const result = await healthService.performStartupCheck();

            expect(result.status).toBe("not_ready");
            expect(result.checks.redis.status).toBe("down");
        });

        it("should not query ProcessedEvent for startup check", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);
            mockRedis.ping.mockResolvedValue("PONG");

            await healthService.performStartupCheck();

            expect(mockPrisma.processedEvent.findFirst).not.toHaveBeenCalled();
        });
    });
});
