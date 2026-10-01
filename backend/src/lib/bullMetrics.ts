import { Queue } from "bullmq";
import { metrics } from "@opentelemetry/api";
import { appLogger } from "../middleware/logger";

const meter = metrics.getMeter("amana-backend");

const queueWaiting = meter.createObservableGauge("bull_queue_waiting", {
  description: "Number of waiting jobs in BullMQ queue",
});
const queueActive = meter.createObservableGauge("bull_queue_active", {
  description: "Number of active jobs in BullMQ queue",
});
const queueFailed = meter.createObservableGauge("bull_queue_failed", {
  description: "Number of failed jobs in BullMQ queue",
});

export const bullJobDuration = meter.createHistogram("bull_job_duration_seconds", {
  description: "BullMQ job processing duration in seconds",
  unit: "s",
});

export const bullJobFailedTotal = meter.createCounter("bull_job_failed_total", {
  description: "Total number of failed BullMQ jobs",
});

type QueueEntry = { name: string; queue: Queue };
const registeredQueues: QueueEntry[] = [];

/** Latest observed counts per queue, updated by the poller and read by stable OTEL callbacks. */
type QueueCountsSnapshot = { waiting: number; active: number; failed: number };
const latestCounts = new Map<string, QueueCountsSnapshot>();

type ObserveResult = { observe(value: number, attributes?: Record<string, string>): void };
type GaugeCallback = (result: ObserveResult) => void;

let callbacksRegistered = false;
let waitingCallback: GaugeCallback | null = null;
let activeCallback: GaugeCallback | null = null;
let failedCallback: GaugeCallback | null = null;

/**
 * Register the three observable-gauge callbacks exactly once.
 *
 * The callbacks are stable function references that read from `latestCounts`
 * and `registeredQueues` at collection time, so repeated polling never grows
 * the OTEL callback registry and every scrape observes the current values.
 */
function ensureCallbacksRegistered(): void {
  if (callbacksRegistered) return;
  waitingCallback = (result) => {
    for (const { name } of registeredQueues) {
      result.observe(latestCounts.get(name)?.waiting ?? 0, { queue: name });
    }
  };
  activeCallback = (result) => {
    for (const { name } of registeredQueues) {
      result.observe(latestCounts.get(name)?.active ?? 0, { queue: name });
    }
  };
  failedCallback = (result) => {
    for (const { name } of registeredQueues) {
      result.observe(latestCounts.get(name)?.failed ?? 0, { queue: name });
    }
  };
  queueWaiting.addCallback(waitingCallback);
  queueActive.addCallback(activeCallback);
  queueFailed.addCallback(failedCallback);
  callbacksRegistered = true;
}

/** Register a queue for metric collection. Call once per queue at startup. */
export function registerQueueForMetrics(name: string, queue: Queue): void {
  if (!registeredQueues.some((entry) => entry.name === name)) {
    registeredQueues.push({ name, queue });
    if (!latestCounts.has(name)) {
      latestCounts.set(name, { waiting: 0, active: 0, failed: 0 });
    }
  }
  ensureCallbacksRegistered();
}

async function collectQueueCounts(): Promise<void> {
  for (const { name, queue } of registeredQueues) {
    try {
      const counts = await queue.getJobCounts("waiting", "active", "failed");
      latestCounts.set(name, {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        failed: counts.failed ?? 0,
      });
    } catch (err) {
      appLogger.warn({ err, queue: name }, "Failed to collect BullMQ metrics");
    }
  }
}

let _collectionInterval: ReturnType<typeof setInterval> | null = null;

/** Start collecting queue metrics every 15 seconds. Idempotent. */
export function startQueueMetricsCollection(): void {
  ensureCallbacksRegistered();
  if (_collectionInterval) return;
  _collectionInterval = setInterval(() => {
    collectQueueCounts().catch((err) =>
      appLogger.warn({ err }, "BullMQ metrics collection error"),
    );
  }, 15_000);
  if (typeof (_collectionInterval as unknown as { unref?: () => void }).unref === "function") {
    (_collectionInterval as unknown as { unref: () => void }).unref();
  }
}

/** Stop collection (used in tests). */
export function stopQueueMetricsCollection(): void {
  if (_collectionInterval) {
    clearInterval(_collectionInterval);
    _collectionInterval = null;
  }
}

/**
 * Test-only helpers — not used in production.
 * Exposed so unit tests can assert callbacks are registered once and that
 * collection ticks update snapshots without growing the callback registry.
 */
export const __bullMetricsTestHooks = {
  getRegisteredQueueNames(): string[] {
    return registeredQueues.map((entry) => entry.name);
  },
  getLatestCounts(): Record<string, QueueCountsSnapshot> {
    return Object.fromEntries(latestCounts.entries());
  },
  areCallbacksRegistered(): boolean {
    return callbacksRegistered;
  },
  collectQueueCounts,
  resetForTests(): void {
    try {
      if (waitingCallback) queueWaiting.removeCallback(waitingCallback);
    } catch {
      /* ignore — gauge may not support removal in test doubles */
    }
    try {
      if (activeCallback) queueActive.removeCallback(activeCallback);
    } catch {
      /* ignore */
    }
    try {
      if (failedCallback) queueFailed.removeCallback(failedCallback);
    } catch {
      /* ignore */
    }
    registeredQueues.length = 0;
    latestCounts.clear();
    waitingCallback = null;
    activeCallback = null;
    failedCallback = null;
    callbacksRegistered = false;
    if (_collectionInterval) {
      clearInterval(_collectionInterval);
      _collectionInterval = null;
    }
  },
};
