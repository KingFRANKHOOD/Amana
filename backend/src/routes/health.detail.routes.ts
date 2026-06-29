import { Router, Request, Response, NextFunction } from "express";
import { HealthService } from "../services/health.service";
import { appLogger } from "../middleware/logger";

/**
 * GET /health/detail
 *
 * Returns per-service health with latency for every external dependency.
 * A single service failure degrades (not crashes) the endpoint.
 * HTTP 200 → healthy/degraded, HTTP 503 → all-down or unhandled error.
 */
export function createHealthDetailRouter(): Router {
    const router = Router();
    const healthService = new HealthService();

    router.get("/detail", async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await healthService.performHealthCheck();

            appLogger.info(
                { status: result.status, checks: result.checks },
                "Health detail check performed"
            );

            // Respond 503 only when fully down — degraded is still 200
            const statusCode = result.status === "unhealthy" ? 503 : 200;

            res.status(statusCode).json({
                status: result.status,
                timestamp: new Date().toISOString(),
                checks: Object.fromEntries(
                    Object.entries(result.checks).map(([service, check]) => [
                        service,
                        {
                            status: check.status,
                            latency: check.responseTime,
                            ...(check.status === "down" && check.message
                                ? { error: check.message }
                                : {}),
                        },
                    ])
                ),
            });
        } catch (error) {
            appLogger.error({ error }, "Health detail check failed");
            res.status(503).json({
                status: "down",
                timestamp: new Date().toISOString(),
                error: "Health detail check failed",
            });
        }
    });

    return router;
}
