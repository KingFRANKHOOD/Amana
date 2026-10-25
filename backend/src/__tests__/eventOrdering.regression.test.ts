/**
 * Regression test for issue #1404:
 * Out-of-order chain-event processing can permanently strand a trade's status.
 */
import { jest } from "@jest/globals";
import { Prisma, TradeStatus } from "@prisma/client";
import {
  handleTradeCreated,
  handleTradeFunded,
  MissingTradeError,
} from "../services/eventHandlers";
import {
  EventListenerService,
  isMissingTradeError,
} from "../services/eventListener.service";
import { EventType, ParsedEvent } from "../types/events";

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
  feeAccountingService: { recordFee: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("@stellar/stellar-sdk", () => ({
  rpc: { Server: jest.fn().mockImplementation(() => ({ getEvents: jest.fn().mockResolvedValue({ events: [] }) })) },
  scValToNative: jest.fn().mockReturnValue("TRDCRT"),
}));
jest.mock("../config/eventListener.config", () => ({
  getEventListenerConfig: jest.fn().mockReturnValue({
    rpcUrl: "https://rpc.example.com",
    contractId: "CONTRACT_X",
    pollIntervalMs: 1000,
    backoffInitialMs: 100,
    backoffMaxMs: 800,
    processedLedgersCacheSize: 100,
    outboxMaxAttempts: 3,
  }),
}));

// Use real dispatchEvent for handler tests, mocked for listener tests
jest.mock("../services/eventHandlers", () => {
  const actual = jest.requireActual("../services/eventHandlers") as any;
  return { ...actual, dispatchEvent: jest.fn() };
});
import { dispatchEvent, MissingTradeError as MockMissingTradeError } from "../services/eventHandlers";

function mockTx(existing: any) {
  return {
    trade: {
      findUnique: jest.fn(async () => existing),
      create: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  } as unknown as Prisma.TransactionClient;
}

function parsed(type: EventType, tradeId = "trade-X", ledger = 10): ParsedEvent {
  return {
    eventType: type,
    tradeId,
    ledgerSequence: ledger,
    contractId: "CONTRACT_X",
    eventId: `evt-${ledger}-${type}`,
    data: type === EventType.TradeCreated ? { buyer: "GBUYER", seller: "GSELLER", amount_usdc: "50" } : {},
  };
}

describe("eventHandlers #1404 — no stub rows + backfill", () => {
  it("TradeFunded with no existing row throws MissingTradeError (no stub)", async () => {
    const tx = mockTx(null);
    await expect(handleTradeFunded(tx, parsed(EventType.TradeFunded))).rejects.toBeInstanceOf(
      MissingTradeError,
    );
    expect(tx.trade.create).not.toHaveBeenCalled();
  });

  it("TradeCreated for PENDING_SIGNATURE backfills addresses + transitions to CREATED", async () => {
    const tx = mockTx({ tradeId: "trade-X", status: TradeStatus.PENDING_SIGNATURE, version: 1 });
    await handleTradeCreated(tx, parsed(EventType.TradeCreated));
    expect(tx.trade.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TradeStatus.CREATED,
          buyerAddress: "gbuyer",
          sellerAddress: "gseller",
          amountUsdc: "50",
        }),
      }),
    );
  });

  it("late TradeCreated backfills legacy empty-address CREATED row", async () => {
    const tx = mockTx({
      tradeId: "trade-X",
      status: TradeStatus.CREATED,
      version: 2,
      buyerAddress: "",
      sellerAddress: "",
    });
    await handleTradeCreated(tx, parsed(EventType.TradeCreated));
    expect(tx.trade.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buyerAddress: "gbuyer",
          sellerAddress: "gseller",
        }),
      }),
    );
  });

  it("duplicate TradeCreated for healthy CREATED row is idempotent no-op", async () => {
    const tx = mockTx({
      tradeId: "trade-X",
      status: TradeStatus.CREATED,
      version: 2,
      buyerAddress: "gbuyer",
      sellerAddress: "gseller",
    });
    await handleTradeCreated(tx, parsed(EventType.TradeCreated));
    expect(tx.trade.updateMany).not.toHaveBeenCalled();
  });

  it("isMissingTradeError identifies ordering gaps", () => {
    expect(isMissingTradeError(new MissingTradeError("t", EventType.TradeFunded))).toBe(true);
    const named = new Error("Trade t not found for event TradeFunded");
    named.name = "MissingTradeError";
    expect(isMissingTradeError(named)).toBe(true);
    expect(isMissingTradeError(new Error("boom"))).toBe(false);
  });
});

describe("eventListener #1404 — per-trade ordering + deferred retries", () => {
  function prismaForOrdering(blockers: Array<{ id: number; ledgerSequence: number; status: string }>) {
    const outbox = { id: 20, status: "PENDING", attempts: 0, nextAttemptAt: new Date(Date.now() - 1000), tradeId: "trade-X", ledgerSequence: 20 };
    const tx = {
      processedEvent: { create: jest.fn().mockResolvedValue({}) },
      chainEventOutbox: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    return {
      processedEvent: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      chainEventOutbox: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue(blockers),
        upsert: jest.fn().mockResolvedValue({ ...outbox }),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...outbox, ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
      _outbox: outbox,
      _tx: tx,
    } as any;
  }

  function raw(ledger: number, id: string) {
    return { ledger, id, contractId: "CONTRACT_X", topic: [{ x: 1 }], value: { type: "map", value: [{ key: { value: "trade_id" }, val: { value: "trade-X" } }] } } as any;
  }

  beforeEach(() => {
    (dispatchEvent as jest.Mock).mockReset();
    const StellarSdk = require("@stellar/stellar-sdk");
    (StellarSdk.scValToNative as jest.Mock).mockReset().mockReturnValue("TRDCRT");
  });

  it("defers later event when earlier event for same trade is unprocessed (no attempt consumed)", async () => {
    const prisma = prismaForOrdering([{ id: 5, ledgerSequence: 10, status: "RETRYING" }]);
    const svc = new EventListenerService(prisma);
    (svc as any).running = true;
    (dispatchEvent as jest.Mock).mockResolvedValue(() => {});
    // Current event is ledger 20, predecessor ledger 10 still RETRYING
    await svc.processEvent(raw(20, "evt-20"));
    expect(dispatchEvent).not.toHaveBeenCalled();
    // Deferred via update (nextAttemptAt pushed) but attempts NOT incremented to 1
    const updateArg = prisma.chainEventOutbox.update.mock.calls[0]?.[0];
    expect(updateArg).toBeDefined();
    expect(updateArg.data.attempts).toBeUndefined();
  });

  it("processes when no blocker exists", async () => {
    const prisma = prismaForOrdering([]);
    const svc = new EventListenerService(prisma);
    (svc as any).running = true;
    (dispatchEvent as jest.Mock).mockResolvedValue(() => {});
    await svc.processEvent(raw(20, "evt-20"));
    expect(dispatchEvent).toHaveBeenCalled();
    expect(prisma.chainEventOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tradeId: expect.any(String) }) }),
    );
  });

  it("MissingTradeError stays RETRYING without exhausting attempts (never DEAD_LETTER)", async () => {
    const outbox = { id: 21, status: "RETRYING", attempts: 2, nextAttemptAt: new Date(Date.now() - 1000), tradeId: "trade-X", ledgerSequence: 20 };
    const tx = {
      processedEvent: { create: jest.fn().mockResolvedValue({}) },
      chainEventOutbox: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      processedEvent: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      chainEventOutbox: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({ ...outbox }),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...outbox, ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    } as any;
    const svc = new EventListenerService(prisma);
    (svc as any).running = true;
    const missing = new Error("Trade trade-X not found for event TradeFunded");
    missing.name = "MissingTradeError";
    (dispatchEvent as jest.Mock).mockRejectedValueOnce(missing);
    await svc.processEvent(raw(20, "evt-20"));
    const updateArg = prisma.chainEventOutbox.update.mock.calls[0][0];
    // Must stay RETRYING even at max attempts (2/3) — attempts NOT incremented
    expect(updateArg.data.status).toBe("RETRYING");
    expect(updateArg.data.attempts).toBeUndefined();
  });
});
