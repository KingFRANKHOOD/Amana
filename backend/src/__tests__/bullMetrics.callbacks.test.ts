/**
 * Regression test for issue #1401:
 * Observable gauge callbacks were re-registered every 15s tick, leaking
 * callbacks and producing stale/duplicate readings.
 *
 * Fixed behavior: callbacks registered exactly once (stable references reading
 * a shared snapshot), collectQueueCounts only updates the snapshot.
 */

const addCallbackCounts = { waiting: 0, active: 0, failed: 0 };
const observed: Array<{ gauge: string; value: number; attrs: unknown }> = [];

function makeFakeGauge(name: "waiting" | "active" | "failed") {
  return {
    addCallback: jest.fn(() => {
      addCallbackCounts[name] += 1;
    }),
    removeCallback: jest.fn(),
  };
}

const fakeWaiting = makeFakeGauge("waiting");
const fakeActive = makeFakeGauge("active");
const fakeFailed = makeFakeGauge("failed");

jest.mock("@opentelemetry/api", () => ({
  metrics: {
    getMeter: jest.fn().mockReturnValue({
      createObservableGauge: jest.fn((n: string) => {
        if (n === "bull_queue_waiting") return fakeWaiting;
        if (n === "bull_queue_active") return fakeActive;
        return fakeFailed;
      }),
      createHistogram: jest.fn().mockReturnValue({ record: jest.fn() }),
      createCounter: jest.fn().mockReturnValue({ add: jest.fn() }),
    }),
  },
  trace: { getActiveSpan: jest.fn().mockReturnValue(null) },
}));

jest.mock("../middleware/logger", () => ({
  appLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  registerQueueForMetrics,
  startQueueMetricsCollection,
  stopQueueMetricsCollection,
  __bullMetricsTestHooks,
} from "../lib/bullMetrics";

function makeFakeQueue(counts: { waiting: number; active: number; failed: number }) {
  return {
    getJobCounts: jest.fn().mockResolvedValue({ ...counts }),
  } as any;
}

describe("bullMetrics #1401 — stable gauge callbacks", () => {
  beforeEach(() => {
    __bullMetricsTestHooks.resetForTests();
    addCallbackCounts.waiting = 0;
    addCallbackCounts.active = 0;
    addCallbackCounts.failed = 0;
    // Clear mock counts from previous module state
    (fakeWaiting.addCallback as jest.Mock).mockClear();
    (fakeActive.addCallback as jest.Mock).mockClear();
    (fakeFailed.addCallback as jest.Mock).mockClear();
  });

  afterEach(() => {
    stopQueueMetricsCollection();
    __bullMetricsTestHooks.resetForTests();
  });

  it("registers each gauge callback exactly once across many queues and ticks", async () => {
    const q1 = makeFakeQueue({ waiting: 1, active: 2, failed: 0 });
    const q2 = makeFakeQueue({ waiting: 5, active: 0, failed: 3 });

    registerQueueForMetrics("q1", q1);
    registerQueueForMetrics("q2", q2);
    // Duplicate registration must not duplicate queues or callbacks
    registerQueueForMetrics("q1", q1);

    expect(__bullMetricsTestHooks.getRegisteredQueueNames().sort()).toEqual(["q1", "q2"]);
    expect(__bullMetricsTestHooks.areCallbacksRegistered()).toBe(true);
    expect((fakeWaiting.addCallback as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((fakeActive.addCallback as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((fakeFailed.addCallback as jest.Mock)).toHaveBeenCalledTimes(1);

    // Simulate many 15s ticks — collectQueueCounts must NOT add callbacks
    await __bullMetricsTestHooks.collectQueueCounts();
    await __bullMetricsTestHooks.collectQueueCounts();
    await __bullMetricsTestHooks.collectQueueCounts();

    expect((fakeWaiting.addCallback as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((fakeActive.addCallback as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((fakeFailed.addCallback as jest.Mock)).toHaveBeenCalledTimes(1);

    // Snapshot holds latest values, not stale closures
    const counts = __bullMetricsTestHooks.getLatestCounts();
    expect(counts["q1"]).toEqual({ waiting: 1, active: 2, failed: 0 });
    expect(counts["q2"]).toEqual({ waiting: 5, active: 0, failed: 3 });

    // Second poll with new values overwrites (no accumulation)
    q1.getJobCounts.mockResolvedValue({ waiting: 9, active: 9, failed: 9 });
    await __bullMetricsTestHooks.collectQueueCounts();
    expect(__bullMetricsTestHooks.getLatestCounts()["q1"]).toEqual({
      waiting: 9,
      active: 9,
      failed: 9,
    });
  });

  it("startQueueMetricsCollection is idempotent and keeps single registration", () => {
    const q = makeFakeQueue({ waiting: 0, active: 0, failed: 0 });
    registerQueueForMetrics("only", q);
    startQueueMetricsCollection();
    startQueueMetricsCollection();
    expect((fakeWaiting.addCallback as jest.Mock)).toHaveBeenCalledTimes(1);
    expect(__bullMetricsTestHooks.areCallbacksRegistered()).toBe(true);
  });

  it("tolerates queue.getJobCounts failures without losing callbacks", async () => {
    const good = makeFakeQueue({ waiting: 2, active: 1, failed: 0 });
    const bad = { getJobCounts: jest.fn().mockRejectedValue(new Error("redis down")) } as any;
    registerQueueForMetrics("good", good);
    registerQueueForMetrics("bad", bad);
    await __bullMetricsTestHooks.collectQueueCounts();
    // Good queue still recorded, bad queue keeps default zeros
    expect(__bullMetricsTestHooks.getLatestCounts()["good"]).toEqual({
      waiting: 2,
      active: 1,
      failed: 0,
    });
    expect((fakeWaiting.addCallback as jest.Mock)).toHaveBeenCalledTimes(1);
  });
});
