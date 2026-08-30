import { Router, Request, Response, NextFunction } from "express";
import { HealthService } from "../services/health.service";
import { appLogger } from "../middleware/logger";

export function createHealthRouter(): Router {
    const router = Router();
    const healthService = new HealthService();

    router.get("/", async (_req: Request, res: Response, _next: NextFunction) => {
        try {
            const healthCheck = await healthService.performHealthCheck();

            appLogger.info(
                { status: healthCheck.status, checks: healthCheck.checks },
                "Health check performed"
            );

            const statusCode = healthCheck.status === "unhealthy" ? 503 : 200;

            res.status(statusCode).json(healthCheck);
        } catch (error) {
            appLogger.error({ error }, "Health check failed");
            res.status(503).json({
                status: "unhealthy",
                timestamp: new Date().toISOString(),
                error: "Health check failed",
            });
        }
    });

    /**
     * GET /health/aggregate
     * Returns comprehensive aggregated health report across all critical and non-critical
     * dependencies with weighted health scoring, latency breakdown, and system summary.
     */
    router.get("/aggregate", async (_req: Request, res: Response, _next: NextFunction) => {
        try {
            const aggregated = await healthService.performAggregatedHealthCheck();
            const statusCode = aggregated.status === "unhealthy" ? 503 : 200;
            res.status(statusCode).json(aggregated);
        } catch (error) {
            appLogger.error({ error }, "Aggregated health check failed");
            res.status(503).json({
                status: "unhealthy",
                systemHealthScore: 0,
                timestamp: new Date().toISOString(),
                error: "Aggregated health check failed",
            });
        }
    });

    router.get("/summary", async (_req: Request, res: Response, _next: NextFunction) => {
        try {
            const aggregated = await healthService.performAggregatedHealthCheck();
            const statusCode = aggregated.status === "unhealthy" ? 503 : 200;
            res.status(statusCode).json({
                status: aggregated.status,
                systemHealthScore: aggregated.systemHealthScore,
                summary: aggregated.summary,
                timestamp: aggregated.timestamp,
            });
        } catch (error) {
            appLogger.error({ error }, "Summary health check failed");
            res.status(503).json({
                status: "unhealthy",
                systemHealthScore: 0,
                timestamp: new Date().toISOString(),
                error: "Summary health check failed",
            });
        }
    });

    router.get("/live", (_req: Request, res: Response) => {
        res.status(200).json({
            status: "alive",
            timestamp: new Date().toISOString(),
        });
    });

    router.get("/ready", async (_req: Request, res: Response, _next: NextFunction) => {
        try {
            const healthCheck = await healthService.performHealthCheck();
            const isReady = healthCheck.status !== "unhealthy";

            const statusCode = isReady ? 200 : 503;
            res.status(statusCode).json({
                status: isReady ? "ready" : "not_ready",
                timestamp: new Date().toISOString(),
                checks: healthCheck.checks,
            });
        } catch (error) {
            appLogger.error({ error }, "Readiness check failed");
            res.status(503).json({
                status: "not_ready",
                timestamp: new Date().toISOString(),
                error: "Readiness check failed",
            });
        }
    });

    router.get("/startup", async (_req: Request, res: Response, _next: NextFunction) => {
        try {
            const startupCheck = await healthService.performStartupCheck();

            const statusCode = startupCheck.status === "ready" ? 200 : 503;
            res.status(statusCode).json({
                status: startupCheck.status,
                timestamp: startupCheck.timestamp,
                checks: startupCheck.checks,
            });
        } catch (error) {
            appLogger.error({ error }, "Startup check failed");
            res.status(503).json({
                status: "not_ready",
                timestamp: new Date().toISOString(),
                error: "Startup check failed",
            });
        }
    });

    return router;
}
