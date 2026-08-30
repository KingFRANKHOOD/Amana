import type { Counter, Gauge, Histogram } from "@opentelemetry/api";
import { MeterProvider } from "@opentelemetry/sdk-metrics";

class MetricsService {
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
  private errorCounter: Counter;

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

  private constructor(meterProvider: MeterProvider) {
    this.meterProvider = meterProvider;
    const meter = meterProvider.getMeter("amana-backend");

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

    // General metrics
    this.requestDurationHistogram = meter.createHistogram(
      "http_request_duration_ms",
      {
        description: "HTTP request processing time",
        unit: "ms",
      }
    );

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
  }

  static getInstance(
    meterProvider: MeterProvider
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

  getMeterProvider(): MeterProvider {
    return this.meterProvider;
  }
}

export default MetricsService;
