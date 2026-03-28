import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { appLogger } from "../middleware/logger";

interface HealthIndicatorResult {
    status: "up" | "down";
    message: string;
    responseTime: number;
}

interface HealthCheckResponse {
    status: "healthy" | "degraded" | "unhealthy";
    timestamp: string;
    uptime: number;
    checks: {
        database: HealthIndicatorResult;
        indexer: HealthIndicatorResult;
    };
    details: {
        databaseLatency: number;
        indexerLagSeconds: number;
        lastProcessedLedger: number | null;
    };
}

type HealthDatabase = Pick<PrismaClient, "processedLedger" | "$queryRaw">;

export class HealthService {
    private startTime: number = Date.now();

    constructor(private readonly prisma: HealthDatabase = defaultPrisma) { }

    /**
     * Check database connectivity and query performance
     * Ensures TypeORM-like deep introspection with ~200ms bounds
     */
    private async checkDatabase(): Promise<HealthIndicatorResult> {
        const startTime = Date.now();
        const timeout = 200; // 200ms threshold

        try {
            // Execute a simple query to verify database access
            const result = await Promise.race([
                this.prisma.$queryRaw`SELECT 1 as health_check`,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Database query timeout")), timeout)
                ),
            ]);

            const responseTime = Date.now() - startTime;

            if (responseTime > timeout) {
                return {
                    status: "down",
                    message: `Database query exceeded ${timeout}ms threshold`,
                    responseTime,
                };
            }

            return {
                status: "up",
                message: "Database connection healthy",
                responseTime,
            };
        } catch (error) {
            const responseTime = Date.now() - startTime;
            appLogger.error({ error }, "Database health check failed");
            return {
                status: "down",
                message: `Database check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                responseTime,
            };
        }
    }

    /**
     * Check indexer service health
     * Validates that the indexer has processed a ledger within the last 15 seconds
     * Ensures no background task halting
     */
    private async checkIndexer(): Promise<HealthIndicatorResult> {
        const startTime = Date.now();
        const maxLagSeconds = 15;

        try {
            // Fetch the most recent processed ledger
            const latestLedger = await this.prisma.processedLedger.findFirst({
                orderBy: { ledgerSequence: "desc" },
                take: 1,
            });

            const responseTime = Date.now() - startTime;

            if (!latestLedger) {
                return {
                    status: "down",
                    message: "No processed ledgers found - indexer may not have started",
                    responseTime,
                };
            }

            // Check if the ledger was processed within the last 15 seconds
            const ledgerAge = (Date.now() - latestLedger.processedAt.getTime()) / 1000;

            if (ledgerAge > maxLagSeconds) {
                return {
                    status: "down",
                    message: `Indexer lag exceeds ${maxLagSeconds}s threshold (current: ${ledgerAge.toFixed(1)}s)`,
                    responseTime,
                };
            }

            return {
                status: "up",
                message: `Indexer healthy - last ledger processed ${ledgerAge.toFixed(1)}s ago`,
                responseTime,
            };
        } catch (error) {
            const responseTime = Date.now() - startTime;
            appLogger.error({ error }, "Indexer health check failed");
            return {
                status: "down",
                message: `Indexer check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                responseTime,
            };
        }
    }

    /**
     * Perform comprehensive health check
     * Returns detailed status for uptime integrations (Datadog, UptimeRobot, etc.)
     */
    async performHealthCheck(): Promise<HealthCheckResponse> {
        const timestamp = new Date().toISOString();
        const uptime = Date.now() - this.startTime;

        // Run checks in parallel
        const [databaseCheck, indexerCheck] = await Promise.all([
            this.checkDatabase(),
            this.checkIndexer(),
        ]);

        // Determine overall status
        let status: "healthy" | "degraded" | "unhealthy" = "healthy";
        if (databaseCheck.status === "down" || indexerCheck.status === "down") {
            status = "unhealthy";
        } else if (databaseCheck.responseTime > 150 || indexerCheck.responseTime > 150) {
            status = "degraded";
        }

        // Fetch latest ledger for details
        const latestLedger = await this.prisma.processedLedger.findFirst({
            orderBy: { ledgerSequence: "desc" },
            take: 1,
        });

        const indexerLagSeconds = latestLedger
            ? (Date.now() - latestLedger.processedAt.getTime()) / 1000
            : -1;

        return {
            status,
            timestamp,
            uptime,
            checks: {
                database: databaseCheck,
                indexer: indexerCheck,
            },
            details: {
                databaseLatency: databaseCheck.responseTime,
                indexerLagSeconds: indexerLagSeconds > 0 ? indexerLagSeconds : 0,
                lastProcessedLedger: latestLedger?.ledgerSequence ?? null,
            },
        };
    }
}
