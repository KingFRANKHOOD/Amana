import { PrismaClient } from "@prisma/client";
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

function createMockPrisma() {
  return {
    trade: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

function makeParsedEvent(
  eventType: EventType,
  overrides: Partial<ParsedEvent> = {}
): ParsedEvent {
  return {
    eventType,
    tradeId: "test-trade-001",
    ledgerSequence: 12345,
    data: {},
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("eventHandlers", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    jest.spyOn(console, "log").mockImplementation();
    jest.spyOn(console, "warn").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /* ---------- handleTradeCreated ---------------------------------- */

  describe("handleTradeCreated", () => {
    it("should upsert Trade with CREATED status and correct fields", async () => {
      const event = makeParsedEvent(EventType.TradeCreated, {
        data: { buyer: "GA_BUYER", seller: "GA_SELLER", amount_usdc: 1000 },
      });

      await handleTradeCreated(mockPrisma, event);

      expect(mockPrisma.trade.upsert).toHaveBeenCalledWith({
        where: { tradeId: "test-trade-001" },
        update: {
          status: TradeStatus.CREATED,
          updatedAt: expect.any(Date),
        },
        create: {
          tradeId: "test-trade-001",
          buyer: "GA_BUYER",
          seller: "GA_SELLER",
          amountUsdc: "1000",
          status: TradeStatus.CREATED,
        },
      });
    });

    it("should default buyer/seller to empty string when absent", async () => {
      const event = makeParsedEvent(EventType.TradeCreated, { data: {} });

      await handleTradeCreated(mockPrisma, event);

      expect(mockPrisma.trade.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            buyer: "",
            seller: "",
            amountUsdc: "0",
          }),
        })
      );
    });
  });

  /* ---------- handleTradeFunded ----------------------------------- */

  describe("handleTradeFunded", () => {
    it("should upsert Trade with FUNDED status", async () => {
      const event = makeParsedEvent(EventType.TradeFunded);

      await handleTradeFunded(mockPrisma, event);

      expect(mockPrisma.trade.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tradeId: "test-trade-001" },
          update: expect.objectContaining({ status: TradeStatus.FUNDED }),
        })
      );
    });
  });

  /* ---------- handleDeliveryConfirmed ----------------------------- */

  describe("handleDeliveryConfirmed", () => {
    it("should upsert Trade with DELIVERED status", async () => {
      const event = makeParsedEvent(EventType.DeliveryConfirmed);
      await handleDeliveryConfirmed(mockPrisma, event);

      expect(mockPrisma.trade.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: TradeStatus.DELIVERED }),
        })
      );
    });
  });

  /* ---------- handleFundsReleased --------------------------------- */

  describe("handleFundsReleased", () => {
    it("should upsert Trade with COMPLETED status", async () => {
      const event = makeParsedEvent(EventType.FundsReleased);
      await handleFundsReleased(mockPrisma, event);

      expect(mockPrisma.trade.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: TradeStatus.COMPLETED }),
        })
      );
    });
  });

  /* ---------- handleDisputeInitiated ------------------------------ */

  describe("handleDisputeInitiated", () => {
    it("should upsert Trade with DISPUTED status", async () => {
      const event = makeParsedEvent(EventType.DisputeInitiated);
      await handleDisputeInitiated(mockPrisma, event);

      expect(mockPrisma.trade.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: TradeStatus.DISPUTED }),
        })
      );
    });
  });

  /* ---------- handleDisputeResolved ------------------------------- */

  describe("handleDisputeResolved", () => {
    it("should upsert Trade with CANCELLED status", async () => {
      const event = makeParsedEvent(EventType.DisputeResolved);
      await handleDisputeResolved(mockPrisma, event);

      expect(mockPrisma.trade.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: TradeStatus.CANCELLED }),
        })
      );
    });
  });

  /* ---------- dispatchEvent --------------------------------------- */

  describe("dispatchEvent", () => {
    it("should route every EventType to its correct handler and status", async () => {
      for (const [eventType, expectedStatus] of Object.entries(EVENT_TO_STATUS)) {
        const prisma = createMockPrisma();
        const event = makeParsedEvent(eventType as EventType, {
          data:
            eventType === EventType.TradeCreated
              ? { buyer: "B", seller: "S", amount_usdc: 100 }
              : {},
        });

        await dispatchEvent(prisma, event);

        expect(prisma.trade.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({ status: expectedStatus }),
          })
        );
      }
    });

    it("should not throw for an unknown EventType", async () => {
      const event = {
        eventType: "NonExistentEvent" as EventType,
        tradeId: "orphan-001",
        ledgerSequence: 1,
        data: {},
      };

      await expect(dispatchEvent(mockPrisma, event)).resolves.not.toThrow();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("Unknown event type")
      );
    });

    it("should not call prisma for an unknown EventType", async () => {
      const event = {
        eventType: "BadType" as EventType,
        tradeId: "x",
        ledgerSequence: 0,
        data: {},
      };

      await dispatchEvent(mockPrisma, event);

      expect(mockPrisma.trade.upsert).not.toHaveBeenCalled();
    });
  });
});
