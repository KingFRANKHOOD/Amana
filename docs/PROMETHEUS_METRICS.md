# Prometheus Metrics Documentation

This document describes the Prometheus metrics exposed by the Amana backend for observability and monitoring.

## Overview

The backend exposes application metrics at the `/metrics` endpoint in Prometheus text format. These metrics track key performance indicators (KPIs) related to trade throughput, dispute resolution, and processing latency.

## Accessing Metrics

**Endpoint**: `GET /metrics`

**Response Format**: Prometheus text format (MIME type: `text/plain`)

**Example**:
```bash
curl http://localhost:4000/metrics
```

## Trade Metrics

### `trades_created_total` (Counter)

**Description**: Total number of trades created since application start.

**Type**: Counter

**Unit**: 1

**Labels** (optional):
- `trade_type`: Type of trade (e.g., "direct", "template")
- `seller_region`: Geographic region of the seller
- `buyer_region`: Geographic region of the buyer

**Example**:
```
trades_created_total{trade_type="direct",seller_region="NG",buyer_region="NG"} 150
```

### `trades_completed_total` (Counter)

**Description**: Total number of trades that successfully completed (funds released).

**Type**: Counter

**Unit**: 1

**Labels** (optional):
- `completion_status`: Status of completion (e.g., "successful", "disputed", "cancelled")
- `settlement_method`: Method of settlement (e.g., "auto_release", "mediated")

**Example**:
```
trades_completed_total{completion_status="successful",settlement_method="auto_release"} 145
```

### `trades_active_count` (Gauge)

**Description**: Current number of active (in-progress) trades.

**Type**: Gauge

**Unit**: 1

**Example**:
```
trades_active_count 5
```

### `trade_processing_duration_ms` (Histogram)

**Description**: Duration (in milliseconds) of trade processing from creation to completion.

**Type**: Histogram

**Unit**: milliseconds

**Buckets**: [10, 50, 100, 500, 1000, 5000, 10000, 30000, 60000, 300000] ms

**Labels** (optional):
- `trade_status`: Final status of the trade (e.g., "completed", "failed", "disputed")
- `processing_stage`: Stage of processing (e.g., "deposit", "verification", "settlement")

**Example**:
```
trade_processing_duration_ms_bucket{le="10000",trade_status="completed"} 120
trade_processing_duration_ms_bucket{le="+Inf",trade_status="completed"} 145
trade_processing_duration_ms_sum{trade_status="completed"} 725000
trade_processing_duration_ms_count{trade_status="completed"} 145
```

## Dispute Metrics

### `disputes_created_total` (Counter)

**Description**: Total number of disputes created since application start.

**Type**: Counter

**Unit**: 1

**Labels** (optional):
- `dispute_type`: Type of dispute (e.g., "quality_issue", "non_delivery", "wrong_item")
- `initiator_role`: Role of dispute initiator (e.g., "buyer", "seller", "driver")

**Example**:
```
disputes_created_total{dispute_type="non_delivery",initiator_role="buyer"} 12
```

### `disputes_resolved_total` (Counter)

**Description**: Total number of disputes that have been resolved (closed).

**Type**: Counter

**Unit**: 1

**Labels** (optional):
- `resolution_outcome`: Outcome of resolution (e.g., "in_favor_of_buyer", "in_favor_of_seller", "split_settlement")
- `resolution_method`: Method of resolution (e.g., "mediation", "auto_settlement", "escalation")

**Example**:
```
disputes_resolved_total{resolution_outcome="split_settlement",resolution_method="mediation"} 8
```

### `disputes_open_count` (Gauge)

**Description**: Current number of open (unresolved) disputes.

**Type**: Gauge

**Unit**: 1

**Labels** (optional):
- `priority_level`: Priority of disputes (e.g., "high", "medium", "low")

**Example**:
```
disputes_open_count{priority_level="high"} 2
disputes_open_count{priority_level="medium"} 3
disputes_open_count{priority_level="low"} 1
```

### `dispute_resolution_duration_ms` (Histogram)

**Description**: Duration (in milliseconds) from dispute creation to resolution.

**Type**: Histogram

**Unit**: milliseconds

**Buckets**: [100, 500, 1000, 5000, 10000, 30000, 60000, 300000, 600000] ms

**Labels** (optional):
- `dispute_type`: Type of dispute
- `resolution_method`: Method used to resolve

**Example**:
```
dispute_resolution_duration_ms_bucket{le="60000",dispute_type="non_delivery"} 5
dispute_resolution_duration_ms_bucket{le="+Inf",dispute_type="non_delivery"} 8
dispute_resolution_duration_ms_sum{dispute_type="non_delivery"} 320000
dispute_resolution_duration_ms_count{dispute_type="non_delivery"} 8
```

## HTTP Request & API Response Time Metrics

### `http_request_duration_ms` (Histogram)

**Description**: HTTP request processing time in milliseconds across all endpoints, methods, and status codes.

**Type**: Histogram

**Unit**: milliseconds

**Buckets**: `[5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000]` ms

**Labels**:
- `method`: HTTP method (e.g., `GET`, `POST`, `PUT`, `DELETE`)
- `route`: Normalized request endpoint path (e.g., `/api/v1/trades/:id`, `/health`)
- `status_code`: Numeric HTTP response status code (e.g., `200`, `400`, `500`)
- `status_group`: Status code group (e.g., `2xx`, `4xx`, `5xx`)

**Percentile Calculation Examples (PromQL)**:
- **p50 (Median Latency)**:
  ```promql
  histogram_quantile(0.50, sum by (le) (rate(http_request_duration_ms_bucket[5m])))
  ```
- **p95 Latency**:
  ```promql
  histogram_quantile(0.95, sum by (le) (rate(http_request_duration_ms_bucket[5m])))
  ```
- **p99 Latency (Tail Latency)**:
  ```promql
  histogram_quantile(0.99, sum by (le) (rate(http_request_duration_ms_bucket[5m])))
  ```
- **p95 Latency per Endpoint**:
  ```promql
  histogram_quantile(0.95, sum by (le, route, method) (rate(http_request_duration_ms_bucket[5m])))
  ```

### `http_slow_requests_total` (Counter)

**Description**: Total number of slow API requests exceeding the SLA threshold (>2000ms).

**Type**: Counter

**Unit**: 1

**Labels**:
- `method`: HTTP method
- `route`: Normalized route path
- `status_code`: HTTP response status code

**Alert Threshold**:
- Dispatches alert webhook via `AlertService` when duration > 2000ms.
- Triggers Kubernetes Prometheus alert rule `APISlowEndpointWarning` when p95 exceeds 2s over 5m.

## Error Metrics

### `errors_total` (Counter)

**Description**: Total number of errors encountered since application start.

**Type**: Counter

**Unit**: 1

**Labels** (optional):
- `error_type`: Category of error (e.g., "validation_error", "database_error", "external_api_error")
- `error_code`: Specific error code
- `endpoint`: Endpoint where error occurred

**Example**:
```
errors_total{error_type="database_error",error_code="UNIQUE_CONSTRAINT",endpoint="/trades"} 3
errors_total{error_type="validation_error",error_code="SCHEMA_VALIDATION",endpoint="/trades"} 7
```

## Storage & Data Retention Metrics

### `storage_database_size_bytes` (Gauge)

**Description**: Total size in bytes of the PostgreSQL database on disk.

**Type**: Gauge

**Unit**: Bytes

**Example**:
```
storage_database_size_bytes 10737418240
```

### `storage_table_size_bytes` (Gauge)

**Description**: Size in bytes of a specific PostgreSQL table including all indexes.

**Type**: Gauge

**Unit**: Bytes

**Labels**:
- `table`: Name of the database table (e.g., "Trade", "AuditLog", "InAppNotification")

**Example**:
```
storage_table_size_bytes{table="Trade"} 52428800
storage_table_size_bytes{table="AuditLog"} 104857600
```

### `storage_table_row_count` (Gauge)

**Description**: Estimated live row count for a PostgreSQL table from system stats.

**Type**: Gauge

**Unit**: 1

**Labels**:
- `table`: Name of the database table

**Example**:
```
storage_table_row_count{table="Trade"} 15420
storage_table_row_count{table="AuditLog"} 84500
```

### `data_retention_records_pruned_total` (Counter)

**Description**: Total number of expired records pruned by automated retention cleanup jobs.

**Type**: Counter

**Unit**: 1

**Labels**:
- `entity_type`: Entity type pruned (e.g., "refresh_tokens", "read_notifications", "webhook_deliveries", "processed_events", "manifest_pii_redacted", "trade_notes", "audit_logs")

**Example**:
```
data_retention_records_pruned_total{entity_type="refresh_tokens"} 250
data_retention_records_pruned_total{entity_type="read_notifications"} 1200
data_retention_records_pruned_total{entity_type="webhook_deliveries"} 450
```

### `data_archival_records_archived_total` (Counter)

**Description**: Total number of cold records moved to Gzip compressed archival storage with SHA-256 integrity verification.

**Type**: Counter

**Unit**: 1

**Labels**:
- `entity_type`: Entity type archived (e.g., "trades", "audit_logs")

**Example**:
```
data_archival_records_archived_total{entity_type="trades"} 530
```

## PostgreSQL Pool Metrics

### `pg_pool_active_connections` (Gauge)

**Description**: Number of active connections currently in use from the pool.

**Type**: Gauge

**Unit**: 1

### `pg_pool_idle_connections` (Gauge)

**Description**: Number of idle connections waiting in the pool.

**Type**: Gauge

**Unit**: 1

### `pg_pool_waiting_queries` (Gauge)

**Description**: Number of queries currently queued waiting for an available connection from the pool.

**Type**: Gauge

**Unit**: 1

### `pg_pool_timeout_total` (Counter)

**Description**: Total count of queries that timed out waiting for an available pool connection.

**Type**: Counter

**Unit**: 1

## Prometheus Integration

### Configuration

To scrape metrics from the Amana backend, configure your Prometheus `scrape_config`:

```yaml
scrape_configs:
  - job_name: 'amana-backend'
    scrape_interval: 30s
    scrape_timeout: 10s
    metrics_path: '/metrics'
    static_configs:
      - targets: ['localhost:4000']
```

### Docker Compose Integration

When running with Docker Compose, add a Prometheus service:

```yaml
prometheus:
  image: prom/prometheus:latest
  ports:
    - "9090:9090"
  volumes:
    - ./prometheus.yml:/etc/prometheus/prometheus.yml
  command:
    - '--config.file=/etc/prometheus/prometheus.yml'
  networks:
    - amana-network
```

## Example Prometheus Queries

### Trade Throughput (trades per hour)

```promql
rate(trades_created_total[1h]) * 3600
```

### Active Trades Count

```promql
trades_active_count
```

### Trade Completion Rate

```promql
rate(trades_completed_total[1h]) / rate(trades_created_total[1h])
```

### Dispute Resolution Time (95th percentile)

```promql
histogram_quantile(0.95, dispute_resolution_duration_ms)
```

### Open Disputes Count

```promql
disputes_open_count
```

### HTTP Request Latency (p99)

```promql
histogram_quantile(0.99, rate(http_request_duration_ms_bucket[5m]))
```

### Error Rate

```promql
rate(errors_total[5m])
```

## Grafana Dashboard Example

A sample Grafana dashboard configuration for monitoring Amana KPIs:

```json
{
  "dashboard": {
    "title": "Amana KPI Dashboard",
    "panels": [
      {
        "title": "Trades Created (24h)",
        "targets": [
          {
            "expr": "increase(trades_created_total[24h])"
          }
        ]
      },
      {
        "title": "Active Trades",
        "targets": [
          {
            "expr": "trades_active_count"
          }
        ]
      },
      {
        "title": "Completion Rate (%)",
        "targets": [
          {
            "expr": "rate(trades_completed_total[1h]) / rate(trades_created_total[1h]) * 100"
          }
        ]
      },
      {
        "title": "Open Disputes",
        "targets": [
          {
            "expr": "disputes_open_count"
          }
        ]
      },
      {
        "title": "Trade Processing Duration (avg)",
        "targets": [
          {
            "expr": "rate(trade_processing_duration_ms_sum[5m]) / rate(trade_processing_duration_ms_count[5m])"
          }
        ]
      }
    ]
  }
}
```

## Best Practices

1. **Alerting**: Set up alerts for:
   - High dispute rate (disputes_created_total increasing faster than expected)
   - High error rate (errors_total spike)
   - Long trade processing times (p99 of trade_processing_duration_ms above threshold)
   - High open dispute count (disputes_open_count above threshold)

2. **Retention**: Prometheus should retain metrics for at least 15 days for trend analysis.

3. **Cardinality**: Be careful with high-cardinality labels (e.g., user IDs). Group or aggregate as needed.

4. **Custom Metrics**: The metrics service can be extended with additional metrics as business requirements evolve.

## Related Documentation

- [Distributed Tracing Guide](./DISTRIBUTED_TRACING_GUIDE.md)
- [Architecture Documentation](./architecture.md)
- [API Documentation](./api/openapi.yaml)
