import { PrismaClient } from "@prisma/client";
import { EventType, ParsedEvent, EVENT_TO_STATUS } from "../types/events";

/**
 * Event handler functions — one per Soroban contract event type.
 * Each handler upserts the corresponding Trade record in the database.
 */

export async function handleTradeCreated(prisma: PrismaClient, event: ParsedEvent): Promise<void> {
  const status = EVENT_TO_STATUS[EventType.TradeCreated];
  await prisma.trade.upsert({
    where: { tradeId: event.tradeId },
    update: {
      status,
      updatedAt: new Date(),
    },
    create: {
      tradeId: event.tradeId,
      buyer: (event.data.buyer as string) || "",
      seller: (event.data.seller as string) || "",
      amountUsdc: String(event.data.amount_usdc ?? "0"),
      status,
    },
  });
  console.log(`[EventHandler] TradeCreated — tradeId=${event.tradeId}, ledger=${event.ledgerSequence}`);
}

export async function handleTradeFunded(prisma: PrismaClient, event: ParsedEvent): Promise<void> {
  const status = EVENT_TO_STATUS[EventType.TradeFunded];
  await prisma.trade.upsert({
    where: { tradeId: event.tradeId },
    update: { status, updatedAt: new Date() },
    create: {
      tradeId: event.tradeId,
      buyer: "",
      seller: "",
      status,
    },
  });
  console.log(`[EventHandler] TradeFunded — tradeId=${event.tradeId}, ledger=${event.ledgerSequence}`);
}

export async function handleDeliveryConfirmed(prisma: PrismaClient, event: ParsedEvent): Promise<void> {
  const status = EVENT_TO_STATUS[EventType.DeliveryConfirmed];
  await prisma.trade.upsert({
    where: { tradeId: event.tradeId },
    update: { status, updatedAt: new Date() },
    create: {
      tradeId: event.tradeId,
      buyer: "",
      seller: "",
      status,
    },
  });
  console.log(`[EventHandler] DeliveryConfirmed — tradeId=${event.tradeId}, ledger=${event.ledgerSequence}`);
}

export async function handleFundsReleased(prisma: PrismaClient, event: ParsedEvent): Promise<void> {
  const status = EVENT_TO_STATUS[EventType.FundsReleased];
  await prisma.trade.upsert({
    where: { tradeId: event.tradeId },
    update: { status, updatedAt: new Date() },
    create: {
      tradeId: event.tradeId,
      buyer: "",
      seller: "",
      status,
    },
  });
  console.log(`[EventHandler] FundsReleased — tradeId=${event.tradeId}, ledger=${event.ledgerSequence}`);
}

export async function handleDisputeInitiated(prisma: PrismaClient, event: ParsedEvent): Promise<void> {
  const status = EVENT_TO_STATUS[EventType.DisputeInitiated];
  await prisma.trade.upsert({
    where: { tradeId: event.tradeId },
    update: { status, updatedAt: new Date() },
    create: {
      tradeId: event.tradeId,
      buyer: "",
      seller: "",
      status,
    },
  });
  console.log(`[EventHandler] DisputeInitiated — tradeId=${event.tradeId}, ledger=${event.ledgerSequence}`);
}

export async function handleDisputeResolved(prisma: PrismaClient, event: ParsedEvent): Promise<void> {
  const status = EVENT_TO_STATUS[EventType.DisputeResolved];
  await prisma.trade.upsert({
    where: { tradeId: event.tradeId },
    update: { status, updatedAt: new Date() },
    create: {
      tradeId: event.tradeId,
      buyer: "",
      seller: "",
      status,
    },
  });
  console.log(`[EventHandler] DisputeResolved — tradeId=${event.tradeId}, ledger=${event.ledgerSequence}`);
}

/** Dispatch a parsed event to the correct handler */
export async function dispatchEvent(prisma: PrismaClient, event: ParsedEvent): Promise<void> {
  const handlers: Record<EventType, (p: PrismaClient, e: ParsedEvent) => Promise<void>> = {
    [EventType.TradeCreated]: handleTradeCreated,
    [EventType.TradeFunded]: handleTradeFunded,
    [EventType.DeliveryConfirmed]: handleDeliveryConfirmed,
    [EventType.FundsReleased]: handleFundsReleased,
    [EventType.DisputeInitiated]: handleDisputeInitiated,
    [EventType.DisputeResolved]: handleDisputeResolved,
  };

  const handler = handlers[event.eventType];
  if (handler) {
    await handler(prisma, event);
  } else {
    console.warn(`[EventHandler] Unknown event type: ${event.eventType}`);
  }
}
