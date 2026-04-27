/**
 * Issue #236: Event listener exactly-once semantics
 *
 * Tests idempotency, unique constraints, event ordering,
 * high-throughput scenarios, and restart recovery.
 */

import { vi } from "vitest";
import { EventType } from "../types/events";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockGetEvents, mockDispatchEvent } = vi.hoisted(() => ({
  mockGetEvents: vi.fn(),
  mockDispatchEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: vi.fn().mockImplementation(() => ({
      getEvents: (...args: unknown[]) => mockGetEvents(...args),
    })),
  },
  scValToNative: vi.fn(),
}));

vi.mock("../config/eventListener.config", () => ({
  getEventListenerConfig: vi.fn(),
}));

vi.mock("../services/eventHandlers", () => ({
  dispatchEvent: (...args: unknown[]) => mockDispatchEvent(...args),
}));

import {
  EventListenerService,
  isAlreadyProcessed,
  isPrismaUniqueConstraintError,
  processEventAtomically,
} from "../services/eventListener.service";
import * as StellarSdk from "@stellar/stellar-sdk";
import { getEventListenerConfig } from "../config/eventListener.config";

// ─── Config & helpers ─────────────────────────────────────────────────────────

const TEST_CONFIG = {
  rpcUrl: "https://test-rpc.example.com",
  contractId: "CONTRACT_IDEM_TEST",
  pollIntervalMs: 1000,
  backoffInitialMs: 100,
  backoffMaxMs: 5000,
  processedLedgersCacheSize: 200,
};

function createMockPrisma() {
  const mockTx = {
    trade: { upsert: vi.fn().mockResolvedValue({}) },
    processedEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  return {
    trade: { upsert: vi.fn().mockResolvedValue({}) },
    processedEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation(
      async (cb: (tx: typeof mockTx) => Promise<void>) => { await cb(mockTx); }
    ),
    _mockTx: mockTx,
  } as any;
}

function makeRawEvent(
  ledger: number,
  id = `evt-${ledger}`,
  contractId = "CONTRACT_IDEM_TEST",
  symbol = "TradeCreated",
  tradeId = `trade-${ledger}`,
) {
  return { ledger, id, contractId, topic: [{ _sym: symbol }, { _id: tradeId }], value: {} };
}

function setupScValMock(symbol: string, tradeId: string) {
  (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
    .mockReturnValueOnce(symbol)
    .mockReturnValueOnce(tradeId);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("EventListener — exactly-once semantics", () => {
  let service: EventListenerService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockGetEvents.mockReset().mockResolvedValue({ events: [] });
    mockDispatchEvent.mockReset().mockResolvedValue(undefined);
    (StellarSdk.scValToNative as ReturnType<typeof vi.fn>).mockReset();
    vi.mocked(getEventListenerConfig).mockReturnValue(TEST_CONFIG);

    mockPrisma = createMockPrisma();
    service = new EventListenerService(mockPrisma);
    (service as any).running = true;
    (service as any).server = { getEvents: (...a: unknown[]) => mockGetEvents(...a) };
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── 1. Idempotency ──────────────────────────────────────────────────────────

  describe("Idempotency — same event processed only once", () => {
    it("processes TradeCreated event exactly once on first encounter", async () => {
      const raw = makeRawEvent(1000);
      setupScValMock("TradeCreated", "trade-1000");
      await service.processEvent(raw as any);
      expect(mockDispatchEvent).toHaveBeenCalledTimes(1);
    });

    it("does NOT dispatch when same event replayed (in-memory cache hit)", async () => {
      const raw = makeRawEvent(1001, "evt-1001");
      setupScValMock("TradeCreated", "trade-1001");
      await service.processEvent(raw as any);

      setupScValMock("TradeCreated", "trade-1001");
      await service.processEvent(raw as any);

      expect(mockDispatchEvent).toHaveBeenCalledTimes(1);
    });

    it("does NOT dispatch when same event replayed after simulated restart (DB hit)", async () => {
      const raw = makeRawEvent(1002, "evt-1002");
      // Simulate restart: DB already has the record, in-memory cache is empty
      mockPrisma.processedEvent.findUnique.mockResolvedValue({
        id: 1,
        ledgerSequence: 1002,
        contractId: "CONTRACT_IDEM_TEST",
        eventId: "evt-1002",
        processedAt: new Date(),
      });

      setupScValMock("TradeCreated", "trade-1002");
      await service.processEvent(raw as any);

      expect(mockDispatchEvent).not.toHaveBeenCalled();
    });

    it("inserts ProcessedEvent record atomically with handler call", async () => {
      const raw = makeRawEvent(1003, "evt-1003");
      setupScValMock("TradeFunded", "trade-1003");
      await service.processEvent(raw as any);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma._mockTx.processedEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ledgerSequence: 1003,
            contractId: "CONTRACT_IDEM_TEST",
            eventId: "evt-1003",
          }),
        }),
      );
    });

    it("swallows P2002 unique-constraint error (concurrent duplicate insert)", async () => {
      const raw = makeRawEvent(1004, "evt-1004");
      setupScValMock("TradeCreated", "trade-1004");

      // Simulate concurrent duplicate: transaction throws P2002
      mockPrisma.$transaction.mockRejectedValueOnce({ code: "P2002" });

      await expect(service.processEvent(raw as any)).resolves.not.toThrow();
    });

    it("does NOT add event to cache when transaction fails with non-P2002 error", async () => {
      const raw = makeRawEvent(1005, "evt-1005");
      setupScValMock("TradeCreated", "trade-1005");
      mockPrisma.$transaction.mockRejectedValueOnce(new Error("DB connection lost"));

      await service.processEvent(raw as any);

      const cacheKey = `1005:CONTRACT_IDEM_TEST:evt-1005`;
      expect((service as any).processedEvents.has(cacheKey)).toBe(false);
    });
  });

  // ── 2. Unique constraint helpers ────────────────────────────────────────────

  describe("isPrismaUniqueConstraintError", () => {
    it("returns true for P2002 error code", () => {
      expect(isPrismaUniqueConstraintError({ code: "P2002" })).toBe(true);
    });

    it("returns false for other Prisma error codes", () => {
      expect(isPrismaUniqueConstraintError({ code: "P2003" })).toBe(false);
      expect(isPrismaUniqueConstraintError({ code: "P2025" })).toBe(false);
    });

    it("returns false for generic Error objects", () => {
      expect(isPrismaUniqueConstraintError(new Error("oops"))).toBe(false);
    });

    it("returns false for null/undefined", () => {
      expect(isPrismaUniqueConstraintError(null)).toBe(false);
      expect(isPrismaUniqueConstraintError(undefined)).toBe(false);
    });
  });

  describe("isAlreadyProcessed", () => {
    it("returns false when no DB record exists", async () => {
      mockPrisma.processedEvent.findUnique.mockResolvedValue(null);
      const result = await isAlreadyProcessed(mockPrisma, {
        ledgerSequence: 42,
        contractId: "C",
        eventId: "e",
      });
      expect(result).toBe(false);
    });

    it("returns true when DB record exists", async () => {
      mockPrisma.processedEvent.findUnique.mockResolvedValue({ id: 1 });
      const result = await isAlreadyProcessed(mockPrisma, {
        ledgerSequence: 42,
        contractId: "C",
        eventId: "e",
      });
      expect(result).toBe(true);
    });

    it("queries using composite key (ledgerSequence_contractId_eventId)", async () => {
      mockPrisma.processedEvent.findUnique.mockResolvedValue(null);
      const key = { ledgerSequence: 99, contractId: "CONTRACT_X", eventId: "evt-99" };
      await isAlreadyProcessed(mockPrisma, key);
      expect(mockPrisma.processedEvent.findUnique).toHaveBeenCalledWith({
        where: { ledgerSequence_contractId_eventId: key },
      });
    });
  });

  // ── 3. Event ordering ───────────────────────────────────────────────────────

  describe("Event ordering", () => {
    it("processes multiple events from the same block in submission order", async () => {
      const order: string[] = [];
      mockDispatchEvent.mockImplementation(async (_tx: unknown, event: any) => {
        order.push(event.eventId);
      });

      const events = [
        makeRawEvent(2000, "evt-2000-a"),
        makeRawEvent(2000, "evt-2000-b"),
        makeRawEvent(2000, "evt-2000-c"),
      ];
      mockGetEvents.mockResolvedValue({ events });

      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("TradeCreated").mockReturnValueOnce("t-1")
        .mockReturnValueOnce("TradeFunded").mockReturnValueOnce("t-1")
        .mockReturnValueOnce("DeliveryConfirmed").mockReturnValueOnce("t-1");

      await service.pollEvents();

      expect(order).toEqual(["evt-2000-a", "evt-2000-b", "evt-2000-c"]);
    });

    it("maintains causality across blocks (TradeCreated before TradeFunded)", async () => {
      const order: string[] = [];
      mockDispatchEvent.mockImplementation(async (_tx: unknown, event: any) => {
        order.push(event.eventType);
      });

      const events = [
        makeRawEvent(3000, "evt-3000", "CONTRACT_IDEM_TEST", "TradeCreated", "t-1"),
        makeRawEvent(3001, "evt-3001", "CONTRACT_IDEM_TEST", "TradeFunded", "t-1"),
      ];
      mockGetEvents.mockResolvedValue({ events });

      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("TradeCreated").mockReturnValueOnce("t-1")
        .mockReturnValueOnce("TradeFunded").mockReturnValueOnce("t-1");

      await service.pollEvents();

      expect(order[0]).toBe(EventType.TradeCreated);
      expect(order[1]).toBe(EventType.TradeFunded);
    });

    it("updates lastLedger to the highest ledger seen", async () => {
      const events = [
        makeRawEvent(4000, "evt-4000"),
        makeRawEvent(4001, "evt-4001"),
        makeRawEvent(4002, "evt-4002"),
      ];
      mockGetEvents.mockResolvedValue({ events });

      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("TradeCreated").mockReturnValueOnce("t-1")
        .mockReturnValueOnce("TradeFunded").mockReturnValueOnce("t-1")
        .mockReturnValueOnce("DisputeInitiated").mockReturnValueOnce("t-1");

      await service.pollEvents();

      expect((service as any).lastLedger).toBe(4002);
    });
  });

  // ── 4. High-throughput scenarios ────────────────────────────────────────────

  describe("High-throughput scenarios", () => {
    it("processes 50 rapid events — all dispatched, none duplicated", async () => {
      const events = Array.from({ length: 50 }, (_, i) =>
        makeRawEvent(5000 + i, `evt-${5000 + i}`)
      );
      mockGetEvents.mockResolvedValue({ events });

      for (let i = 0; i < 50; i++) {
        (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
          .mockReturnValueOnce("TradeCreated")
          .mockReturnValueOnce(`trade-${i}`);
      }

      await service.pollEvents();

      expect(mockDispatchEvent).toHaveBeenCalledTimes(50);
    });

    it("processes 100 events atomically — all ProcessedEvent records created", async () => {
      const events = Array.from({ length: 100 }, (_, i) =>
        makeRawEvent(6000 + i, `evt-${6000 + i}`)
      );
      mockGetEvents.mockResolvedValue({ events });

      for (let i = 0; i < 100; i++) {
        (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
          .mockReturnValueOnce("TradeFunded")
          .mockReturnValueOnce(`trade-${i}`);
      }

      await service.pollEvents();

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(100);
    });

    it("skips already-processed events in a batch without affecting new ones", async () => {
      // Pre-populate cache with first 3 event keys
      const CONTRACT = "CONTRACT_IDEM_TEST";
      for (let i = 0; i < 3; i++) {
        (service as any).processedEvents.add(`7000:${CONTRACT}:evt-700${i}`);
      }

      // Build 5 events; first 3 are cache hits, last 2 are new
      const events = Array.from({ length: 5 }, (_, i) =>
        makeRawEvent(7000, `evt-700${i}`, CONTRACT)
      );
      mockGetEvents.mockResolvedValue({ events });

      // parseEvent calls scValToNative for ALL events (before cache check)
      // so we need 5 * 2 = 10 mock return values
      for (let i = 0; i < 5; i++) {
        (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
          .mockReturnValueOnce("TradeCreated")
          .mockReturnValueOnce(`trade-${i}`);
      }

      await service.pollEvents();

      // Only 2 new events should be dispatched (first 3 are cache hits)
      expect(mockDispatchEvent).toHaveBeenCalledTimes(2);
    });
  });

  // ── 5. Restart recovery ─────────────────────────────────────────────────────

  describe("Restart recovery", () => {
    it("hydrates in-memory cache from DB on start()", async () => {
      const fresh = new EventListenerService(mockPrisma);
      mockPrisma.processedEvent.findMany.mockResolvedValue([
        { ledgerSequence: 8000, contractId: "CONTRACT_IDEM_TEST", eventId: "evt-8000" },
        { ledgerSequence: 7999, contractId: "CONTRACT_IDEM_TEST", eventId: "evt-7999" },
      ]);

      await fresh.start();

      const cache: Set<string> = (fresh as any).processedEvents;
      expect(cache.has("8000:CONTRACT_IDEM_TEST:evt-8000")).toBe(true);
      expect(cache.has("7999:CONTRACT_IDEM_TEST:evt-7999")).toBe(true);
      fresh.stop();
    });

    it("sets lastLedger to highest ledger from DB on start()", async () => {
      const fresh = new EventListenerService(mockPrisma);
      mockPrisma.processedEvent.findMany.mockResolvedValue([
        { ledgerSequence: 9500, contractId: "C", eventId: "e1" },
        { ledgerSequence: 9000, contractId: "C", eventId: "e2" },
      ]);

      await fresh.start();

      expect((fresh as any).lastLedger).toBe(9500);
      fresh.stop();
    });

    it("resumes polling from lastLedger + 1 after restart", async () => {
      const fresh = new EventListenerService(mockPrisma);
      // Wire up the mock server on the fresh instance
      (fresh as any).server = { getEvents: (...a: unknown[]) => mockGetEvents(...a) };
      mockPrisma.processedEvent.findMany.mockResolvedValue([
        { ledgerSequence: 10000, contractId: "C", eventId: "e1" },
      ]);
      mockGetEvents.mockResolvedValue({ events: [] });

      await fresh.start();
      await fresh.pollEvents();

      expect(mockGetEvents).toHaveBeenCalledWith(
        expect.objectContaining({ startLedger: 10001 }),
      );
      fresh.stop();
    });

    it("does NOT reprocess events already in DB after restart", async () => {
      // Simulate restart: DB has the event, in-memory cache is empty
      mockPrisma.processedEvent.findUnique.mockResolvedValue({
        id: 1,
        ledgerSequence: 11000,
        contractId: "CONTRACT_IDEM_TEST",
        eventId: "evt-11000",
        processedAt: new Date(),
      });

      const raw = makeRawEvent(11000, "evt-11000");
      setupScValMock("TradeCreated", "trade-11000");
      await service.processEvent(raw as any);

      expect(mockDispatchEvent).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("start() is idempotent — DB queried only once even if called twice", async () => {
      const fresh = new EventListenerService(mockPrisma);
      mockPrisma.processedEvent.findMany.mockResolvedValue([]);

      await fresh.start();
      await fresh.start();

      expect(mockPrisma.processedEvent.findMany).toHaveBeenCalledTimes(1);
      fresh.stop();
    });

    it("lastLedger stays 0 when DB has no processed events", async () => {
      const fresh = new EventListenerService(mockPrisma);
      mockPrisma.processedEvent.findMany.mockResolvedValue([]);

      await fresh.start();

      expect((fresh as any).lastLedger).toBe(0);
      fresh.stop();
    });
  });

  // ── 6. processEventAtomically ───────────────────────────────────────────────

  describe("processEventAtomically", () => {
    const baseEvent = {
      eventType: EventType.TradeCreated,
      tradeId: "t-atomic",
      ledgerSequence: 12000,
      contractId: "CONTRACT_IDEM_TEST",
      eventId: "evt-12000",
      data: {},
    };

    it("calls handler and creates ProcessedEvent in same transaction", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      await processEventAtomically(mockPrisma, baseEvent, handler);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(mockPrisma._mockTx, baseEvent);
      expect(mockPrisma._mockTx.processedEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            ledgerSequence: 12000,
            contractId: "CONTRACT_IDEM_TEST",
            eventId: "evt-12000",
          },
        }),
      );
    });

    it("silently ignores P2002 duplicate constraint error", async () => {
      mockPrisma.$transaction.mockRejectedValueOnce({ code: "P2002" });
      const handler = vi.fn().mockResolvedValue(undefined);

      await expect(
        processEventAtomically(mockPrisma, baseEvent, handler)
      ).resolves.not.toThrow();
    });

    it("re-throws non-P2002 errors", async () => {
      mockPrisma.$transaction.mockRejectedValueOnce(new Error("disk full"));
      const handler = vi.fn().mockResolvedValue(undefined);

      await expect(
        processEventAtomically(mockPrisma, baseEvent, handler)
      ).rejects.toThrow("disk full");
    });
  });
});
