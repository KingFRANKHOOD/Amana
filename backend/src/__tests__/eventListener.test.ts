import { EventType } from "../types/events";

const vi = jest as any;

/* ------------------------------------------------------------------ */
/*  Hoisted mock variables (must be declared before vi.mock factories) */
/* ------------------------------------------------------------------ */

const mockGetEvents = vi.fn();
const mockDispatchEvent = vi.fn().mockResolvedValue(undefined);

/* ------------------------------------------------------------------ */
/*  Module-level mocks (hoisted by vitest)                            */
/* ------------------------------------------------------------------ */

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

/* Import after mocks are set up */
import { EventListenerService, isAlreadyProcessed } from "../services/eventListener.service";
import * as StellarSdk from "@stellar/stellar-sdk";
import { getEventListenerConfig } from "../config/eventListener.config";
import { appLogger } from "../middleware/logger";

const TEST_CONFIG = {
  rpcUrl: "https://test-rpc.example.com",
  contractId: "CONTRACT_TEST_123",
  pollIntervalMs: 1000,
  backoffInitialMs: 100,
  backoffMaxMs: 5000,
  processedLedgersCacheSize: 100,
  outboxMaxAttempts: 5,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function createMockPrisma() {
  const mockTx = {
    trade: { upsert: vi.fn().mockResolvedValue({}) },
    processedEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
  };

  return {
    trade: { upsert: vi.fn().mockResolvedValue({}) },
    processedEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation(async (cb: (tx: typeof mockTx) => Promise<void>) => {
      await cb(mockTx);
    }),
    _mockTx: mockTx,
  } as any;
}

/** Build a minimal raw Soroban event for testing. */
function makeRawEvent(ledger: number, id = `evt-${ledger}`, contractId = "CONTRACT_TEST_123") {
  return {
    ledger,
    id,
    contractId,
    topic: [{ _scval: "symbol" }, { _scval: "tradeId" }],
    value: { type: "test", value: {} },
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("EventListenerService", () => {
  let service: EventListenerService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    vi.useFakeTimers();

    /* Reset mocks but keep factory implementations intact */
    mockGetEvents.mockReset().mockResolvedValue({ events: [] });
    mockDispatchEvent.mockReset().mockResolvedValue(undefined);
    (StellarSdk.scValToNative as ReturnType<typeof vi.fn>).mockReset();
    vi.mocked(getEventListenerConfig).mockReturnValue(TEST_CONFIG);

    mockPrisma = createMockPrisma();
    service = new EventListenerService(mockPrisma);
    (service as any).running = true;
    // Override the server instance directly to use mockGetEvents
    (service as any).server = { getEvents: (...args: unknown[]) => mockGetEvents(...args) };

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /* ====== 0. isAlreadyProcessed helper ========================== */

  describe("isAlreadyProcessed", () => {
    const key = { ledgerSequence: 42, contractId: "CONTRACT_A", eventId: "evt-42" };

    it("should return false when no ProcessedEvent record exists", async () => {
      mockPrisma.processedEvent.findUnique.mockResolvedValue(null);

      const result = await isAlreadyProcessed(mockPrisma, key);

      expect(result).toBe(false);
      expect(mockPrisma.processedEvent.findUnique).toHaveBeenCalledWith({
        where: { ledgerSequence_contractId_eventId: key },
      });
    });

    it("should return true when a ProcessedEvent record exists", async () => {
      mockPrisma.processedEvent.findUnique.mockResolvedValue({
        id: 1,
        ledgerSequence: 42,
        contractId: "CONTRACT_A",
        eventId: "evt-42",
        processedAt: new Date(),
      });

      const result = await isAlreadyProcessed(mockPrisma, key);

      expect(result).toBe(true);
    });

    it("should query using the composite unique key name", async () => {
      mockPrisma.processedEvent.findUnique.mockResolvedValue(null);

      await isAlreadyProcessed(mockPrisma, key);

      expect(mockPrisma.processedEvent.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ledgerSequence_contractId_eventId: key },
        })
      );
    });
  });

  /* ====== 1. TradeFunded event processing ======================== */

  describe("TradeFunded event processing", () => {
    it("should dispatch a TradeFunded ParsedEvent after RPC returns the event", async () => {
      const raw = makeRawEvent(12345);
      mockGetEvents.mockResolvedValue({ events: [raw] });
      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("TRDFND");

      await service.pollEvents();

      // Verify the transaction was initiated for the parsed event
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma._mockTx.processedEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ledgerSequence: 12345,
            contractId: "CONTRACT_TEST_123",
            eventId: "evt-12345",
          }),
        })
      );
    });

    it("should check processedEvent in DB when event is not in cache", async () => {
      const raw = makeRawEvent(12345);
      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("TRDFND");

      await service.processEvent(raw as any);

      expect(mockPrisma.processedEvent.findUnique).toHaveBeenCalledWith({
        where: {
          ledgerSequence_contractId_eventId: {
            ledgerSequence: 12345,
            contractId: "CONTRACT_TEST_123",
            eventId: "evt-12345",
          },
        },
      });
    });

    it("should advance lastLedger after processing", async () => {
      const raw = makeRawEvent(500);
      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("TRDFND");

      await service.processEvent(raw as any);

      expect((service as any).lastLedger).toBe(500);
    });
  });

  /* ====== 2. Duplicate event rejection =========================== */

  describe("Duplicate event rejection", () => {
    it("should NOT dispatch when the same event (ledger+contractId+eventId) is processed twice", async () => {
      const raw = makeRawEvent(99999, "evt-99999", "CONTRACT_TEST_123");

      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("TRDCRT");
      await service.processEvent(raw as any);

      /* Second attempt — same composite key, in-memory cache hit */
      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("TRDCRT");
      await service.processEvent(raw as any);

      expect(mockDispatchEvent).toHaveBeenCalledTimes(1);
    });

    it("should allow events from different ledgers", async () => {
      const raw1 = makeRawEvent(100);
      const raw2 = makeRawEvent(101);

      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("TRDCRT")
        .mockReturnValueOnce("TRDFND");

      await service.processEvent(raw1 as any);
      await service.processEvent(raw2 as any);

      expect(mockDispatchEvent).toHaveBeenCalledTimes(2);
    });

    it("should allow two distinct events within the same ledger (different eventId)", async () => {
      const raw1 = makeRawEvent(200, "evt-200-a");
      const raw2 = makeRawEvent(200, "evt-200-b");

      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("TRDCRT")
        .mockReturnValueOnce("TRDFND");

      await service.processEvent(raw1 as any);
      await service.processEvent(raw2 as any);

      expect(mockDispatchEvent).toHaveBeenCalledTimes(2);
    });

    it("should skip when DB already has a ProcessedEvent record (post-restart)", async () => {
      const raw = makeRawEvent(300, "evt-300");
      mockPrisma.processedEvent.findUnique.mockResolvedValue({
        id: 1,
        ledgerSequence: 300,
        contractId: "CONTRACT_TEST_123",
        eventId: "evt-300",
        processedAt: new Date(),
      });

      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("TRDFND");

      await service.processEvent(raw as any);

      expect(mockDispatchEvent).not.toHaveBeenCalled();
    });

    it("should add event to the in-memory processedEvents set", async () => {
      const raw = makeRawEvent(777, "evt-777");
      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("TRDFND");

      await service.processEvent(raw as any);

      expect((service as any).processedEvents.has(`777:CONTRACT_TEST_123:evt-777`)).toBe(true);
    });
  });

  /* ====== 3. Exponential backoff ================================= */

  describe("Exponential backoff", () => {
    it("should double currentBackoffMs on each call", () => {
      expect((service as any).currentBackoffMs).toBe(100);

      service.handleBackoff();
      expect((service as any).currentBackoffMs).toBe(200);

      service.handleBackoff();
      expect((service as any).currentBackoffMs).toBe(400);

      service.handleBackoff();
      expect((service as any).currentBackoffMs).toBe(800);
    });

    it("should cap at backoffMaxMs (5000)", () => {
      for (let i = 0; i < 20; i++) {
        service.handleBackoff();
      }
      expect((service as any).currentBackoffMs).toBeLessThanOrEqual(5000);
    });

    it("should reset to initial value after resetBackoff()", () => {
      service.handleBackoff();
      service.handleBackoff();
      expect((service as any).currentBackoffMs).toBeGreaterThan(100);

      service.resetBackoff();
      expect((service as any).currentBackoffMs).toBe(100);
    });

    it("should reset backoff after a successful poll", async () => {
      /* Ramp up backoff via failures */
      service.handleBackoff();
      service.handleBackoff();
      expect((service as any).currentBackoffMs).toBe(400);

      /* Successful poll */
      mockGetEvents.mockResolvedValue({ events: [] });
      await service.pollEvents();

      expect((service as any).currentBackoffMs).toBe(100);
    });

    it("should invoke handleBackoff when getEvents rejects", async () => {
      mockGetEvents.mockRejectedValue(new Error("RPC unavailable"));
      const spy = vi.spyOn(service, "handleBackoff");

      await service.pollEvents();

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  /* ====== 4. Event parsing ======================================= */

  describe("Event parsing", () => {
    it("should return null for events with empty topic array", async () => {
      const raw = { ledger: 300, topic: [], value: null };
      await service.processEvent(raw as any);

      expect(mockDispatchEvent).not.toHaveBeenCalled();
    });

    it("should return null for events with no topic", async () => {
      const raw = { ledger: 301, topic: undefined, value: null };
      await service.processEvent(raw as any);

      expect(mockDispatchEvent).not.toHaveBeenCalled();
    });

    it("should skip unknown event symbols and log a warning", async () => {
      const raw = makeRawEvent(302);
      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("UnknownSymbol");
      const warnSpy = vi.spyOn(appLogger, "warn");

      await service.processEvent(raw as any);

      expect(mockDispatchEvent).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: "UnknownSymbol" }),
        expect.stringContaining("Unknown event symbol"),
      );
    });

    it("should handle scValToNative throwing (corrupt XDR)", async () => {
      const raw = makeRawEvent(303);
      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("XDR decode failure");
      });

      await service.processEvent(raw as any);

      expect(mockDispatchEvent).not.toHaveBeenCalled();
    });

    it("should correctly map every real contract topic symbol emitted by amana_escrow", async () => {
      // Short topic codes exactly as emitted by contracts/amana_escrow/src/lib.rs,
      // per the shared EVENT_TOPIC_MAP in ../types/events.
      const symbols: [string, EventType][] = [
        ["TRDCRT", EventType.TradeCreated],
        ["TRDFND", EventType.TradeFunded],
        ["TRDCAN", EventType.TradeCancelled],
        ["TCNBYR", EventType.TradeCancelledByBuyer],
        ["TRDEXP", EventType.TradeExpired],
        ["DELCNF", EventType.DeliveryConfirmed],
        ["RELSD", EventType.FundsReleased],
        ["DISINI", EventType.DisputeInitiated],
        ["DISRES", EventType.DisputeResolved],
        ["EVDSUB", EventType.EvidenceSubmitted],
        ["VIDPRF", EventType.VideoProofSubmitted],
        ["MNFST", EventType.ManifestSubmitted],
        ["DEDEXT", EventType.DeadlineExtended],
        ["MEDADD", EventType.MediatorAdded],
        ["MEDREM", EventType.MediatorRemoved],
        ["FEEUPD", EventType.FeeRateUpdated],
        ["FEEWTH", EventType.FeesWithdrawn],
        ["PTHINT", EventType.PathPaymentInitiated],
        ["PTHPAY", EventType.PathPaymentExecuted],
        ["UPGRAD", EventType.ContractUpgraded],
      ];

      for (let i = 0; i < symbols.length; i++) {
        const [symbol, expected] = symbols[i]!;
        mockDispatchEvent.mockClear();

        const raw = makeRawEvent(400 + i, `evt-${400 + i}`);
        (StellarSdk.scValToNative as ReturnType<typeof vi.fn>).mockReturnValueOnce(symbol);

        await service.processEvent(raw as any);

        expect(mockDispatchEvent).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ eventType: expected })
        );
      }
    });

    it("should resolve tradeId from the event data map, not the topic", async () => {
      const raw = {
        ledger: 450,
        id: "evt-450",
        contractId: "CONTRACT_TEST_123",
        topic: [{ _scval: "sym" }],
        value: {
          type: "map",
          value: [{ key: { value: "trade_id" }, val: { value: "trade-real" } }],
        },
      };
      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>).mockReturnValueOnce("TRDFND");

      await service.processEvent(raw as any);

      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tradeId: "trade-real" })
      );
    });

    it("should fall back to 'unknown' and log a warning when data has no trade_id", async () => {
      const raw = { ledger: 451, id: "evt-451", contractId: "CONTRACT_TEST_123", topic: [{ _scval: "sym" }], value: null };
      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>).mockReturnValueOnce("TRDFND");
      const warnSpy = vi.spyOn(appLogger, "warn");

      await service.processEvent(raw as any);

      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tradeId: "unknown" })
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: "evt-451" }),
        expect.stringContaining("missing trade_id"),
      );
    });
  });

  /* ====== 5. Start / Stop lifecycle ============================== */

  describe("start and stop lifecycle", () => {
    it("should hydrate lastLedger from DB on start", async () => {
      const fresh = new EventListenerService(mockPrisma);
      mockPrisma.processedEvent.findMany.mockResolvedValue([
        { ledgerSequence: 50, contractId: "C", eventId: "e1" },
        { ledgerSequence: 49, contractId: "C", eventId: "e2" },
      ]);

      await fresh.start();

      expect(mockPrisma.processedEvent.findMany).toHaveBeenCalled();
      expect((fresh as any).lastLedger).toBe(50);
      fresh.stop();
    });

    it("should be a no-op when start() is called twice", async () => {
      const fresh = new EventListenerService(mockPrisma);
      mockPrisma.processedEvent.findMany.mockResolvedValue([]);

      await fresh.start();
      await fresh.start();

      expect(mockPrisma.processedEvent.findMany).toHaveBeenCalledTimes(1);
      fresh.stop();
    });

    it("should prevent polling after stop()", async () => {
      const fresh = new EventListenerService(mockPrisma);
      mockPrisma.processedEvent.findMany.mockResolvedValue([]);

      await fresh.start();
      fresh.stop();

      mockGetEvents.mockClear();
      vi.advanceTimersByTime(10_000);

      expect(mockGetEvents).not.toHaveBeenCalled();
    });
  });

  /* ====== 6. pollEvents ========================================== */

  describe("pollEvents", () => {
    it("should pass correct filters to server.getEvents", async () => {
      mockGetEvents.mockResolvedValue({ events: [] });

      await service.pollEvents();

      expect(mockGetEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: [
            expect.objectContaining({
              type: "contract",
              contractIds: ["CONTRACT_TEST_123"],
            }),
          ],
          limit: 100,
        })
      );
    });

    it("should process every event in the response", async () => {
      const events = [makeRawEvent(500), makeRawEvent(501)];
      mockGetEvents.mockResolvedValue({ events });
      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("TRDCRT")
        .mockReturnValueOnce("TRDFND");

      await service.pollEvents();

      expect(mockDispatchEvent).toHaveBeenCalledTimes(2);
    });

    it("should tolerate empty events array", async () => {
      mockGetEvents.mockResolvedValue({ events: [] });

      await expect(service.pollEvents()).resolves.not.toThrow();
      expect(mockDispatchEvent).not.toHaveBeenCalled();
    });

    it("should tolerate undefined events in response", async () => {
      mockGetEvents.mockResolvedValue({});

      await expect(service.pollEvents()).resolves.not.toThrow();
      expect(mockDispatchEvent).not.toHaveBeenCalled();
    });

    it("should use startLedger = lastLedger + 1 when lastLedger > 0", async () => {
      (service as any).lastLedger = 999;
      mockGetEvents.mockResolvedValue({ events: [] });

      await service.pollEvents();

      expect(mockGetEvents).toHaveBeenCalledWith(
        expect.objectContaining({ startLedger: 1000 })
      );
    });

    it("should pass startLedger as undefined when lastLedger is 0", async () => {
      (service as any).lastLedger = 0;
      mockGetEvents.mockResolvedValue({ events: [] });

      await service.pollEvents();

      expect(mockGetEvents).toHaveBeenCalledWith(
        expect.objectContaining({ startLedger: undefined })
      );
    });
  });

  /* ====== 7. Edge cases ========================================== */

  describe("Edge cases", () => {
    it("should not dispatch if dispatchEvent itself throws", async () => {
      const raw = makeRawEvent(600);
      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("TRDFND");
      mockDispatchEvent.mockRejectedValueOnce(new Error("DB down"));

      await expect(service.processEvent(raw as any)).rejects.toThrow("DB down");
    });

    it("should not persist processedEvent when dispatchEvent fails", async () => {
      const raw = makeRawEvent(601);
      (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("TRDFND");
      mockDispatchEvent.mockRejectedValueOnce(new Error("DB down"));

      await expect(service.processEvent(raw as any)).rejects.toThrow("DB down");

      expect(mockPrisma._mockTx.processedEvent.create).not.toHaveBeenCalled();
    });

    it("should evict old events when cache exceeds limit", async () => {
      /* Set cache size to 3 for this test */
      (service as any).config.processedLedgersCacheSize = 3;

      for (let i = 1; i <= 5; i++) {
        const raw = makeRawEvent(i, `evt-${i}`);
        (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
          .mockReturnValueOnce("TRDFND");
        await service.processEvent(raw as any);
      }

      const set: Set<string> = (service as any).processedEvents;
      expect(set.size).toBeLessThanOrEqual(3);
      /* Newest entries should remain */
      expect(set.has(`5:CONTRACT_TEST_123:evt-5`)).toBe(true);
      expect(set.has(`4:CONTRACT_TEST_123:evt-4`)).toBe(true);
      expect(set.has(`3:CONTRACT_TEST_123:evt-3`)).toBe(true);
    });

    it("should evict through ledger buckets without sorting the processed Set", async () => {
      (service as any).config.processedLedgersCacheSize = 2;
      const sortSpy = vi.spyOn(Array.prototype, "sort");

      for (let i = 1; i <= 3; i++) {
        const raw = makeRawEvent(i, `bucket-${i}`);
        (StellarSdk.scValToNative as ReturnType<typeof vi.fn>)
          .mockReturnValueOnce("TRDFND");
        await service.processEvent(raw as any);
      }

      const buckets: Map<number, Set<string>> = (service as any)
        .processedEventsByLedger;
      expect(sortSpy).not.toHaveBeenCalled();
      expect([...buckets.keys()]).toEqual([2, 3]);
      expect((service as any).processedEvents.has(
        "1:CONTRACT_TEST_123:bucket-1",
      )).toBe(false);
    });

    it("should not poll when running is false", async () => {
      (service as any).running = false;
      mockGetEvents.mockResolvedValue({ events: [] });

      await service.pollEvents();

      expect(mockGetEvents).not.toHaveBeenCalled();
    });
  });
});
