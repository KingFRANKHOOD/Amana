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
let customRecorder: StellarMetricsRecorder | null = null;

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
  rollingTxTracker.clear();
}
