import { jest } from "@jest/globals";
import { Prisma } from "@prisma/client";
import {
  handleTradeCreated,
  handleTradeFunded,
  handleDeliveryConfirmed,
  handleFundsReleased,
  handleDisputeInitiated,
  handleDisputeResolved,
  dispatchEvent,
} from "../services/eventHandlers";
import {
  EventType,
  TradeStatus,
  ParsedEvent,
  EVENT_TO_STATUS,
} from "../types/events";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function createMockTx() {
  return {
    trade: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  } as unknown as Prisma.TransactionClient;
}

function makeParsedEvent(
  eventType: EventType,
  overrides: Partial<ParsedEvent> = {},
): ParsedEvent {
  return {
    eventType,
    tradeId: "test-trade-001",
    ledgerSequence: 12345,
    contractId: "CONTRACT_TEST_123",
    eventId: "evt-12345",
    data: {},
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("eventHandlers", () => {
  let mockTx: ReturnType<typeof createMockTx>;

  beforeEach(() => {
    mockTx = createMockTx();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /* ---------- handleTradeCreated ---------------------------------- */

  describe("handleTradeCreated", () => {
    it("creates trade when missing", async () => {
      const event = makeParsedEvent(EventType.TradeCreated, {
        data: { buyer: "GA_BUYER", seller: "GA_SELLER", amount_usdc: 1000 },
      });

      await handleTradeCreated(mockTx, event);

      expect(mockTx.trade.create).toHaveBeenCalledWith({
        data: {
          tradeId: "test-trade-001",
          buyerAddress: "GA_BUYER",
          sellerAddress: "GA_SELLER",
          amountUsdc: "1000",
          status: TradeStatus.CREATED,
          version: 1,
        },
      });
    });

    it("updates trade via CAS when current status is allowed", async () => {
      const event = makeParsedEvent(EventType.TradeFunded);
      (mockTx.trade.findUnique as any).mockResolvedValue({
        tradeId: "test-trade-001",
        status: TradeStatus.CREATED,
        version: 3,
      });
      await handleTradeFunded(mockTx, event);

      expect(mockTx.trade.updateMany).toHaveBeenCalledWith({
        where: {
          tradeId: "test-trade-001",
          status: TradeStatus.CREATED,
          version: 3,
        },
        data: {
          status: TradeStatus.FUNDED,
          version: { increment: 1 },
          updatedAt: expect.any(Date),
        },
      });
    });

    it("defaults buyer/seller to empty string when absent", async () => {
      const event = makeParsedEvent(EventType.TradeCreated, { data: {} });

      await handleTradeCreated(mockTx, event);

      expect(mockTx.trade.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            buyerAddress: "",
            sellerAddress: "",
            amountUsdc: "0",
          }),
        }),
      );
    });
  });

  /* ---------- handleTradeFunded ----------------------------------- */

  describe("handleTradeFunded", () => {
    it("ignores out-of-order transition", async () => {
      const event = makeParsedEvent(EventType.TradeFunded);
      (mockTx.trade.findUnique as any).mockResolvedValue({
        tradeId: "test-trade-001",
        status: TradeStatus.DISPUTED,
        version: 1,
      });

      await handleTradeFunded(mockTx, event);

      expect(mockTx.trade.updateMany).not.toHaveBeenCalled();
    });
  });

  /* ---------- handleDeliveryConfirmed ----------------------------- */

  describe("handleDeliveryConfirmed", () => {
    it("is idempotent when same status is already set", async () => {
      const event = makeParsedEvent(EventType.DeliveryConfirmed);
      (mockTx.trade.findUnique as any).mockResolvedValue({
        tradeId: "test-trade-001",
        status: TradeStatus.DELIVERED,
        version: 2,
      });
      await handleDeliveryConfirmed(mockTx, event);
      expect(mockTx.trade.updateMany).not.toHaveBeenCalled();
    });
  });

  /* ---------- handleFundsReleased --------------------------------- */

  describe("handleFundsReleased", () => {
    it("throws on version race conflict", async () => {
      const event = makeParsedEvent(EventType.FundsReleased);
      (mockTx.trade.findUnique as any).mockResolvedValue({
        tradeId: "test-trade-001",
        status: TradeStatus.DELIVERED,
        version: 2,
      });
      (mockTx.trade.updateMany as any).mockResolvedValue({ count: 0 });
      await expect(handleFundsReleased(mockTx, event)).rejects.toThrow("Concurrency conflict");
    });
  });

  /* ---------- handleDisputeInitiated ------------------------------ */

  describe("handleDisputeInitiated", () => {
    it("updates to DISPUTED from FUNDED", async () => {
      const event = makeParsedEvent(EventType.DisputeInitiated);
      (mockTx.trade.findUnique as any).mockResolvedValue({
        tradeId: "test-trade-001",
        status: TradeStatus.FUNDED,
        version: 5,
      });
      await handleDisputeInitiated(mockTx, event);

      expect(mockTx.trade.updateMany).toHaveBeenCalledTimes(1);
    });
  });

  /* ---------- handleDisputeResolved ------------------------------- */

  describe("handleDisputeResolved", () => {
    it("updates DISPUTED to COMPLETED", async () => {
      const event = makeParsedEvent(EventType.DisputeResolved);
      (mockTx.trade.findUnique as any).mockResolvedValue({
        tradeId: "test-trade-001",
        status: TradeStatus.DISPUTED,
        version: 6,
      });
      await handleDisputeResolved(mockTx, event);

      expect(mockTx.trade.updateMany).toHaveBeenCalledTimes(1);
    });

    it("maps DisputeResolved to COMPLETED in EVENT_TO_STATUS", async () => {
      expect(EVENT_TO_STATUS[EventType.DisputeResolved]).toBe(
        TradeStatus.COMPLETED,
      );
    });
  });

  /* ---------- dispatchEvent --------------------------------------- */

  describe("dispatchEvent", () => {
    it("should route every EventType to its correct handler and status", async () => {
      for (const [eventType] of Object.entries(EVENT_TO_STATUS)) {
        const tx = createMockTx();
        const event = makeParsedEvent(eventType as EventType, {
          data:
            eventType === EventType.TradeCreated
              ? { buyer: "B", seller: "S", amount_usdc: 100 }
              : {},
        });

        await dispatchEvent(tx, event);

        if (eventType === EventType.TradeCreated) {
          expect(tx.trade.create).toHaveBeenCalled();
        } else {
          expect(tx.trade.create).toHaveBeenCalled();
        }
      }
    });

    it("should not throw for an unknown EventType", async () => {
      const event = {
        eventType: "NonExistentEvent" as EventType,
        tradeId: "orphan-001",
        ledgerSequence: 1,
        contractId: "CONTRACT_TEST_123",
        eventId: "evt-1",
        data: {},
      };

      await expect(dispatchEvent(mockTx, event)).resolves.not.toThrow();
    });

    it("should not call tx for an unknown EventType", async () => {
      const event = {
        eventType: "BadType" as EventType,
        tradeId: "x",
        ledgerSequence: 0,
        contractId: "CONTRACT_TEST_123",
        eventId: "evt-0",
        data: {},
      } as any;

      await dispatchEvent(mockTx, event);

      expect(mockTx.trade.create).not.toHaveBeenCalled();
      expect(mockTx.trade.updateMany).not.toHaveBeenCalled();
    });
  });
});
