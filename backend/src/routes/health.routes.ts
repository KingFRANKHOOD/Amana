import { Router, Request, Response, NextFunction } from "express";
import { HealthService } from "../services/health.service";
import { appLogger } from "../middleware/logger";

export function createHealthRouter(): Router {
    const router = Router();
    const healthService = new HealthService();

    /**
     * GET /health
     * Comprehensive health check endpoint
     * Returns detailed status for uptime integrations (Datadog, UptimeRobot, etc.)
     * Responds with 503 if unhealthy for native fallback routing
     */
    router.get("/", async (req: Request, res: Response, next: NextFunction) => {
        try {
            const healthCheck = await healthService.performHealthCheck();

            appLogger.info(
                { status: healthCheck.status, checks: healthCheck.checks },
                "Health check performed"
            );

            // Return 503 Service Unavailable if unhealthy for uptime integrations
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
     * GET /health/live
     * Liveness probe - quick check if service is running
     */
    router.get("/live", (req: Request, res: Response) => {
        res.status(200).json({
            status: "alive",
            timestamp: new Date().toISOString(),
        });
    });

    /**
     * GET /health/ready
     * Readiness probe - checks if service is ready to accept traffic
     */
    router.get("/ready", async (req: Request, res: Response, next: NextFunction) => {
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

    return router;
}
