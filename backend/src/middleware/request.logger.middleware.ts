import { NextFunction, Request, Response } from "express";
import { appLogger } from "./logger";
import { TracedRequest } from "./correlationId.middleware";
import { metricsService } from "../services/metrics.service";
import { alertService } from "../services/alert.service";

/**
 * Normalizes request paths to eliminate dynamic path parameters (UUIDs, IDs, hashes)
 * to prevent cardinality explosion in Prometheus metrics and latency aggregation.
 */
export function normalizeRoutePath(path: string): string {
  if (!path) return "/";

  return path
    // Normalize UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    // Normalize Stellar public keys / addresses (G... or C... 56 chars)
    .replace(/\b[GC][A-Z0-9]{55}\b/g, ":address")
    // Normalize numeric IDs in path segments
    .replace(/\/(\d+)(?=\/|$)/g, "/:id")
    // Clean trailing slash unless root
    .replace(/(.+)\/$/, "$1");
}

/**
 * Structured request logging and response time monitoring middleware.
 *
 * Logs every request with consistent fields:
 *   method, path, status, durationMs, correlationId, userId, userAgent, ip
 *
 * Metrics & Alerting:
 *   - Records duration in Prometheus histogram and rolling percentile window (p50, p95, p99)
 *   - Automatically dispatches slow endpoint alert if request duration > 2000ms
 *   - Attaches X-Request-Id and X-Response-Time headers to the response
 */
export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startTimeHr = process.hrtime.bigint();
  const traced = req as TracedRequest;

  // Propagate the server-generated request ID to the client.
  if (traced.requestId) {
    res.setHeader("X-Request-Id", traced.requestId);
  }

  // Intercept writeHead to inject X-Response-Time header safely before headers are sent
  const originalWriteHead = res.writeHead.bind(res);
  (res as any).writeHead = function (this: Response, ...args: any[]) {
    if (!res.headersSent) {
      const endHr = process.hrtime.bigint();
      const durationMs = Number(endHr - startTimeHr) / 1_000_000;
      res.setHeader("X-Response-Time", `${durationMs.toFixed(2)}ms`);
    }
    return originalWriteHead.apply(this, args as Parameters<Response["writeHead"]>);
  };

  res.on("finish", () => {
    const endHr = process.hrtime.bigint();
    const durationMs = Number(endHr - startTimeHr) / 1_000_000;
    const status = res.statusCode;
    const normalizedRoute = normalizeRoutePath(req.baseUrl ? `${req.baseUrl}${req.path}` : req.path);

    // Record response time in MetricsService for Prometheus and percentile tracking
    metricsService.recordHttpRequest(req.method, normalizedRoute, status, durationMs);

    const logFields = {
      method: req.method,
      path: req.path,
      route: normalizedRoute,
      status,
      durationMs: Math.round(durationMs * 100) / 100,
      correlationId: traced.correlationId,
      userId: (req as any).user?.id ?? (req as any).userId ?? undefined,
      userAgent: req.get("user-agent"),
      ip: req.ip,
    };

    if (status >= 500) {
      appLogger.error(logFields, "request completed");
    } else if (status >= 400) {
      appLogger.warn(logFields, "request completed");
    } else {
      appLogger.info(logFields, "request completed");
    }

    // Trigger slow endpoint alert if request duration exceeds 2s threshold (2000ms)
    // Ignore long-running export/evidence routes if configured higher, but alert standard API calls
    if (durationMs > 2000) {
      alertService.dispatchSlowEndpoint(
        normalizedRoute,
        req.method,
        durationMs,
        2000,
        {
          statusCode: status,
          correlationId: traced.correlationId,
          ip: req.ip,
        }
      ).catch((err) => {
        appLogger.warn({ err }, "Failed to dispatch slow endpoint alert");
      });
    }
  });

  next();
}
