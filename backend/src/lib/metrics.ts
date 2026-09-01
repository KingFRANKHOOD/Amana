import { Counter, Gauge, Histogram, metrics } from "@opentelemetry/api";

const METER_NAME = "amana-backend";

export type StellarTransactionOutcome =
  | "success"
  | "rpc_error"
  | "contract_panic"
  | "xdr_invalid"
  | "network_error";

export type StellarRpcMethod =
  | "sendTransaction"
  | "simulateTransaction"
  | "prepareTransaction"
  | "getAccount";

export type StellarRpcOutcome = "success" | "error";

export interface StellarSubmissionStats {
  totalSubmissions: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  failureRate: number;
  outcomeCounts: Record<StellarTransactionOutcome, number>;
}

export interface StellarMetricsRecorder {
  recordTransactionSubmission(
    operation: string,
    outcome: StellarTransactionOutcome,
    durationMs: number,
  ): void;
  recordRpcCall(
    rpcMethod: StellarRpcMethod,
    outcome: StellarRpcOutcome,
    durationMs: number,
  ): void;
  recordDuplicateEventAttempt?(source: string, eventType: string): void;
  recordRpcNodeHealth?(url: string, isHealthy: boolean, latencyMs: number): void;
}

export interface PoolMetrics {
  activeConnections: number;
  idleConnections: number;
  waitingQueries: number;
  timeoutTotal: number;
}

export interface RedisMemoryMetrics {
  usedMemoryBytes: number;
  maxMemoryBytes: number;
  maxmemoryPolicy?: string;
}

export const REDIS_MEMORY_ALERT_THRESHOLD = 0.8;

class RollingTransactionTracker {
  private window: Array<{ outcome: StellarTransactionOutcome; timestamp: number }> = [];
  private readonly windowSize: number;

  constructor(windowSize: number = 1000) {
    this.windowSize = windowSize;
  }

  record(outcome: StellarTransactionOutcome): void {
    if (this.window.length >= this.windowSize) {
      this.window.shift();
    }
    this.window.push({ outcome, timestamp: Date.now() });
  }

  getStats(): StellarSubmissionStats {
    const outcomeCounts: Record<StellarTransactionOutcome, number> = {
      success: 0,
      rpc_error: 0,
      contract_panic: 0,
      xdr_invalid: 0,
      network_error: 0,
    };

    for (const item of this.window) {
      outcomeCounts[item.outcome] = (outcomeCounts[item.outcome] || 0) + 1;
    }

    const totalSubmissions = this.window.length;
    const successCount = outcomeCounts.success;
    const failureCount = totalSubmissions - successCount;
    const successRate = totalSubmissions > 0 ? successCount / totalSubmissions : 1.0;
    const failureRate = totalSubmissions > 0 ? failureCount / totalSubmissions : 0.0;

    return {
      totalSubmissions,
      successCount,
      failureCount,
      successRate,
      failureRate,
      outcomeCounts,
    };
  }

  clear(): void {
    this.window = [];
  }
}

const rollingTxTracker = new RollingTransactionTracker(1000);

let submissionCounter: Counter | undefined;
let submissionDuration: Histogram | undefined;
let submissionSuccessRateGauge: Gauge | undefined;
let rpcNodeHealthGauge: Gauge | undefined;
let rpcDuration: Histogram | undefined;
let pgPoolActiveConnections: Gauge | undefined;
let pgPoolIdleConnections: Gauge | undefined;
let pgPoolWaitingQueries: Gauge | undefined;
let pgPoolTimeoutTotal: Counter | undefined;
let duplicateEventAttempts: Counter | undefined;
let evidenceBatchDuration: Histogram | undefined;
let evidenceBatchRetries: Counter | undefined;
let evidenceRecordsChecked: Counter | undefined;
let webhookDeliveryTotal: Counter | undefined;
let webhookDeliveryFailuresTotal: Counter | undefined;
let webhookDeliveryConsecutiveFailures: Counter | undefined;
let webhookDeliveryDuration: Histogram | undefined;
let webhookDeadLetterTotal: Counter | undefined;
let customRecorder: StellarMetricsRecorder | null = null;
let redisMemoryUsedBytes: Gauge | undefined;
let redisMemoryMaxBytes: Gauge | undefined;
let redisMemoryUsageRatio: Gauge | undefined;
let redisMemoryAlert: Gauge | undefined;
let redisEvictedKeysTotal: Counter | undefined;
let redisMaxmemoryPolicy: Gauge | undefined;
let redisUp: Gauge | undefined;

function getMeter() {
  return metrics.getMeter(METER_NAME);
}

function getSubmissionCounter(): Counter {
  if (!submissionCounter) {
    submissionCounter = getMeter().createCounter(
      "stellar_transaction_submissions_total",
      {
        description: "Total Stellar transaction submission attempts",
      },
    );
  }
  return submissionCounter;
}

function getSubmissionDuration(): Histogram {
  if (!submissionDuration) {
    submissionDuration = getMeter().createHistogram(
      "stellar_transaction_duration_ms",
      {
        description: "Stellar transaction submission latency in milliseconds",
        unit: "ms",
      },
    );
  }
  return submissionDuration;
}

function getRpcDuration(): Histogram {
  if (!rpcDuration) {
    rpcDuration = getMeter().createHistogram("stellar_rpc_duration_ms", {
      description: "Stellar Soroban RPC call latency in milliseconds",
      unit: "ms",
    });
  }
  return rpcDuration;
}

function getPgPoolActiveConnections(): Gauge {
  if (!pgPoolActiveConnections) {
    pgPoolActiveConnections = getMeter().createGauge(
      "pg_pool_active_connections",
      {
        description: "Number of active PostgreSQL connections in the pool",
        unit: "1",
      },
    );
  }
  return pgPoolActiveConnections;
}

function getPgPoolIdleConnections(): Gauge {
  if (!pgPoolIdleConnections) {
    pgPoolIdleConnections = getMeter().createGauge(
      "pg_pool_idle_connections",
      {
        description: "Number of idle PostgreSQL connections in the pool",
        unit: "1",
      },
    );
  }
  return pgPoolIdleConnections;
}

function getPgPoolWaitingQueries(): Gauge {
  if (!pgPoolWaitingQueries) {
    pgPoolWaitingQueries = getMeter().createGauge(
      "pg_pool_waiting_queries",
      {
        description: "Number of queries waiting for a connection from the pool",
        unit: "1",
      },
    );
  }
  return pgPoolWaitingQueries;
}

function getPgPoolTimeoutTotal(): Counter {
  if (!pgPoolTimeoutTotal) {
    pgPoolTimeoutTotal = getMeter().createCounter(
      "pg_pool_timeout_total",
      {
        description: "Total number of connections that waited too long for a pool connection",
        unit: "1",
      },
    );
  }
  return pgPoolTimeoutTotal;
}

function getDuplicateEventAttempts(): Counter {
  if (!duplicateEventAttempts) {
    duplicateEventAttempts = getMeter().createCounter(
      "event_duplicate_attempts_total",
      {
        description: "Total duplicate on-chain event ingestion attempts",
        unit: "1",
      },
    );
  }
  return duplicateEventAttempts;
}

function getEvidenceBatchDuration(): Histogram {
  if (!evidenceBatchDuration) {
    evidenceBatchDuration = getMeter().createHistogram(
      "evidence_verification_batch_duration_ms",
      {
        description: "Time to verify one page of evidence pins",
        unit: "ms",
      },
    );
  }
  return evidenceBatchDuration;
}

function getEvidenceBatchRetries(): Counter {
  if (!evidenceBatchRetries) {
    evidenceBatchRetries = getMeter().createCounter(
      "evidence_verification_batch_retries_total",
      {
        description: "Total retry rounds spent on transient pin-check failures",
        unit: "1",
      },
    );
  }
  return evidenceBatchRetries;
}

function getWebhookDeliveryTotal(): Counter {
  if (!webhookDeliveryTotal) {
    webhookDeliveryTotal = getMeter().createCounter(
      "webhook_delivery_attempts_total",
      {
        description: "Total webhook delivery attempts",
        unit: "1",
      },
    );
  }
  return webhookDeliveryTotal;
}

function getWebhookDeliveryFailuresTotal(): Counter {
  if (!webhookDeliveryFailuresTotal) {
    webhookDeliveryFailuresTotal = getMeter().createCounter(
      "webhook_delivery_failures_total",
      {
        description: "Total webhook delivery failures",
        unit: "1",
      },
    );
  }
  return webhookDeliveryFailuresTotal;
}

function getWebhookDeliveryConsecutiveFailures(): Counter {
  if (!webhookDeliveryConsecutiveFailures) {
    webhookDeliveryConsecutiveFailures = getMeter().createCounter(
      "webhook_delivery_consecutive_failures_total",
      {
        description: "Total webhook delivery consecutive failure streaks",
        unit: "1",
      },
    );
  }
  return webhookDeliveryConsecutiveFailures;
}

function getWebhookDeliveryDuration(): Histogram {
  if (!webhookDeliveryDuration) {
    webhookDeliveryDuration = getMeter().createHistogram(
      "webhook_delivery_duration_ms",
      {
        description: "Webhook delivery attempt latency in milliseconds",
        unit: "ms",
      },
    );
  }
  return webhookDeliveryDuration;
}

function getWebhookDeadLetterTotal(): Counter {
  if (!webhookDeadLetterTotal) {
    webhookDeadLetterTotal = getMeter().createCounter(
      "webhook_dead_letter_total",
      {
        description: "Total webhook deliveries moved to dead-letter queue",
        unit: "1",
      },
    );
  }
  return webhookDeadLetterTotal;
}

function getEvidenceRecordsChecked(): Counter {
  if (!evidenceRecordsChecked) {
    evidenceRecordsChecked = getMeter().createCounter(
      "evidence_verification_records_checked_total",
      {
        description: "Total evidence records checked during verification passes",
        unit: "1",
      },
    );
  }
  return evidenceRecordsChecked;
}

function getSubmissionSuccessRateGauge(): Gauge {
  if (!submissionSuccessRateGauge) {
    submissionSuccessRateGauge = getMeter().createGauge(
      "stellar_transaction_success_rate",
      {
        description: "Rolling success rate of Stellar transaction submissions (0.0 to 1.0)",
        unit: "1",
      },
    );
  }
  return submissionSuccessRateGauge;
}

function getRpcNodeHealthGauge(): Gauge {
  if (!rpcNodeHealthGauge) {
    rpcNodeHealthGauge = getMeter().createGauge(
      "stellar_rpc_health_status",
      {
        description: "Stellar RPC node health status (1 = healthy, 0 = unhealthy)",
        unit: "1",
      },
    );
  }
  return rpcNodeHealthGauge;
}

function getRedisMemoryUsedBytes(): Gauge {
  if (!redisMemoryUsedBytes) {
    redisMemoryUsedBytes = getMeter().createGauge("redis_memory_used_bytes", {
      description: "Current Redis memory usage in bytes",
      unit: "By",
    });
  }
  return redisMemoryUsedBytes;
}

function getRedisMemoryMaxBytes(): Gauge {
  if (!redisMemoryMaxBytes) {
    redisMemoryMaxBytes = getMeter().createGauge("redis_memory_max_bytes", {
      description: "Configured Redis maxmemory limit in bytes",
      unit: "By",
    });
  }
  return redisMemoryMaxBytes;
}

function getRedisMemoryUsageRatio(): Gauge {
  if (!redisMemoryUsageRatio) {
    redisMemoryUsageRatio = getMeter().createGauge("redis_memory_usage_ratio", {
      description: "Redis memory usage as a fraction of maxmemory",
      unit: "1",
    });
  }
  return redisMemoryUsageRatio;
}

function getRedisMemoryAlert(): Gauge {
  if (!redisMemoryAlert) {
    redisMemoryAlert = getMeter().createGauge("redis_memory_alert", {
      description: "1 when Redis memory usage exceeds the 80% alert threshold, 0 otherwise",
      unit: "1",
    });
  }
  return redisMemoryAlert;
}

function getRedisEvictedKeysTotal(): Counter {
  if (!redisEvictedKeysTotal) {
    redisEvictedKeysTotal = getMeter().createCounter(
      "redis_evicted_keys_total",
      {
        description: "Total number of keys evicted by Redis maxmemory policy",
        unit: "1",
      },
    );
  }
  return redisEvictedKeysTotal;
}

function getRedisMaxmemoryPolicy(): Gauge {
  if (!redisMaxmemoryPolicy) {
    redisMaxmemoryPolicy = getMeter().createGauge("redis_maxmemory_policy", {
      description: "Configured Redis maxmemory-policy",
      unit: "1",
    });
  }
  return redisMaxmemoryPolicy;
}

function getRedisUp(): Gauge {
  if (!redisUp) {
    redisUp = getMeter().createGauge("redis_up", {
      description: "1 if Redis is reachable, 0 otherwise",
      unit: "1",
    });
  }
  return redisUp;
}

export interface EvidenceBatchMetric {
  recordCount: number;
  durationMs: number;
  retries: number;
  failedCidCount: number;
}

/** Record timing/retry metrics for a single evidence-verification batch. */
export function recordEvidenceVerificationBatch(
  metric: EvidenceBatchMetric,
): void {
  const failed = metric.failedCidCount > 0 ? "true" : "false";
  getEvidenceBatchDuration().record(metric.durationMs, { failed });
  getEvidenceRecordsChecked().add(metric.recordCount);
  if (metric.retries > 0) {
    getEvidenceBatchRetries().add(metric.retries);
  }
}

export function recordTransactionSubmission(
  operation: string,
  outcome: StellarTransactionOutcome,
  durationMs: number,
): void {
  rollingTxTracker.record(outcome);
  const stats = rollingTxTracker.getStats();

  if (customRecorder) {
    customRecorder.recordTransactionSubmission(operation, outcome, durationMs);
    return;
  }

  const labels = { operation, outcome };
  getSubmissionCounter().add(1, labels);
  getSubmissionDuration().record(durationMs, labels);
  getSubmissionSuccessRateGauge().record(stats.successRate, { operation });
}

export function recordRpcNodeHealth(url: string, isHealthy: boolean, latencyMs: number): void {
  if (customRecorder?.recordRpcNodeHealth) {
    customRecorder.recordRpcNodeHealth(url, isHealthy, latencyMs);
    return;
  }

  getRpcNodeHealthGauge().record(isHealthy ? 1 : 0, { rpc_url: url });
}

export function getTransactionSubmissionStats(): StellarSubmissionStats {
  return rollingTxTracker.getStats();
}

export function recordRpcCall(
  rpcMethod: StellarRpcMethod,
  outcome: StellarRpcOutcome,
  durationMs: number,
): void {
  if (customRecorder) {
    customRecorder.recordRpcCall(rpcMethod, outcome, durationMs);
    return;
  }

  getRpcDuration().record(durationMs, { rpc_method: rpcMethod, outcome });
}

export function recordPoolMetrics(metrics: PoolMetrics): void {
  getPgPoolActiveConnections().record(metrics.activeConnections);
  getPgPoolIdleConnections().record(metrics.idleConnections);
  getPgPoolWaitingQueries().record(metrics.waitingQueries);
}

export function recordPoolTimeout(): void {
  getPgPoolTimeoutTotal().add(1);
}

export function recordRedisMemoryMetrics(metrics: RedisMemoryMetrics): void {
  getRedisMemoryUsedBytes().record(metrics.usedMemoryBytes);
  getRedisMemoryMaxBytes().record(metrics.maxMemoryBytes);

  const ratio =
    metrics.maxMemoryBytes > 0
      ? metrics.usedMemoryBytes / metrics.maxMemoryBytes
      : 0;
  getRedisMemoryUsageRatio().record(ratio);
  getRedisMemoryAlert().record(
    ratio >= REDIS_MEMORY_ALERT_THRESHOLD ? 1 : 0,
  );
  getRedisMaxmemoryPolicy().record(1, {
    policy: metrics.maxmemoryPolicy ?? "unknown",
  });
}

export function recordRedisEvictions(delta: number): void {
  getRedisEvictedKeysTotal().add(delta);
}

export function recordRedisHealth(healthy: boolean): void {
  getRedisUp().record(healthy ? 1 : 0);
}

export function recordDuplicateEventAttempt(source: string, eventType: string): void {
  if (customRecorder?.recordDuplicateEventAttempt) {
    customRecorder.recordDuplicateEventAttempt(source, eventType);
    return;
  }

  getDuplicateEventAttempts().add(1, { source, event_type: eventType });
}

export function classifySubmissionError(error: unknown): StellarTransactionOutcome {
  if (!(error instanceof Error)) {
    return "network_error";
  }

  const message = error.message;
  if (/invalid transaction xdr|xdr/i.test(message)) {
    return "xdr_invalid";
  }
  if (/contract panic/i.test(message)) {
    return "contract_panic";
  }
  if (/rpc error/i.test(message)) {
    return "rpc_error";
  }
  return "network_error";
}

export function recordWebhookDelivery(
  outcome: "success" | "failure",
  durationMs: number,
  labels?: Record<string, string | number | boolean>,
): void {
  getWebhookDeliveryTotal().add(1, labels);
  getWebhookDeliveryDuration().record(durationMs, labels);
  if (outcome === "failure") {
    getWebhookDeliveryFailuresTotal().add(1, labels);
  }
}

export function recordWebhookDeadLetter(
  labels?: Record<string, string | number | boolean>,
): void {
  getWebhookDeadLetterTotal().add(1, labels);
}

export function recordWebhookConsecutiveFailures(
  labels?: Record<string, string | number | boolean>,
): void {
  getWebhookDeliveryConsecutiveFailures().add(1, labels);
}

export async function withRpcMetrics<T>(
  rpcMethod: StellarRpcMethod,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    recordRpcCall(rpcMethod, "success", performance.now() - start);
    return result;
  } catch (error) {
    recordRpcCall(rpcMethod, "error", performance.now() - start);
    throw error;
  }
}

/** Vitest/Jest-only hook to assert metric emissions without a live Prometheus endpoint. */
export function __setMetricsRecorderForTests(
  recorder: StellarMetricsRecorder | null,
): void {
  customRecorder = recorder;
}

export function __resetMetricsForTests(): void {
  customRecorder = null;
  submissionCounter = undefined;
  submissionDuration = undefined;
  submissionSuccessRateGauge = undefined;
  rpcNodeHealthGauge = undefined;
  rpcDuration = undefined;
  pgPoolActiveConnections = undefined;
  pgPoolIdleConnections = undefined;
  pgPoolWaitingQueries = undefined;
  pgPoolTimeoutTotal = undefined;
  duplicateEventAttempts = undefined;
  evidenceBatchDuration = undefined;
  evidenceBatchRetries = undefined;
  evidenceRecordsChecked = undefined;
  redisMemoryUsedBytes = undefined;
  redisMemoryMaxBytes = undefined;
  redisMemoryUsageRatio = undefined;
  redisMemoryAlert = undefined;
  redisEvictedKeysTotal = undefined;
  redisMaxmemoryPolicy = undefined;
  redisUp = undefined;
  rollingTxTracker.clear();
  webhookDeliveryTotal = undefined;
  webhookDeliveryFailuresTotal = undefined;
  webhookDeliveryConsecutiveFailures = undefined;
  webhookDeliveryDuration = undefined;
  webhookDeadLetterTotal = undefined;
}
