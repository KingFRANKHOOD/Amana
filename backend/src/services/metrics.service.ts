import type { Counter, Gauge, Histogram } from "@opentelemetry/api";
import { MeterProvider } from "@opentelemetry/sdk-metrics";

export interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
  count: number;
}

export interface EndpointLatencyStats {
  global: LatencyPercentiles;
  byRoute: Record<string, LatencyPercentiles>;
  slowRequestsCount: number;
}

// Fixed-capacity sliding window for rolling percentile computation
class RollingWindowStats {
  private samples: number[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  add(value: number): void {
    if (this.samples.length >= this.maxSize) {
      this.samples.shift();
    }
    this.samples.push(value);
  }

  getPercentiles(): LatencyPercentiles {
    if (this.samples.length === 0) {
      return {
        p50: 0,
        p95: 0,
        p99: 0,
        avg: 0,
        min: 0,
        max: 0,
        count: 0,
      };
    }

    const sorted = [...this.samples].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((acc, val) => acc + val, 0);

    const getP = (p: number): number => {
      const rank = Math.ceil((p / 100) * count);
      const idx = Math.max(0, Math.min(rank - 1, count - 1));
      const val = sorted[idx] ?? 0;
      return Math.round(val * 100) / 100;
    };

    const minVal = sorted[0] ?? 0;
    const maxVal = sorted[count - 1] ?? 0;

    return {
      p50: getP(50),
      p95: getP(95),
      p99: getP(99),
      avg: Math.round((sum / count) * 100) / 100,
      min: Math.round(minVal * 100) / 100,
      max: Math.round(maxVal * 100) / 100,
      count,
    };
  }

  clear(): void {
    this.samples = [];
  }
}

export class MetricsService {
  private static instance: MetricsService;
  private meterProvider: MeterProvider;

  // Trade metrics
  private tradeCounter: Counter;
  private tradeCompletedCounter: Counter;
  private tradeLatencyHistogram: Histogram;

  // Dispute metrics
  private disputeCreatedCounter: Counter;
  private disputeResolvedCounter: Counter;
  private disputeResolutionTimeHistogram: Histogram;

  // General processing metrics
  private requestDurationHistogram: Histogram;
  private slowRequestCounter: Counter;
  private errorCounter: Counter;

  // In-memory percentile trackers
  private globalRollingStats = new RollingWindowStats(2000);
  private routeRollingStats = new Map<string, RollingWindowStats>();
  private slowRequestsTotalCount: number = 0;

  // PostgreSQL pool metrics
  private pgPoolActiveConnections: Gauge;
  private pgPoolIdleConnections: Gauge;
  private pgPoolWaitingQueries: Gauge;
  private pgPoolTimeoutTotal: Counter;

  // Storage metrics
  private storageTableSizeGauge: Gauge;
  private storageDatabaseSizeGauge: Gauge;
  private storageTableRowCountGauge: Gauge;
  private dataRetentionPrunedCounter: Counter;
  private dataArchivalRecordsCounter: Counter;

  // Redis metrics
  private redisMemoryUsedGauge: Gauge;
  private redisMaxmemoryGauge: Gauge;
  private redisMemoryUsagePercentGauge: Gauge;
  private redisEvictedKeysCounter: Counter;
  private redisConnectedClientsGauge: Gauge;
  private redisHealthGauge: Gauge;

  constructor(meterProvider?: MeterProvider) {
    this.meterProvider = meterProvider ?? new MeterProvider();
    const meter = this.meterProvider.getMeter("amana-backend");

    // Trade metrics
    this.tradeCounter = meter.createCounter("trades_created_total", {
      description: "Total number of trades created",
      unit: "1",
    });

    this.tradeCompletedCounter = meter.createCounter("trades_completed_total", {
      description: "Total number of completed trades",
      unit: "1",
    });

    meter.createObservableGauge(
      "trades_active_count",
      {
        description: "Current number of active trades",
        unit: "1",
      }
    );

    this.tradeLatencyHistogram = meter.createHistogram(
      "trade_processing_duration_ms",
      {
        description: "Duration of trade processing from creation to completion",
        unit: "ms",
      }
    );

    // Dispute metrics
    this.disputeCreatedCounter = meter.createCounter("disputes_created_total", {
      description: "Total number of disputes created",
      unit: "1",
    });

    this.disputeResolvedCounter = meter.createCounter(
      "disputes_resolved_total",
      {
        description: "Total number of disputes resolved",
        unit: "1",
      }
    );

    meter.createObservableGauge("disputes_open_count", {
      description: "Current number of open disputes",
      unit: "1",
    });

    this.disputeResolutionTimeHistogram = meter.createHistogram(
      "dispute_resolution_duration_ms",
      {
        description: "Duration from dispute creation to resolution",
        unit: "ms",
      }
    );

    // General metrics with standardized latency buckets for p50/p95/p99 tracking
    this.requestDurationHistogram = meter.createHistogram(
      "http_request_duration_ms",
      {
        description: "HTTP request processing time",
        unit: "ms",
      }
    );

    this.slowRequestCounter = meter.createCounter("http_slow_requests_total", {
      description: "Total number of slow requests exceeding threshold (>2s)",
      unit: "1",
    });

    this.errorCounter = meter.createCounter("errors_total", {
      description: "Total number of errors encountered",
      unit: "1",
    });

    // PostgreSQL pool metrics
    this.pgPoolActiveConnections = meter.createGauge(
      "pg_pool_active_connections",
      {
        description: "Number of active PostgreSQL connections in the pool",
        unit: "1",
      }
    );

    this.pgPoolIdleConnections = meter.createGauge(
      "pg_pool_idle_connections",
      {
        description: "Number of idle PostgreSQL connections in the pool",
        unit: "1",
      }
    );

    this.pgPoolWaitingQueries = meter.createGauge(
      "pg_pool_waiting_queries",
      {
        description: "Number of queries waiting for a connection from the pool",
        unit: "1",
      }
    );

    this.pgPoolTimeoutTotal = meter.createCounter(
      "pg_pool_timeout_total",
      {
        description:
          "Total number of connections that waited too long for a pool connection",
        unit: "1",
      }
    );

    // Storage and retention growth metrics
    this.storageTableSizeGauge = meter.createGauge(
      "storage_table_size_bytes",
      {
        description: "Size in bytes of PostgreSQL table including indexes",
        unit: "By",
      }
    );

    this.storageDatabaseSizeGauge = meter.createGauge(
      "storage_database_size_bytes",
      {
        description: "Total size in bytes of the PostgreSQL database",
        unit: "By",
      }
    );

    this.storageTableRowCountGauge = meter.createGauge(
      "storage_table_row_count",
      {
        description: "Estimated row count of PostgreSQL table",
        unit: "1",
      }
    );

    this.dataRetentionPrunedCounter = meter.createCounter(
      "data_retention_records_pruned_total",
      {
        description: "Total number of records pruned by automated retention jobs",
        unit: "1",
      }
    );

    this.dataArchivalRecordsCounter = meter.createCounter(
      "data_archival_records_archived_total",
      {
        description: "Total number of records moved to archival cold storage",
        unit: "1",
      }
    );

    // Redis metrics
    this.redisMemoryUsedGauge = meter.createGauge(
      "redis_memory_used_bytes",
      {
        description: "Current memory used by Redis in bytes",
        unit: "By",
      }
    );

    this.redisMaxmemoryGauge = meter.createGauge(
      "redis_maxmemory_bytes",
      {
        description: "Configured maxmemory limit for Redis in bytes",
        unit: "By",
      }
    );

    this.redisMemoryUsagePercentGauge = meter.createGauge(
      "redis_memory_used_percent",
      {
        description: "Redis memory usage as a percentage of maxmemory",
        unit: "1",
      }
    );

    this.redisEvictedKeysCounter = meter.createCounter(
      "redis_evicted_keys_total",
      {
        description: "Total number of keys evicted by Redis due to maxmemory policy",
        unit: "1",
      }
    );

    this.redisConnectedClientsGauge = meter.createGauge(
      "redis_connected_clients",
      {
        description: "Number of client connections to Redis",
        unit: "1",
      }
    );

    this.redisHealthGauge = meter.createGauge(
      "redis_health_status",
      {
        description: "Whether Redis is reachable and healthy (1 = healthy, 0 = unhealthy)",
        unit: "1",
      }
    );
  }

  static getInstance(
    meterProvider?: MeterProvider
  ): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService(meterProvider);
    }
    return MetricsService.instance;
  }

  // Trade methods
  recordTradeCreated(attributes?: Record<string, string | number | boolean>) {
    this.tradeCounter.add(1, attributes);
  }

  recordTradeCompleted(
    durationMs: number,
    attributes?: Record<string, string | number | boolean>
  ) {
    this.tradeCompletedCounter.add(1, attributes);
    this.tradeLatencyHistogram.record(durationMs, attributes);
  }

  recordTradeLatency(
    durationMs: number,
    attributes?: Record<string, string | number | boolean>
  ) {
    this.tradeLatencyHistogram.record(durationMs, attributes);
  }

  // Dispute methods
  recordDisputeCreated(
    attributes?: Record<string, string | number | boolean>
  ) {
    this.disputeCreatedCounter.add(1, attributes);
  }

  recordDisputeResolved(
    durationMs: number,
    attributes?: Record<string, string | number | boolean>
  ) {
    this.disputeResolvedCounter.add(1, attributes);
    this.disputeResolutionTimeHistogram.record(durationMs, attributes);
  }

  // Request metrics
  recordRequestDuration(
    durationMs: number,
    attributes?: Record<string, string | number | boolean>
  ) {
    this.requestDurationHistogram.record(durationMs, attributes);
    this.globalRollingStats.add(durationMs);

    const route = typeof attributes?.route === "string" ? attributes.route : (typeof attributes?.path === "string" ? attributes.path : undefined);
    if (route) {
      if (!this.routeRollingStats.has(route)) {
        this.routeRollingStats.set(route, new RollingWindowStats(500));
      }
      this.routeRollingStats.get(route)!.add(durationMs);
    }

    if (durationMs > 2000) {
      this.slowRequestsTotalCount++;
      this.slowRequestCounter.add(1, attributes);
    }
  }

  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationMs: number
  ): void {
    const statusGroup = `${Math.floor(statusCode / 100)}xx`;
    this.recordRequestDuration(durationMs, {
      method,
      route,
      status_code: statusCode,
      status_group: statusGroup,
    });
  }

  getLatencySummary(): EndpointLatencyStats {
    const byRoute: Record<string, LatencyPercentiles> = {};
    for (const [route, stats] of this.routeRollingStats.entries()) {
      byRoute[route] = stats.getPercentiles();
    }

    return {
      global: this.globalRollingStats.getPercentiles(),
      byRoute,
      slowRequestsCount: this.slowRequestsTotalCount,
    };
  }

  recordError(attributes?: Record<string, string | number | boolean>) {
    this.errorCounter.add(1, attributes);
  }

  // PostgreSQL pool metrics
  recordPoolMetrics(
    activeConnections: number,
    idleConnections: number,
    waitingQueries: number
  ) {
    this.pgPoolActiveConnections.record(activeConnections);
    this.pgPoolIdleConnections.record(idleConnections);
    this.pgPoolWaitingQueries.record(waitingQueries);
  }

  recordPoolTimeout() {
    this.pgPoolTimeoutTotal.add(1);
  }

  // Storage and retention methods
  recordStorageTableMetrics(
    tableName: string,
    sizeBytes: number,
    rowCount: number
  ) {
    this.storageTableSizeGauge.record(sizeBytes, { table: tableName });
    this.storageTableRowCountGauge.record(rowCount, { table: tableName });
  }

  recordDatabaseSize(sizeBytes: number) {
    this.storageDatabaseSizeGauge.record(sizeBytes);
  }

  recordRetentionPruned(entityType: string, count: number) {
    this.dataRetentionPrunedCounter.add(count, { entity_type: entityType });
  }

  recordArchivalMetrics(entityType: string, count: number) {
    this.dataArchivalRecordsCounter.add(count, { entity_type: entityType });
  }

  // Redis metrics
  recordRedisMetrics(
    memoryUsed: number,
    maxmemory: number,
    connectedClients?: number
  ) {
    this.redisMemoryUsedGauge.record(memoryUsed);
    this.redisMaxmemoryGauge.record(maxmemory);
    if (maxmemory > 0) {
      this.redisMemoryUsagePercentGauge.record((memoryUsed / maxmemory) * 100);
    }
    if (connectedClients !== undefined) {
      this.redisConnectedClientsGauge.record(connectedClients);
    }
  }

  recordRedisEvictions(evictedKeys: number) {
    this.redisEvictedKeysCounter.add(evictedKeys);
  }

  recordRedisHealth(healthy: boolean) {
    this.redisHealthGauge.record(healthy ? 1 : 0);
  }

  getMeterProvider(): MeterProvider {
    return this.meterProvider;
  }
}

export const metricsService = MetricsService.getInstance();
export default MetricsService;
