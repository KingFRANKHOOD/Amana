import { Prisma, TradeStatus } from "@prisma/client";
import { EventType, ParsedEvent, EVENT_TO_STATUS } from "../types/events";
import { appLogger } from "../middleware/logger";
import { webhookService } from "./webhook.service";
import { logEscrowEvent } from "../lib/escrowAudit";

type TradeCreatePayload = {
  tradeId: string;
  buyerAddress: string;
  sellerAddress: string;
  amountUsdc?: string;
  status: (typeof EVENT_TO_STATUS)[EventType];
  version: number;
};

const VALID_PREDECESSORS: Partial<Record<EventType, TradeStatus[]>> = {
  [EventType.TradeFunded]: [TradeStatus.CREATED],
  [EventType.DeliveryConfirmed]: [TradeStatus.FUNDED],
  [EventType.FundsReleased]: [TradeStatus.DELIVERED],
  [EventType.DisputeInitiated]: [TradeStatus.FUNDED, TradeStatus.DELIVERED],
  [EventType.DisputeResolved]: [TradeStatus.DISPUTED],
};

async function applyStatusTransition(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
  createPayload: TradeCreatePayload,
): Promise<void> {
  const existing = await tx.trade.findUnique({ where: { tradeId: event.tradeId } });

  if (!existing) {
    await tx.trade.create({ data: createPayload });
    return;
  }

  const validPredecessors = VALID_PREDECESSORS[event.eventType];
  if (!validPredecessors || !validPredecessors.includes(existing.status as TradeStatus)) {
    return;
  }

  const result = await tx.trade.updateMany({
    where: { tradeId: event.tradeId, status: existing.status, version: existing.version },
    data: {
      status: EVENT_TO_STATUS[event.eventType],
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  });

  if (result.count === 0) {
    throw new Error("Concurrency conflict");
  }
}

export async function handleTradeCreated(tx: Prisma.TransactionClient, event: ParsedEvent): Promise<void> {
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: (event.data.buyer as string) || "",
    sellerAddress: (event.data.seller as string) || "",
    amountUsdc: String(event.data.amount_usdc ?? "0"),
    status: EVENT_TO_STATUS[EventType.TradeCreated],
    version: 1,
  });
  logEscrowEvent({
    tradeId: event.tradeId,
    eventType: "TradeCreated",
    toStatus: TradeStatus.CREATED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
    actor: (event.data.buyer as string) || undefined,
    amountUsdc: event.data.amount_usdc != null ? String(event.data.amount_usdc) : undefined,
    extra: { seller: event.data.seller },
  });
  appLogger.debug({ tradeId: event.tradeId, ledger: event.ledgerSequence }, "[EventHandler] TradeCreated");
  webhookService.dispatch(event.tradeId, TradeStatus.CREATED, { ledger: event.ledgerSequence });
}

export async function handleTradeFunded(tx: Prisma.TransactionClient, event: ParsedEvent): Promise<void> {
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: "",
    sellerAddress: "",
    status: EVENT_TO_STATUS[EventType.TradeFunded],
    version: 1,
  });
  logEscrowEvent({
    tradeId: event.tradeId,
    eventType: "TradeFunded",
    toStatus: TradeStatus.FUNDED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
    amountUsdc: event.data.amount_usdc != null ? String(event.data.amount_usdc) : undefined,
    extra: { note: "funds_locked_in_escrow" },
  });
  appLogger.info({
    requestId: undefined,
    userId: undefined,
    paymentId: event.tradeId,
    provider: "stellar",
    status: "authorization_approved",
    timestamp: new Date().toISOString()
  }, "Payment authorization approved");
  appLogger.debug({ tradeId: event.tradeId, ledger: event.ledgerSequence }, "[EventHandler] TradeFunded");
  webhookService.dispatch(event.tradeId, TradeStatus.FUNDED, { ledger: event.ledgerSequence });
}

export async function handleDeliveryConfirmed(tx: Prisma.TransactionClient, event: ParsedEvent): Promise<void> {
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: "",
    sellerAddress: "",
    status: EVENT_TO_STATUS[EventType.DeliveryConfirmed],
    version: 1,
  });
  logEscrowEvent({
    tradeId: event.tradeId,
    eventType: "DeliveryConfirmed",
    toStatus: TradeStatus.DELIVERED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
  });
  appLogger.debug({ tradeId: event.tradeId, ledger: event.ledgerSequence }, "[EventHandler] DeliveryConfirmed");
  webhookService.dispatch(event.tradeId, TradeStatus.DELIVERED, { ledger: event.ledgerSequence });
}

export async function handleFundsReleased(tx: Prisma.TransactionClient, event: ParsedEvent): Promise<void> {
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: "",
    sellerAddress: "",
    status: EVENT_TO_STATUS[EventType.FundsReleased],
    version: 1,
  });
  logEscrowEvent({
    tradeId: event.tradeId,
    eventType: "FundsReleased",
    toStatus: TradeStatus.COMPLETED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
    amountUsdc: event.data.amount_usdc != null ? String(event.data.amount_usdc) : undefined,
    extra: { note: "funds_released_to_seller" },
  });
  appLogger.debug({ tradeId: event.tradeId, ledger: event.ledgerSequence }, "[EventHandler] FundsReleased");
  webhookService.dispatch(event.tradeId, TradeStatus.COMPLETED, { ledger: event.ledgerSequence });
}

export async function handleDisputeInitiated(tx: Prisma.TransactionClient, event: ParsedEvent): Promise<void> {
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: "",
    sellerAddress: "",
    status: EVENT_TO_STATUS[EventType.DisputeInitiated],
    version: 1,
  });
  logEscrowEvent({
    tradeId: event.tradeId,
    eventType: "DisputeInitiated",
    toStatus: TradeStatus.DISPUTED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
    actor: (event.data.initiator as string) || undefined,
    extra: { reason: event.data.reason },
  });
  appLogger.debug({ tradeId: event.tradeId, ledger: event.ledgerSequence }, "[EventHandler] DisputeInitiated");
  webhookService.dispatch(event.tradeId, TradeStatus.DISPUTED, { ledger: event.ledgerSequence });
}

export async function handleDisputeResolved(tx: Prisma.TransactionClient, event: ParsedEvent): Promise<void> {
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: "",
    sellerAddress: "",
    status: EVENT_TO_STATUS[EventType.DisputeResolved],
    version: 1,
  });
  logEscrowEvent({
    tradeId: event.tradeId,
    eventType: "DisputeResolved",
    toStatus: TradeStatus.COMPLETED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
    actor: (event.data.resolver as string) || undefined,
    extra: { resolution: event.data.resolution },
  });
  appLogger.debug({ tradeId: event.tradeId, ledger: event.ledgerSequence }, "[EventHandler] DisputeResolved");
  webhookService.dispatch(event.tradeId, TradeStatus.COMPLETED, { ledger: event.ledgerSequence });
}

/** Dispatch a parsed event to the correct handler */
export async function dispatchEvent(tx: Prisma.TransactionClient, event: ParsedEvent): Promise<void> {
  const handlers: Record<EventType, (t: Prisma.TransactionClient, e: ParsedEvent) => Promise<void>> = {
    [EventType.TradeCreated]: handleTradeCreated,
    [EventType.TradeFunded]: handleTradeFunded,
    [EventType.DeliveryConfirmed]: handleDeliveryConfirmed,
    [EventType.FundsReleased]: handleFundsReleased,
    [EventType.DisputeInitiated]: handleDisputeInitiated,
    [EventType.DisputeResolved]: handleDisputeResolved,
  };

  const handler = handlers[event.eventType];
  if (handler) {
    await handler(tx, event);
  } else {
    appLogger.warn({ eventType: event.eventType }, "[EventHandler] Unknown event type");
  }
}
