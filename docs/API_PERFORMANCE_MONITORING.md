# API Response Time Monitoring & Observability Guide
**Issue Reference:** #1098 No API Response Time Monitoring

---

## 1. Overview
The Amana backend provides end-to-end API response time monitoring to identify slow endpoints before user experience degrades. 
This includes:
- **Full Endpoint Response-Time Instrumentation**: Request duration measured on every API call.
- **Percentile Tracking**: Automatic rolling and Prometheus-based calculation for `p50` (median), `p95` (standard SLA threshold), and `p99` (tail latency).
- **Automated Slow-Endpoint Alerting**: Instant dispatch when any endpoint latency exceeds **2.0 seconds (2000ms)**.
- **Dedicated Performance Dashboard**: Real-time Grafana dashboard `amana-api-performance`.
- **Health Check Integration**: Dynamic API response times surfaced in `/health`, `/health/detail`, and `/health/aggregate`.

---

## 2. Architecture & Metrics Flow

```
Incoming Client Request
        │
        ▼
[requestLoggerMiddleware] ── Start hrtime & record start timestamp
        │
        ▼
   Route Handler (Express)
        │
        ▼
[res.writeHead Interceptor] ── Injects 'X-Response-Time: <ms>' header
        │
        ▼
[res.on('finish')]
   ├── Normalize Route (sanitize UUIDs, hashes, Stellar addresses)
   ├── MetricsService.recordHttpRequest(method, route, statusCode, durationMs)
   │     ├── OpenTelemetry Histogram (http_request_duration_ms)
   │     ├── Rolling Percentile Window (p50, p95, p99)
   │     └── http_slow_requests_total (if duration > 2000ms)
   └── AlertService.dispatchSlowEndpoint() (if duration > 2000ms)
```

---

## 3. Metrics Specification

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `http_request_duration_ms` | Histogram | `method`, `route`, `status_code`, `status_group` | Distribution of request durations in ms. Buckets: `[5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000]` |
| `http_slow_requests_total` | Counter | `method`, `route`, `status_code` | Total count of slow requests exceeding 2s SLA. |

---

## 4. Percentile PromQL Queries

- **Overall p50 (Median)**:
  ```promql
  histogram_quantile(0.50, sum by (le) (rate(http_request_duration_ms_bucket[5m])))
  ```
- **Overall p95**:
  ```promql
  histogram_quantile(0.95, sum by (le) (rate(http_request_duration_ms_bucket[5m])))
  ```
- **Overall p99 (Tail Latency)**:
  ```promql
  histogram_quantile(0.99, sum by (le) (rate(http_request_duration_ms_bucket[5m])))
  ```
- **Per-Endpoint p95 Ranking**:
  ```promql
  topk(10, histogram_quantile(0.95, sum by (le, route, method) (rate(http_request_duration_ms_bucket[5m]))))
  ```

---

## 5. Alerting Configuration

### 5.1 Real-time Webhook Alerts (Application Level)
When any individual request takes `>2000ms`, `AlertService` triggers a `slow_endpoint_detected` webhook payload:
```json
{
  "type": "slow_endpoint_detected",
  "severity": "warning",
  "timestamp": "2026-08-30T22:30:00.000Z",
  "message": "Slow API endpoint detected: GET /api/v1/trades/:id took 2450.00ms (threshold: 2000ms)",
  "details": {
    "endpoint": "/api/v1/trades/:id",
    "method": "GET",
    "durationMs": 2450,
    "thresholdMs": 2000,
    "statusCode": 200
  }
}
```

### 5.2 Kubernetes Prometheus Rules
Configured in `infra/k8s/alerts-api-latency.yaml`:
- **`APISlowEndpointWarning`**: Fires if p95 latency on any endpoint exceeds 2s for 3 consecutive minutes.
- **`APICriticalTailLatencyP99`**: Fires if p99 latency exceeds 5s for 2 minutes.
- **`APISlowRequestsElevatedRate`**: Fires if the rate of slow requests exceeds 0.05 req/sec.

---

## 6. Grafana Dashboard
Provisioned at `grafana/provisioning/dashboards/api-performance-dashboard.json`:
- **Panels**:
  1. p50 Median Latency (Stat panel with color thresholds)
  2. p95 Latency Stat
  3. p99 Tail Latency Stat
  4. Slow Requests Rate (>2s)
  5. Global Latency Percentile Timeseries
  6. Top Slow Endpoints Ranked by p95 Latency
  7. Request Throughput by Route & Method
  8. Status Code Distribution (2xx, 4xx, 5xx)

---

## 7. Health Check Integration
The `/health`, `/health/detail`, and `/health/aggregate` endpoints include response time monitoring:
- **`GET /health`**: Returns `apiResponseTimeMs` and `details.apiPerformance` containing live `p50`, `p95`, `p99`, `avg`, `min`, `max`, and per-route breakdown.
- **`GET /health/aggregate`**: Exposes `apiPerformance.responseTimeMs` and global percentiles.
- **`GET /health/detail`**: Includes `apiResponseTimeMs` alongside per-subsystem latencies.
