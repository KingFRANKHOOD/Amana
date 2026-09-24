import { Prisma, TradeStatus } from "@prisma/client";
import { EventType, ParsedEvent, EVENT_TO_STATUS } from "../types/events";
import { appLogger } from "../middleware/logger";
import { webhookService } from "./webhook.service";
import { logEscrowEvent } from "../lib/escrowAudit";
import { feeAccountingService } from "./feeAccounting.service";

type TradeCreatePayload = {
  tradeId: string;
  buyerAddress: string;
  sellerAddress: string;
  amountUsdc?: string;
  status: TradeStatus;
  version: number;
};

const VALID_PREDECESSORS: Partial<Record<EventType, TradeStatus[]>> = {
  [EventType.TradeCreated]: [TradeStatus.PENDING_SIGNATURE],
  [EventType.TradeFunded]: [TradeStatus.CREATED, TradeStatus.PENDING_SIGNATURE],
  [EventType.DeliveryConfirmed]: [TradeStatus.FUNDED],
  [EventType.FundsReleased]: [TradeStatus.DELIVERED],
  [EventType.DisputeInitiated]: [TradeStatus.FUNDED, TradeStatus.DELIVERED],
  [EventType.DisputeResolved]: [TradeStatus.DISPUTED],
};

/** Typed error thrown when a non-create event arrives with no matching trade row. */
export class MissingTradeError extends Error {
  constructor(
    public readonly tradeId: string,
    public readonly eventType: EventType,
  ) {
    super(`Trade ${tradeId} not found for event ${eventType}`);
    this.name = "MissingTradeError";
  }
}

/** Typed error thrown when party addresses are absent or empty. */
export class InvalidPartyAddressError extends Error {
  constructor(
    public readonly tradeId: string,
    field: string,
  ) {
    super(`Trade ${tradeId}: ${field} is missing or empty`);
    this.name = "InvalidPartyAddressError";
  }
}

/**
 * Validate and normalise a raw on-chain address.
 *
 * - Trims whitespace
 * - Lowercases (Stellar addresses are case-insensitive but we store lowercase)
 * - Throws InvalidPartyAddressError if the value is absent or empty
 */
function normalizeAddress(
  raw: unknown,
  field: string,
  tradeId: string,
): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new InvalidPartyAddressError(tradeId, field);
  }
  return raw.trim().toLowerCase();
}

async function applyStatusTransition(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
  createPayload: TradeCreatePayload,
): Promise<void> {
  const existing = await tx.trade.findUnique({
    where: { tradeId: event.tradeId },
  });

  if (!existing) {
    // Only TradeCreated should legitimately create a new row.  All other
    // event types that reach here without a trade row indicate a gap in
    // processing — fail loudly rather than inserting garbage.
    if (event.eventType !== EventType.TradeCreated) {
      throw new MissingTradeError(event.tradeId, event.eventType);
    }

    // Validate that both party addresses are present and non-empty before
    // creating the row, preventing FK violations (P2003) and stale records
    // with blank addresses.
    if (
      !createPayload.buyerAddress ||
      createPayload.buyerAddress.trim() === ""
    ) {
      throw new InvalidPartyAddressError(event.tradeId, "buyerAddress");
    }
    if (
      !createPayload.sellerAddress ||
      createPayload.sellerAddress.trim() === ""
    ) {
      throw new InvalidPartyAddressError(event.tradeId, "sellerAddress");
    }

    await tx.trade.create({ data: createPayload });
    return;
  }

  const validPredecessors = VALID_PREDECESSORS[event.eventType];
  if (
    !validPredecessors ||
    !validPredecessors.includes(existing.status as TradeStatus)
  ) {
    return;
  }

  const newStatus = EVENT_TO_STATUS[event.eventType];
  if (!newStatus) return;

  const result = await tx.trade.updateMany({
    where: {
      tradeId: event.tradeId,
      status: existing.status,
      version: existing.version,
    },
    data: {
      status: newStatus,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  });

  if (result.count === 0) {
    throw new Error("Concurrency conflict");
  }
}

// ---------------------------------------------------------------------------
// Webhook dispatch helper
// ---------------------------------------------------------------------------

/**
 * Fire a webhook dispatch **outside** the DB transaction.
 *
 * Errors are caught and logged so a failed delivery never rolls back the
 * committed state change or generates an unhandled promise rejection.
 */
function scheduleWebhook(
  tradeId: string,
  status: TradeStatus,
  metadata: Record<string, unknown>,
): void {
  webhookService.dispatch(tradeId, status, metadata).catch((err: unknown) => {
    appLogger.error(
      { err, tradeId, status },
      "[EventHandler] Webhook dispatch failed (post-commit)",
    );
  });
}

// ---------------------------------------------------------------------------
// Per-event handlers — each returns a post-commit thunk (or void)
// ---------------------------------------------------------------------------
//
// IMPORTANT: handlers no longer call webhookService directly. They return a
// () => void thunk that dispatchEvent fires *after* the surrounding Prisma
// transaction commits.  This guarantees:
//   1. No unawaited promise inside the transaction boundary.
//   2. Webhook delivery cannot race the commit (it only starts after commit).
//   3. A delivery failure cannot corrupt the committed state.
// ---------------------------------------------------------------------------

export async function handleTradeCreated(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
): Promise<() => void> {
  const buyerAddress = normalizeAddress(
    event.data.buyer,
    "buyerAddress",
    event.tradeId,
  );
  const sellerAddress = normalizeAddress(
    event.data.seller,
    "sellerAddress",
    event.tradeId,
  );

  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress,
    sellerAddress,
    amountUsdc: String(event.data.amount_usdc ?? "0"),
    status: EVENT_TO_STATUS[EventType.TradeCreated]!,
    version: 1,
  });
  await logEscrowEvent(tx, {
    tradeId: event.tradeId,
    eventType: "TradeCreated",
    toStatus: TradeStatus.CREATED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
    actor: buyerAddress,
    amountUsdc:
      event.data.amount_usdc != null
        ? String(event.data.amount_usdc)
        : undefined,
    extra: { seller: sellerAddress },
  });
  appLogger.debug(
    { tradeId: event.tradeId, ledger: event.ledgerSequence },
    "[EventHandler] TradeCreated",
  );
  return () =>
    scheduleWebhook(event.tradeId, TradeStatus.CREATED, {
      ledger: event.ledgerSequence,
    });
}

export async function handleTradeFunded(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
): Promise<() => void> {
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    // TradeFunded does not carry party addresses — the trade row must already
    // exist. applyStatusTransition will throw MissingTradeError if it does not.
    buyerAddress: "",
    sellerAddress: "",
    status: EVENT_TO_STATUS[EventType.TradeFunded]!,
    version: 1,
  });
  await logEscrowEvent(tx, {
    tradeId: event.tradeId,
    eventType: "TradeFunded",
    toStatus: TradeStatus.FUNDED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
    amountUsdc:
      event.data.amount_usdc != null
        ? String(event.data.amount_usdc)
        : undefined,
    extra: { note: "funds_locked_in_escrow" },
  });
  appLogger.info(
    {
      requestId: undefined,
      userId: undefined,
      paymentId: event.tradeId,
      provider: "stellar",
      status: "authorization_approved",
      timestamp: new Date().toISOString(),
    },
    "Payment authorization approved",
  );
  appLogger.debug(
    { tradeId: event.tradeId, ledger: event.ledgerSequence },
    "[EventHandler] TradeFunded",
  );
  return () =>
    scheduleWebhook(event.tradeId, TradeStatus.FUNDED, {
      ledger: event.ledgerSequence,
    });
}

export async function handleDeliveryConfirmed(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
): Promise<() => void> {
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: "",
    sellerAddress: "",
    status: EVENT_TO_STATUS[EventType.DeliveryConfirmed]!,
    version: 1,
  });
  await logEscrowEvent(tx, {
    tradeId: event.tradeId,
    eventType: "DeliveryConfirmed",
    toStatus: TradeStatus.DELIVERED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
  });
  appLogger.debug(
    { tradeId: event.tradeId, ledger: event.ledgerSequence },
    "[EventHandler] DeliveryConfirmed",
  );
  return () =>
    scheduleWebhook(event.tradeId, TradeStatus.DELIVERED, {
      ledger: event.ledgerSequence,
    });
}

export async function handleFundsReleased(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
): Promise<() => void> {
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: "",
    sellerAddress: "",
    status: EVENT_TO_STATUS[EventType.FundsReleased]!,
    version: 1,
  });

  // Record the 1% platform fee for this completed trade
  const amountUsdc =
    event.data.amount_usdc != null ? String(event.data.amount_usdc) : "0";
  await feeAccountingService.recordFee(
    tx,
    event.tradeId,
    amountUsdc,
    event.ledgerSequence,
  );

  await logEscrowEvent(tx, {
    tradeId: event.tradeId,
    eventType: "FundsReleased",
    toStatus: TradeStatus.COMPLETED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
    amountUsdc:
      event.data.amount_usdc != null
        ? String(event.data.amount_usdc)
        : undefined,
    extra: { note: "funds_released_to_seller" },
  });
  appLogger.debug(
    { tradeId: event.tradeId, ledger: event.ledgerSequence },
    "[EventHandler] FundsReleased",
  );
  return () =>
    scheduleWebhook(event.tradeId, TradeStatus.COMPLETED, {
      ledger: event.ledgerSequence,
    });
}

export async function handleDisputeInitiated(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
): Promise<() => void> {
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: "",
    sellerAddress: "",
    status: EVENT_TO_STATUS[EventType.DisputeInitiated]!,
    version: 1,
  });
  await logEscrowEvent(tx, {
    tradeId: event.tradeId,
    eventType: "DisputeInitiated",
    toStatus: TradeStatus.DISPUTED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
    actor: (event.data.initiator as string) || undefined,
    extra: { reason: event.data.reason },
  });
  appLogger.debug(
    { tradeId: event.tradeId, ledger: event.ledgerSequence },
    "[EventHandler] DisputeInitiated",
  );
  return () =>
    scheduleWebhook(event.tradeId, TradeStatus.DISPUTED, {
      ledger: event.ledgerSequence,
    });
}

export async function handleDisputeResolved(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
): Promise<() => void> {
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: "",
    sellerAddress: "",
    status: EVENT_TO_STATUS[EventType.DisputeResolved]!,
    version: 1,
  });

  // Record the 1% platform fee for dispute-resolved (completed) trades
  const amountUsdc =
    event.data.amount_usdc != null ? String(event.data.amount_usdc) : "0";
  await feeAccountingService.recordFee(
    tx,
    event.tradeId,
    amountUsdc,
    event.ledgerSequence,
  );

  await logEscrowEvent(tx, {
    tradeId: event.tradeId,
    eventType: "DisputeResolved",
    toStatus: TradeStatus.COMPLETED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
    actor: (event.data.resolver as string) || undefined,
    extra: { resolution: event.data.resolution },
  });
  appLogger.debug(
    { tradeId: event.tradeId, ledger: event.ledgerSequence },
    "[EventHandler] DisputeResolved",
  );
  return () =>
    scheduleWebhook(event.tradeId, TradeStatus.COMPLETED, {
      ledger: event.ledgerSequence,
    });
}

/** Dispatch a parsed event to the correct handler, returning a post-commit thunk. */
export async function dispatchEvent(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
): Promise<() => void> {
  const handlers: Record<
    EventType,
    (t: Prisma.TransactionClient, e: ParsedEvent) => Promise<() => void>
  > = {
    [EventType.TradeCreated]: handleTradeCreated,
    [EventType.TradeFunded]: handleTradeFunded,
    [EventType.TradeCancelled]: handleTradeCancelled,
    [EventType.TradeCancelledByBuyer]: handleTradeCancelled,
    [EventType.TradeExpired]: handleTradeCancelled,
    [EventType.DeliveryConfirmed]: handleDeliveryConfirmed,
    [EventType.FundsReleased]: handleFundsReleased,
    [EventType.DisputeInitiated]: handleDisputeInitiated,
    [EventType.DisputeResolved]: handleDisputeResolved,
    [EventType.EvidenceSubmitted]: handleNoop,
    [EventType.VideoProofSubmitted]: handleNoop,
    [EventType.ManifestSubmitted]: handleNoop,
    [EventType.DeadlineExtended]: handleNoop,
    [EventType.MediatorAdded]: handleNoop,
    [EventType.MediatorRemoved]: handleNoop,
    [EventType.FeeRateUpdated]: handleNoop,
    [EventType.FeesWithdrawn]: handleNoop,
    [EventType.PathPaymentInitiated]: handleNoop,
    [EventType.PathPaymentExecuted]: handleNoop,
    [EventType.ContractUpgraded]: handleNoop,
    [EventType.Initialized]: handleNoop,
  };

  const handler = handlers[event.eventType];
  if (handler) {
    return handler(tx, event);
  }

  appLogger.warn(
    { eventType: event.eventType },
    "[EventHandler] Unknown event type",
  );
  return noop;
}

async function handleTradeCancelled(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
): Promise<() => void> {
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: "",
    sellerAddress: "",
    status: TradeStatus.CANCELLED,
    version: 1,
  });
  appLogger.debug(
    { tradeId: event.tradeId, ledger: event.ledgerSequence },
    "[EventHandler] TradeCancelled",
  );
  return noop;
}

function noop(): void {
  // no-op for informational events that don't require state transitions or webhooks
}

async function handleNoop(
  _tx: Prisma.TransactionClient,
  _event: ParsedEvent,
): Promise<() => void> {
  return noop;
}
