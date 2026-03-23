import { PrismaClient } from "@prisma/client";
import { EventType } from "../types/events";

/* ------------------------------------------------------------------ */
/*  Module-level mocks (hoisted by jest)                              */
/* ------------------------------------------------------------------ */

const mockGetEvents = jest.fn();

jest.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getEvents: (...args: unknown[]) => mockGetEvents(...args),
    })),
  },
  scValToNative: jest.fn(),
}));

jest.mock("../config/eventListener.config", () => ({
  getEventListenerConfig: jest.fn().mockReturnValue({
    rpcUrl: "https://test-rpc.example.com",
    contractId: "CONTRACT_TEST_123",
    pollIntervalMs: 1000,
    backoffInitialMs: 100,
    backoffMaxMs: 5000,
    processedLedgersCacheSize: 100,
  }),
}));

const mockDispatchEvent = jest.fn().mockResolvedValue(undefined);
jest.mock("../services/eventHandlers", () => ({
  dispatchEvent: (...args: unknown[]) => mockDispatchEvent(...args),
}));

/* Import after mocks are set up */
import { EventListenerService } from "../services/eventListener.service";
import * as StellarSdk from "@stellar/stellar-sdk";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function createMockPrisma() {
  return {
    trade: { upsert: jest.fn().mockResolvedValue({}) },
    processedLedger: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

/** Build a minimal raw Soroban event for testing. */
function makeRawEvent(ledger: number) {
  return {
    ledger,
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
    jest.useFakeTimers();

    /* Reset mocks but keep factory implementations intact */
    mockGetEvents.mockReset();
    mockDispatchEvent.mockReset().mockResolvedValue(undefined);
    (StellarSdk.scValToNative as jest.Mock).mockReset();

    mockPrisma = createMockPrisma();
    service = new EventListenerService(mockPrisma);
    (service as any).running = true;

    jest.spyOn(console, "log").mockImplementation();
    jest.spyOn(console, "warn").mockImplementation();
    jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    service.stop();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /* ====== 1. TradeFunded event processing ======================== */

  describe("TradeFunded event processing", () => {
    it("should dispatch a TradeFunded ParsedEvent after RPC returns the event", async () => {
      const raw = makeRawEvent(12345);
      mockGetEvents.mockResolvedValue({ events: [raw] });
      (StellarSdk.scValToNative as jest.Mock)
        .mockReturnValueOnce("TradeFunded")
        .mockReturnValueOnce("trade-abc");

      await service.pollEvents();

      expect(mockDispatchEvent).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          eventType: EventType.TradeFunded,
          tradeId: "trade-abc",
          ledgerSequence: 12345,
        })
      );
    });

    it("should persist the processed ledger to the database", async () => {
      const raw = makeRawEvent(12345);
      (StellarSdk.scValToNative as jest.Mock)
        .mockReturnValueOnce("TradeFunded")
        .mockReturnValueOnce("trade-abc");

      await service.processEvent(raw as any);

      expect(mockPrisma.processedLedger.upsert).toHaveBeenCalledWith({
        where: { ledgerSequence: 12345 },
        update: {},
        create: { ledgerSequence: 12345 },
      });
    });

    it("should advance lastLedger after processing", async () => {
      const raw = makeRawEvent(500);
      (StellarSdk.scValToNative as jest.Mock)
        .mockReturnValueOnce("TradeFunded")
        .mockReturnValueOnce("t-1");

      await service.processEvent(raw as any);

      expect((service as any).lastLedger).toBe(500);
    });
  });

  /* ====== 2. Duplicate event rejection =========================== */

  describe("Duplicate event rejection", () => {
    it("should NOT dispatch when the same ledger is processed twice", async () => {
      const raw = makeRawEvent(99999);

      (StellarSdk.scValToNative as jest.Mock)
        .mockReturnValueOnce("TradeCreated")
        .mockReturnValueOnce("trade-dup");
      await service.processEvent(raw as any);

      /* Second attempt — same ledger */
      (StellarSdk.scValToNative as jest.Mock)
        .mockReturnValueOnce("TradeCreated")
        .mockReturnValueOnce("trade-dup");
      await service.processEvent(raw as any);

      expect(mockDispatchEvent).toHaveBeenCalledTimes(1);
    });

    it("should allow events from different ledgers", async () => {
      const raw1 = makeRawEvent(100);
      const raw2 = makeRawEvent(101);

      (StellarSdk.scValToNative as jest.Mock)
        .mockReturnValueOnce("TradeCreated")
        .mockReturnValueOnce("t-1")
        .mockReturnValueOnce("TradeFunded")
        .mockReturnValueOnce("t-1");

      await service.processEvent(raw1 as any);
      await service.processEvent(raw2 as any);

      expect(mockDispatchEvent).toHaveBeenCalledTimes(2);
    });

    it("should add ledger to the in-memory processedLedgers set", async () => {
      const raw = makeRawEvent(777);
      (StellarSdk.scValToNative as jest.Mock)
        .mockReturnValueOnce("TradeFunded")
        .mockReturnValueOnce("t");

      await service.processEvent(raw as any);

      expect((service as any).processedLedgers.has(777)).toBe(true);
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
      const spy = jest.spyOn(service, "handleBackoff");

      await service.pollEvents();

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  /* ====== 4. Event parsing ======================================= */

  describe("Event parsing", () => {
    it("should recognise snake_case symbols (trade_funded → TradeFunded)", async () => {
      const raw = makeRawEvent(200);
      (StellarSdk.scValToNative as jest.Mock)
        .mockReturnValueOnce("trade_funded")
        .mockReturnValueOnce("trade-sc");

      await service.processEvent(raw as any);

      expect(mockDispatchEvent).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({ eventType: EventType.TradeFunded })
      );
    });

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

    it("should skip unknown event symbols", async () => {
      const raw = makeRawEvent(302);
      (StellarSdk.scValToNative as jest.Mock)
        .mockReturnValueOnce("UnknownSymbol")
        .mockReturnValueOnce("trade-x");

      await service.processEvent(raw as any);

      expect(mockDispatchEvent).not.toHaveBeenCalled();
    });

    it("should handle scValToNative throwing (corrupt XDR)", async () => {
      const raw = makeRawEvent(303);
      (StellarSdk.scValToNative as jest.Mock).mockImplementation(() => {
        throw new Error("XDR decode failure");
      });

      await service.processEvent(raw as any);

      expect(mockDispatchEvent).not.toHaveBeenCalled();
    });

    it("should correctly map all six event type symbols", async () => {
      const symbols: [string, EventType][] = [
        ["TradeCreated", EventType.TradeCreated],
        ["TradeFunded", EventType.TradeFunded],
        ["DeliveryConfirmed", EventType.DeliveryConfirmed],
        ["FundsReleased", EventType.FundsReleased],
        ["DisputeInitiated", EventType.DisputeInitiated],
        ["DisputeResolved", EventType.DisputeResolved],
      ];

      for (let i = 0; i < symbols.length; i++) {
        const [symbol, expected] = symbols[i];
        mockDispatchEvent.mockClear();
        (mockPrisma.processedLedger.upsert as jest.Mock).mockClear();

        const raw = makeRawEvent(400 + i);
        (StellarSdk.scValToNative as jest.Mock)
          .mockReturnValueOnce(symbol)
          .mockReturnValueOnce(`trade-${i}`);

        await service.processEvent(raw as any);

        expect(mockDispatchEvent).toHaveBeenCalledWith(
          mockPrisma,
          expect.objectContaining({ eventType: expected })
        );
      }
    });

    it("should extract tradeId as 'unknown' when topic has only one element", async () => {
      const raw = { ledger: 450, topic: [{ _scval: "sym" }], value: null };
      (StellarSdk.scValToNative as jest.Mock).mockReturnValueOnce("TradeFunded");

      await service.processEvent(raw as any);

      expect(mockDispatchEvent).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({ tradeId: "unknown" })
      );
    });
  });

  /* ====== 5. Start / Stop lifecycle ============================== */

  describe("start and stop lifecycle", () => {
    it("should hydrate processedLedgers from DB on start", async () => {
      const fresh = new EventListenerService(mockPrisma);
      (mockPrisma.processedLedger.findMany as jest.Mock).mockResolvedValue([
        { ledgerSequence: 50 },
        { ledgerSequence: 49 },
      ]);

      await fresh.start();

      expect(mockPrisma.processedLedger.findMany).toHaveBeenCalled();
      expect((fresh as any).processedLedgers.has(50)).toBe(true);
      expect((fresh as any).processedLedgers.has(49)).toBe(true);
      expect((fresh as any).lastLedger).toBe(50);
      fresh.stop();
    });

    it("should be a no-op when start() is called twice", async () => {
      const fresh = new EventListenerService(mockPrisma);
      (mockPrisma.processedLedger.findMany as jest.Mock).mockResolvedValue([]);

      await fresh.start();
      await fresh.start();

      expect(mockPrisma.processedLedger.findMany).toHaveBeenCalledTimes(1);
      fresh.stop();
    });

    it("should prevent polling after stop()", async () => {
      const fresh = new EventListenerService(mockPrisma);
      (mockPrisma.processedLedger.findMany as jest.Mock).mockResolvedValue([]);

      await fresh.start();
      fresh.stop();

      mockGetEvents.mockClear();
      jest.advanceTimersByTime(10_000);

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
      (StellarSdk.scValToNative as jest.Mock)
        .mockReturnValueOnce("TradeCreated")
        .mockReturnValueOnce("t-1")
        .mockReturnValueOnce("TradeFunded")
        .mockReturnValueOnce("t-2");

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
      (StellarSdk.scValToNative as jest.Mock)
        .mockReturnValueOnce("TradeFunded")
        .mockReturnValueOnce("t-err");
      mockDispatchEvent.mockRejectedValueOnce(new Error("DB down"));

      /* processEvent catches the error internally — should not bubble */
      await expect(service.processEvent(raw as any)).resolves.not.toThrow();
    });

    it("should not persist ledger when dispatchEvent fails", async () => {
      const raw = makeRawEvent(601);
      (StellarSdk.scValToNative as jest.Mock)
        .mockReturnValueOnce("TradeFunded")
        .mockReturnValueOnce("t-err2");
      mockDispatchEvent.mockRejectedValueOnce(new Error("DB down"));

      await service.processEvent(raw as any);

      expect(mockPrisma.processedLedger.upsert).not.toHaveBeenCalled();
    });

    it("should evict old ledgers when cache exceeds limit", async () => {
      /* Set cache size to 3 for this test */
      (service as any).config.processedLedgersCacheSize = 3;

      for (let i = 1; i <= 5; i++) {
        const raw = makeRawEvent(i);
        (StellarSdk.scValToNative as jest.Mock)
          .mockReturnValueOnce("TradeFunded")
          .mockReturnValueOnce(`t-${i}`);
        await service.processEvent(raw as any);
      }

      const set: Set<number> = (service as any).processedLedgers;
      expect(set.size).toBeLessThanOrEqual(3);
      /* Newest entries should remain */
      expect(set.has(5)).toBe(true);
      expect(set.has(4)).toBe(true);
      expect(set.has(3)).toBe(true);
    });

    it("should not poll when running is false", async () => {
      (service as any).running = false;
      mockGetEvents.mockResolvedValue({ events: [] });

      await service.pollEvents();

      expect(mockGetEvents).not.toHaveBeenCalled();
    });
  });
});
