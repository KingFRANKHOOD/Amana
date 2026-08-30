import { Router, Request, Response } from "express";
import { metricsService } from "../services/metrics.service";

export function createMetricsRouter(): Router {
  const router = Router();

  // GET /metrics-info - Metrics endpoint information
  // Note: OpenTelemetry PrometheusExporter is initialized in config/tracing.ts
  // and runs on a separate port (default 9464) with endpoint /metrics.
  router.get("/metrics-info", (_req: Request, res: Response) => {
    const prometheusPort = process.env.PROMETHEUS_PORT || "9464";
    const latencySummary = metricsService.getLatencySummary();

    res.json({
      message: "Prometheus metrics are available",
      endpoint: `http://localhost:${prometheusPort}/metrics`,
      format: "Prometheus text format",
      documentation: "See docs/PROMETHEUS_METRICS.md for detailed metric descriptions",
      metrics: {
        trades: [
          "trades_created_total",
          "trades_completed_total",
          "trades_active_count",
          "trade_processing_duration_ms",
        ],
        disputes: [
          "disputes_created_total",
          "disputes_resolved_total",
          "disputes_open_count",
          "dispute_resolution_duration_ms",
        ],
        requests: [
          "http_request_duration_ms",
          "http_slow_requests_total",
        ],
        errors: [
          "errors_total",
        ],
        postgresql_pool: [
          "pg_pool_active_connections",
          "pg_pool_idle_connections",
          "pg_pool_waiting_queries",
          "pg_pool_timeout_total",
        ],
        websocket: [
          "websocket_active_connections",
        ],
      },
      livePerformanceSummary: {
        globalLatency: latencySummary.global,
        slowRequestsCount: latencySummary.slowRequestsCount,
        trackedRoutesCount: Object.keys(latencySummary.byRoute).length,
      },
    });
  });

  return router;
}
