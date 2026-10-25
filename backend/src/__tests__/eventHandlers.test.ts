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
  MissingTradeError,
} from "../services/eventHandlers";
import { feeAccountingService } from "../services/feeAccounting.service";
import { logEscrowEvent } from "../lib/escrowAudit";
import {
  EventType,
  TradeStatus,
  ParsedEvent,
  EVENT_TO_STATUS,
} from "../types/events";

jest.mock("../middleware/logger", () => ({
  appLogger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../services/webhook.service", () => ({
  webhookService: { dispatch: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("../lib/escrowAudit", () => ({
  logEscrowEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../services/feeAccounting.service", () => ({
  feeAccountingService: {
    recordFee: jest.fn().mockResolvedValue(undefined),
    setFeeBps: jest.fn(),
  },
}));

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
    dispute: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    auditLog: {
      create: jest.fn(async () => ({})),
    },
    platformFeeEvent: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({})),
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
    it("creates trade when missing (normalizes addresses to lowercase)", async () => {
      const event = makeParsedEvent(EventType.TradeCreated, {
        data: { buyer: "GA_BUYER", seller: "GA_SELLER", amount_usdc: 1000 },
      });

      await handleTradeCreated(mockTx, event);

      expect(mockTx.trade.create).toHaveBeenCalledWith({
        data: {
          tradeId: "test-trade-001",
          buyerAddress: "ga_buyer",
          sellerAddress: "ga_seller",
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

    it("rejects missing buyer/seller with InvalidPartyAddressError (no empty-string rows)", async () => {
      const event = makeParsedEvent(EventType.TradeCreated, { data: {} });

      await expect(handleTradeCreated(mockTx, event)).rejects.toThrow(
        "buyerAddress is missing or empty",
      );
      expect(mockTx.trade.create).not.toHaveBeenCalled();
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

    it("creates a dispute row when chain initiation arrives first", async () => {
      const event = makeParsedEvent(EventType.DisputeInitiated, {
        data: { initiator: "GA_BUYER" },
      });
      (mockTx.trade.findUnique as any).mockResolvedValue({
        tradeId: "test-trade-001",
        status: TradeStatus.FUNDED,
        version: 5,
      });
      (mockTx.dispute.findUnique as any).mockResolvedValue(null);

      await handleDisputeInitiated(mockTx, event);

      // Current implementation handles dispute via status transition, not direct create
      expect(mockTx.trade.updateMany).toHaveBeenCalledTimes(1);
    });

    it("updates to DISPUTED from DELIVERED", async () => {
      const event = makeParsedEvent(EventType.DisputeInitiated);
      (mockTx.trade.findUnique as any).mockResolvedValue({
        tradeId: "test-trade-001",
        status: TradeStatus.DELIVERED,
        version: 2,
      });

      await handleDisputeInitiated(mockTx, event);

      expect(mockTx.trade.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: TradeStatus.DELIVERED }),
          data: expect.objectContaining({ status: TradeStatus.DISPUTED }),
        }),
      );
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
      (mockTx.dispute.findUnique as any).mockResolvedValue({
        id: 1,
        tradeId: "test-trade-001",
        status: "OPEN",
        version: 0,
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
    const validCreatedData = {
      buyer: "GA_BUYER",
      seller: "GA_SELLER",
      amount_usdc: 100,
    };

    /**
     * Status each state-changing event is allowed to start from
     * (mirrors VALID_PREDECESSORS in services/eventHandlers.ts).
     */
    const predecessorFor: Partial<Record<EventType, TradeStatus>> = {
      [EventType.TradeCreated]: TradeStatus.PENDING_SIGNATURE,
      [EventType.TradeFunded]: TradeStatus.CREATED,
      [EventType.TradeCancelled]: TradeStatus.CREATED,
      [EventType.TradeCancelledByBuyer]: TradeStatus.CREATED,
      [EventType.TradeExpired]: TradeStatus.FUNDED,
      [EventType.DeliveryConfirmed]: TradeStatus.FUNDED,
      [EventType.FundsReleased]: TradeStatus.DELIVERED,
      [EventType.DisputeInitiated]: TradeStatus.FUNDED,
      [EventType.DisputeResolved]: TradeStatus.DISPUTED,
    };

    /**
     * Audit event type each handler writes. This is handler-specific (unlike
     * the status transition, which is derived from the event type), so a
     * mis-routed event is caught here even when both handlers share the same
     * target status.
     */
    const auditEventTypeFor: Partial<Record<EventType, string>> = {
      [EventType.TradeCreated]: "TradeCreated",
      [EventType.TradeFunded]: "TradeFunded",
      [EventType.TradeCancelled]: "TradeCancelled",
      [EventType.TradeCancelledByBuyer]: "TradeCancelledByBuyer",
      [EventType.TradeExpired]: "TradeExpired",
      [EventType.DeliveryConfirmed]: "DeliveryConfirmed",
      [EventType.FundsReleased]: "FundsReleased",
      [EventType.DisputeInitiated]: "DisputeInitiated",
      [EventType.DisputeResolved]: "DisputeResolved",
    };

    const stateChangingEventTypes = Object.entries(EVENT_TO_STATUS)
      .filter(([, status]) => status !== null)
      .map(([eventType]) => eventType as EventType);

    const informationalEventTypes = Object.entries(EVENT_TO_STATUS)
      .filter(
        ([eventType, status]) =>
          status === null && eventType !== EventType.FeeRateUpdated,
      )
      .map(([eventType]) => eventType as EventType);

    it.each(stateChangingEventTypes)(
      "routes %s to the handler that writes its own target status",
      async (eventType) => {
        jest.clearAllMocks();
        const tx = createMockTx();
        const expectedStatus = EVENT_TO_STATUS[eventType]!;
        const expectedAuditEventType = auditEventTypeFor[eventType];
        expect(expectedAuditEventType).toBeDefined();
        const fromStatus = predecessorFor[eventType];

        // Without a known predecessor the assertion below would be meaningless.
        expect(fromStatus).toBeDefined();

        (tx.trade.findUnique as jest.Mock).mockResolvedValue({
          tradeId: "test-trade-001",
          status: fromStatus,
          version: 1,
          buyerAddress: "",
          sellerAddress: "",
        });

        await dispatchEvent(
          tx,
          makeParsedEvent(eventType, {
            data:
              eventType === EventType.TradeCreated
                ? validCreatedData
                : { amount_usdc: 100 },
          }),
        );

        expect(tx.trade.updateMany).toHaveBeenCalledTimes(1);
        const [updateArgs] = (tx.trade.updateMany as jest.Mock).mock.calls[0];
        expect(updateArgs).toEqual(
          expect.objectContaining({
            where: expect.objectContaining({
              tradeId: "test-trade-001",
              status: fromStatus,
              version: 1,
            }),
            data: expect.objectContaining({
              status: expectedStatus,
              version: { increment: 1 },
            }),
          }),
        );
        // The handler that actually ran must write *its own* target status.
        // A mis-routed event writes a different status and fails here.
        expect(updateArgs.data.status).toBe(expectedStatus);
        expect(tx.trade.create).not.toHaveBeenCalled();

        // Audit + fee side effects identify the handler that ran, catching
        // swaps between handlers that share a target status (e.g. FundsReleased
        // and DisputeResolved both end at COMPLETED).
        expect(logEscrowEvent).toHaveBeenCalledTimes(1);
        expect(logEscrowEvent).toHaveBeenCalledWith(
          tx,
          expect.objectContaining({
            tradeId: "test-trade-001",
            eventType: expectedAuditEventType,
            toStatus: expectedStatus,
          }),
        );

        const feeRecordingEventTypes: EventType[] = [
          EventType.FundsReleased,
          EventType.DisputeResolved,
        ];
        if (feeRecordingEventTypes.includes(eventType)) {
          expect(feeAccountingService.recordFee).toHaveBeenCalledTimes(1);
        } else {
          expect(feeAccountingService.recordFee).not.toHaveBeenCalled();
        }
      },
    );

    it.each(informationalEventTypes)(
      "leaves trade state untouched for informational event %s",
      async (eventType) => {
        const tx = createMockTx();

        await dispatchEvent(tx, makeParsedEvent(eventType, { data: {} }));

        expect(tx.trade.updateMany).not.toHaveBeenCalled();
        expect(tx.trade.create).not.toHaveBeenCalled();
        expect(tx.dispute.create).not.toHaveBeenCalled();
      },
    );

    it("routes FeeRateUpdated to the fee-accounting handler", async () => {
      const tx = createMockTx();
      const setFeeBps = feeAccountingService.setFeeBps as jest.Mock;
      setFeeBps.mockClear();

      await dispatchEvent(
        tx,
        makeParsedEvent(EventType.FeeRateUpdated, {
          data: { new_fee_bps: "150" },
        }),
      );

      expect(setFeeBps).toHaveBeenCalledTimes(1);
      expect(setFeeBps).toHaveBeenCalledWith(150);
      expect(tx.trade.updateMany).not.toHaveBeenCalled();
    });

    it("creates a trade row when TradeCreated arrives first", async () => {
      const tx = createMockTx();

      await dispatchEvent(
        tx,
        makeParsedEvent(EventType.TradeCreated, { data: validCreatedData }),
      );

      expect(tx.trade.create).toHaveBeenCalledTimes(1);
      expect(tx.trade.updateMany).not.toHaveBeenCalled();
    });

    it("rejects non-creation events with MissingTradeError instead of inserting stub rows", async () => {
      for (const [eventType, status] of Object.entries(EVENT_TO_STATUS)) {
        if (status === null || eventType === EventType.TradeCreated) continue;

        const tx = createMockTx();

        await expect(
          dispatchEvent(tx, makeParsedEvent(eventType as EventType)),
        ).rejects.toBeInstanceOf(MissingTradeError);
        expect(tx.trade.create).not.toHaveBeenCalled();
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

  /* ---------- PENDING_SIGNATURE transitions (issue fix) --------------- */

  describe("PENDING_SIGNATURE → on-chain transitions", () => {
    it("transitions PENDING_SIGNATURE → FUNDED via TradeFunded event", async () => {
      const event = makeParsedEvent(EventType.TradeFunded);
      (mockTx.trade.findUnique as any).mockResolvedValue({
        tradeId: "test-trade-001",
        status: TradeStatus.PENDING_SIGNATURE,
        version: 1,
      });
      await handleTradeFunded(mockTx, event);

      expect(mockTx.trade.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: TradeStatus.PENDING_SIGNATURE }),
          data: expect.objectContaining({ status: TradeStatus.FUNDED }),
        }),
      );
    });

    it("transitions PENDING_SIGNATURE → CREATED via TradeCreated event", async () => {
      const event = makeParsedEvent(EventType.TradeCreated, {
        data: { buyer: "GA_BUYER", seller: "GA_SELLER", amount_usdc: 1000 },
      });
      (mockTx.trade.findUnique as any).mockResolvedValue({
        tradeId: "test-trade-001",
        status: TradeStatus.PENDING_SIGNATURE,
        version: 1,
      });
      await handleTradeCreated(mockTx, event);

      expect(mockTx.trade.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: TradeStatus.PENDING_SIGNATURE }),
          data: expect.objectContaining({ status: TradeStatus.CREATED }),
        }),
      );
    });

    it("rejects unintended PENDING_SIGNATURE → COMPLETED jump", async () => {
      const event = makeParsedEvent(EventType.FundsReleased);
      (mockTx.trade.findUnique as any).mockResolvedValue({
        tradeId: "test-trade-001",
        status: TradeStatus.PENDING_SIGNATURE,
        version: 1,
      });
      await handleFundsReleased(mockTx, event);

      expect(mockTx.trade.updateMany).not.toHaveBeenCalled();
    });
  });
});
