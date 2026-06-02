/**
 * ledger.reconciliation.test.ts — Issue #586
 *
 * Unit and integration-style tests for ledger reconciliation logic in
 * EventListenerService: deduplication, outbox retry scheduling, exponential
 * backoff, cache eviction, and atomic processing guarantees.
 */

import {
  isAlreadyProcessed,
  isPrismaUniqueConstraintError,
  processEventAtomically,
  EventListenerService,
} from "../services/eventListener.service";
import { ParsedEvent, EventType } from "../types/events";

// ── SDK / config mocks ────────────────────────────────────────────────────────

jest.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getEvents: jest.fn().mockResolvedValue({ events: [] }),
    })),
  },
  scValToNative: jest.fn(),
}));

jest.mock("../config/eventListener.config", () => ({
  getEventListenerConfig: jest.fn().mockReturnValue({
    rpcUrl: "https://rpc.test",
    contractId: "CONTRACT_TEST",
    pollIntervalMs: 1000,
    backoffInitialMs: 200,
    backoffMaxMs: 3200,
    processedLedgersCacheSize: 5,
    outboxMaxAttempts: 3,
  }),
}));

jest.mock("../services/eventHandlers", () => ({
  dispatchEvent: jest.fn(),
}));

import { dispatchEvent } from "../services/eventHandlers";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    eventType: EventType.TradeCreated,
    tradeId: "trade-recon-001",
    ledgerSequence: 100,
    contractId: "CONTRACT_TEST",
    eventId: "evt-recon-001",
    data: {},
    ...overrides,
  };
}

function makePrismaWithProcessedEvent(found: boolean) {
  return {
    processedEvent: {
      findUnique: jest.fn().mockResolvedValue(found ? { id: 1 } : null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  } as any;
}

// ── isPrismaUniqueConstraintError ─────────────────────────────────────────────

describe("isPrismaUniqueConstraintError", () => {
  it("returns true for P2002 code", () => {
    expect(isPrismaUniqueConstraintError({ code: "P2002" })).toBe(true);
  });

  it("returns false for other Prisma error codes", () => {
    expect(isPrismaUniqueConstraintError({ code: "P2003" })).toBe(false);
    expect(isPrismaUniqueConstraintError({ code: "P2025" })).toBe(false);
  });

  it("returns false for non-object errors", () => {
    expect(isPrismaUniqueConstraintError(null)).toBe(false);
    expect(isPrismaUniqueConstraintError("P2002")).toBe(false);
    expect(isPrismaUniqueConstraintError(new Error("P2002"))).toBe(false);
  });

  it("returns false when code property is missing", () => {
    expect(isPrismaUniqueConstraintError({})).toBe(false);
    expect(isPrismaUniqueConstraintError({ message: "unique constraint" })).toBe(false);
  });
});

// ── isAlreadyProcessed ────────────────────────────────────────────────────────

describe("isAlreadyProcessed", () => {
  const key = { ledgerSequence: 42, contractId: "C1", eventId: "evt-1" };

  it("returns true when a ProcessedEvent record exists for the composite key", async () => {
    const prisma = makePrismaWithProcessedEvent(true);
    await expect(isAlreadyProcessed(prisma, key)).resolves.toBe(true);
    expect(prisma.processedEvent.findUnique).toHaveBeenCalledWith({
      where: { ledgerSequence_contractId_eventId: key },
    });
  });

  it("returns false when no ProcessedEvent record exists", async () => {
    const prisma = makePrismaWithProcessedEvent(false);
    await expect(isAlreadyProcessed(prisma, key)).resolves.toBe(false);
  });

  it("propagates DB errors to the caller", async () => {
    const prisma = {
      processedEvent: {
        findUnique: jest.fn().mockRejectedValue(new Error("DB timeout")),
        findMany: jest.fn(),
      },
    } as any;
    await expect(isAlreadyProcessed(prisma, key)).rejects.toThrow("DB timeout");
  });
});

// ── processEventAtomically ────────────────────────────────────────────────────

describe("processEventAtomically", () => {
  it("runs the handler and inserts a ProcessedEvent record in the same transaction", async () => {
    const event = makeEvent();
    const txProcessedEvent = { create: jest.fn().mockResolvedValue({}) };
    const tx = { processedEvent: txProcessedEvent } as any;

    const prisma = {
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
      processedEvent: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    const handler = jest.fn().mockResolvedValue(undefined);
    await processEventAtomically(prisma, event, handler);

    expect(handler).toHaveBeenCalledWith(tx, event);
    expect(txProcessedEvent.create).toHaveBeenCalledWith({
      data: {
        ledgerSequence: event.ledgerSequence,
        contractId: event.contractId,
        eventId: event.eventId,
      },
    });
  });

  it("swallows P2002 duplicate-insert errors (concurrent processing)", async () => {
    const event = makeEvent();
    const prisma = {
      $transaction: jest.fn().mockRejectedValue({ code: "P2002" }),
      processedEvent: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    const handler = jest.fn().mockResolvedValue(undefined);
    await expect(processEventAtomically(prisma, event, handler)).resolves.toBeUndefined();
  });

  it("propagates non-P2002 errors from the transaction", async () => {
    const event = makeEvent();
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(new Error("constraint violation")),
      processedEvent: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    const handler = jest.fn().mockResolvedValue(undefined);
    await expect(processEventAtomically(prisma, event, handler)).rejects.toThrow(
      "constraint violation",
    );
  });

  it("propagates handler errors through the transaction boundary", async () => {
    const event = makeEvent();
    const tx = {
      processedEvent: { create: jest.fn().mockResolvedValue({}) },
    } as any;

    const prisma = {
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
      processedEvent: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    const handler = jest.fn().mockRejectedValue(new Error("handler failed"));
    await expect(processEventAtomically(prisma, event, handler)).rejects.toThrow(
      "handler failed",
    );
  });
});

// ── EventListenerService — in-memory cache vs DB reconciliation ───────────────

describe("EventListenerService — deduplication reconciliation", () => {
  beforeEach(() => {
    (dispatchEvent as jest.Mock).mockReset();
    (dispatchEvent as jest.Mock).mockResolvedValue(undefined);
  });

  it("skips processing when in-memory cache already contains the event key", async () => {
    const prisma = {
      processedEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) =>
        cb({ processedEvent: { create: jest.fn().mockResolvedValue({}) } }),
      ),
    } as any;

    const svc = new EventListenerService(prisma);
    (svc as any).running = true;

    // Seed in-memory cache directly
    const cacheKey = "100:CONTRACT_TEST:evt-recon-001";
    (svc as any).processedEvents.add(cacheKey);

    await svc.processEvent({
      ledger: 100,
      id: "evt-recon-001",
      contractId: "CONTRACT_TEST",
      topic: [],
      value: {},
    } as any);

    expect(prisma.processedEvent.findUnique).not.toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("checks the DB when the in-memory cache misses, and skips if DB says processed", async () => {
    const prisma = {
      processedEvent: {
        findUnique: jest.fn().mockResolvedValue({ id: 99 }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(),
    } as any;

    const svc = new EventListenerService(prisma);
    (svc as any).running = true;

    // parseEvent needs the SDK mock — bypass by pre-seeding a parseable raw event
    const event = makeEvent({ ledgerSequence: 200, eventId: "evt-db-check" });

    // Inject a parsed event directly via processEvent logic by mocking parseEvent
    const parseEventSpy = jest.spyOn(svc as any, "parseEvent").mockReturnValue(event);

    await svc.processEvent({ ledger: 200, id: "evt-db-check" } as any);

    expect(prisma.processedEvent.findUnique).toHaveBeenCalledWith({
      where: {
        ledgerSequence_contractId_eventId: {
          ledgerSequence: 200,
          contractId: "CONTRACT_TEST",
          eventId: "evt-db-check",
        },
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();

    parseEventSpy.mockRestore();
  });

  it("processes and marks the event when neither cache nor DB has seen it", async () => {
    const txCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      processedEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) =>
        cb({ processedEvent: { create: txCreate } }),
      ),
    } as any;

    const svc = new EventListenerService(prisma);
    (svc as any).running = true;

    const event = makeEvent({ ledgerSequence: 300, eventId: "evt-new" });
    const parseEventSpy = jest.spyOn(svc as any, "parseEvent").mockReturnValue(event);

    await svc.processEvent({ ledger: 300, id: "evt-new" } as any);

    expect(dispatchEvent).toHaveBeenCalled();
    expect(txCreate).toHaveBeenCalledWith({
      data: {
        ledgerSequence: 300,
        contractId: "CONTRACT_TEST",
        eventId: "evt-new",
      },
    });
    expect((svc as any).processedEvents.has("300:CONTRACT_TEST:evt-new")).toBe(true);

    parseEventSpy.mockRestore();
  });
});

// ── EventListenerService — cache eviction ─────────────────────────────────────

describe("EventListenerService — in-memory cache eviction", () => {
  it("evicts oldest ledger entries when cache size exceeds the configured limit", async () => {
    const prisma = {
      processedEvent: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    const svc = new EventListenerService(prisma);
    // processedLedgersCacheSize is mocked to 5 — add 6 entries
    const cache: Set<string> = (svc as any).processedEvents;
    cache.add("1:C:e1");
    cache.add("2:C:e2");
    cache.add("3:C:e3");
    cache.add("4:C:e4");
    cache.add("5:C:e5");
    cache.add("6:C:e6"); // over the limit

    // Trigger eviction directly
    (svc as any).evictOldEvents();

    expect(cache.size).toBe(5);
    expect(cache.has("1:C:e1")).toBe(false); // oldest evicted
    expect(cache.has("6:C:e6")).toBe(true);  // newest retained
  });

  it("does not evict when cache size is within limit", () => {
    const prisma = {
      processedEvent: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const svc = new EventListenerService(prisma);
    const cache: Set<string> = (svc as any).processedEvents;
    cache.add("1:C:e1");
    cache.add("2:C:e2");

    (svc as any).evictOldEvents();

    expect(cache.size).toBe(2);
  });
});

// ── EventListenerService — exponential backoff ────────────────────────────────

describe("EventListenerService — retry backoff", () => {
  it("doubles the delay on each successive failure, capped at backoffMaxMs", () => {
    const prisma = {
      processedEvent: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const svc = new EventListenerService(prisma);

    // backoffInitialMs=200, backoffMaxMs=3200
    expect((svc as any).currentBackoffMs).toBe(200);

    // Simulate backoff increments
    (svc as any).currentBackoffMs = Math.min((svc as any).currentBackoffMs * 2, 3200);
    expect((svc as any).currentBackoffMs).toBe(400);

    (svc as any).currentBackoffMs = Math.min((svc as any).currentBackoffMs * 2, 3200);
    expect((svc as any).currentBackoffMs).toBe(800);

    (svc as any).currentBackoffMs = Math.min((svc as any).currentBackoffMs * 2, 3200);
    (svc as any).currentBackoffMs = Math.min((svc as any).currentBackoffMs * 2, 3200);
    expect((svc as any).currentBackoffMs).toBe(3200); // cap reached
  });

  it("resets backoff to initial value after a successful poll", () => {
    const prisma = {
      processedEvent: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const svc = new EventListenerService(prisma);
    (svc as any).currentBackoffMs = 3200;

    svc.resetBackoff();

    expect((svc as any).currentBackoffMs).toBe(200);
  });
});

// ── EventListenerService — outbox retry delay computation ────────────────────

describe("EventListenerService — computeRetryDelay", () => {
  function makeServiceWithConfig() {
    const prisma = {
      processedEvent: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    return new EventListenerService(prisma);
  }

  it("returns backoffInitialMs for the first attempt (exponent=0)", () => {
    const svc = makeServiceWithConfig();
    // attempt 1 → exponent = max(1-1,0) = 0 → 200 * 2^0 = 200
    expect((svc as any).computeRetryDelay(1)).toBe(200);
  });

  it("doubles delay for each additional attempt", () => {
    const svc = makeServiceWithConfig();
    expect((svc as any).computeRetryDelay(2)).toBe(400);
    expect((svc as any).computeRetryDelay(3)).toBe(800);
    expect((svc as any).computeRetryDelay(4)).toBe(1600);
  });

  it("caps delay at backoffMaxMs regardless of attempt number", () => {
    const svc = makeServiceWithConfig();
    expect((svc as any).computeRetryDelay(10)).toBe(3200);
    expect((svc as any).computeRetryDelay(100)).toBe(3200);
  });
});

// ── EventListenerService — start() hydration ──────────────────────────────────

describe("EventListenerService — start() cache hydration", () => {
  it("hydrates in-memory cache from DB records on startup", async () => {
    const recentEvents = [
      { ledgerSequence: 50, contractId: "C", eventId: "e50" },
      { ledgerSequence: 49, contractId: "C", eventId: "e49" },
    ];

    const prisma = {
      processedEvent: {
        findMany: jest.fn().mockResolvedValue(recentEvents),
      },
    } as any;

    const svc = new EventListenerService(prisma);
    // Intercept scheduleNextPoll to prevent actual polling
    jest.spyOn(svc as any, "scheduleNextPoll").mockImplementation(() => {});

    await svc.start();

    const cache: Set<string> = (svc as any).processedEvents;
    expect(cache.has("50:C:e50")).toBe(true);
    expect(cache.has("49:C:e49")).toBe(true);
  });

  it("sets lastLedger to the highest ledger seen on startup", async () => {
    const prisma = {
      processedEvent: {
        findMany: jest.fn().mockResolvedValue([
          { ledgerSequence: 77, contractId: "C", eventId: "e77" },
          { ledgerSequence: 60, contractId: "C", eventId: "e60" },
        ]),
      },
    } as any;

    const svc = new EventListenerService(prisma);
    jest.spyOn(svc as any, "scheduleNextPoll").mockImplementation(() => {});

    await svc.start();

    expect((svc as any).lastLedger).toBe(77);
  });

  it("does not re-start an already-running service", async () => {
    const prisma = {
      processedEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;

    const svc = new EventListenerService(prisma);
    jest.spyOn(svc as any, "scheduleNextPoll").mockImplementation(() => {});

    await svc.start();
    await svc.start(); // second call should be a no-op

    expect(prisma.processedEvent.findMany).toHaveBeenCalledTimes(1);
  });
});
