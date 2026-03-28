import { describe, it, expect, beforeEach, vi } from "vitest";
import { HealthService } from "../services/health.service";

describe("HealthService", () => {
    let healthService: HealthService;
    let mockPrisma: any;

    beforeEach(() => {
        mockPrisma = {
            $queryRaw: vi.fn(),
            processedLedger: {
                findFirst: vi.fn(),
            },
        };

        healthService = new HealthService(mockPrisma);
    });

    describe("performHealthCheck", () => {
        it("should return healthy status when all checks pass", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);
            mockPrisma.processedLedger.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: new Date(),
            });

            const result = await healthService.performHealthCheck();

            expect(result.status).toBe("healthy");
            expect(result.checks.database.status).toBe("up");
            expect(result.checks.indexer.status).toBe("up");
            expect(result.details.lastProcessedLedger).toBe(12345);
        });

        it("should return unhealthy status when database check fails", async () => {
            mockPrisma.$queryRaw.mockRejectedValue(new Error("Connection failed"));
            mockPrisma.processedLedger.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: new Date(),
            });

            const result = await healthService.performHealthCheck();

            expect(result.status).toBe("unhealthy");
            expect(result.checks.database.status).toBe("down");
        });

        it("should return unhealthy status when indexer lag exceeds threshold", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);

            // Set processed ledger to 20 seconds ago (exceeds 15s threshold)
            const oldDate = new Date(Date.now() - 20 * 1000);
            mockPrisma.processedLedger.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: oldDate,
            });

            const result = await healthService.performHealthCheck();

            expect(result.status).toBe("unhealthy");
            expect(result.checks.indexer.status).toBe("down");
            expect(result.details.indexerLagSeconds).toBeGreaterThan(15);
        });

        it("should return unhealthy status when no processed ledgers exist", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);
            mockPrisma.processedLedger.findFirst.mockResolvedValue(null);

            const result = await healthService.performHealthCheck();

            expect(result.status).toBe("unhealthy");
            expect(result.checks.indexer.status).toBe("down");
            expect(result.details.lastProcessedLedger).toBeNull();
        });

        it("should return degraded status when response times are high", async () => {
            // Mock slow database query
            mockPrisma.$queryRaw.mockImplementation(
                () =>
                    new Promise((resolve) =>
                        setTimeout(() => resolve([{ health_check: 1 }]), 160)
                    )
            );

            mockPrisma.processedLedger.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: new Date(),
            });

            const result = await healthService.performHealthCheck();

            expect(result.status).toBe("degraded");
            expect(result.checks.database.responseTime).toBeGreaterThan(150);
        });

        it("should include uptime in response", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);
            mockPrisma.processedLedger.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: new Date(),
            });

            const result = await healthService.performHealthCheck();

            expect(result.uptime).toBeGreaterThanOrEqual(0);
            expect(result.timestamp).toBeDefined();
        });

        it("should handle database query timeout", async () => {
            // Simulate timeout by rejecting after delay
            mockPrisma.$queryRaw.mockImplementation(
                () =>
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error("Timeout")), 250)
                    )
            );

            mockPrisma.processedLedger.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: new Date(),
            });

            const result = await healthService.performHealthCheck();

            expect(result.checks.database.status).toBe("down");
        });

        it("should calculate indexer lag correctly", async () => {
            mockPrisma.$queryRaw.mockResolvedValue([{ health_check: 1 }]);

            // Set processed ledger to 5 seconds ago
            const recentDate = new Date(Date.now() - 5 * 1000);
            mockPrisma.processedLedger.findFirst.mockResolvedValue({
                ledgerSequence: 12345,
                processedAt: recentDate,
            });

            const result = await healthService.performHealthCheck();

            expect(result.status).toBe("healthy");
            expect(result.details.indexerLagSeconds).toBeLessThan(10);
            expect(result.details.indexerLagSeconds).toBeGreaterThan(0);
        });
    });
});
