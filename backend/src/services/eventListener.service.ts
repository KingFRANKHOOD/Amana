import { PrismaClient, Prisma } from "@prisma/client";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  getEventListenerConfig,
  EventListenerConfig,
} from "../config/eventListener.config";
import { EventType, ParsedEvent } from "../types/events";
import { dispatchEvent } from "./eventHandlers";
import { appLogger } from "../middleware/logger";

type OutboxStatus = "PENDING" | "RETRYING" | "PROCESSED" | "DEAD_LETTER";

type OutboxRecord = {
  id: number;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
};

/**
 * Check whether a `ProcessedEvent` record already exists for the given composite key.
 * Returns `true` if the event has been processed before, `false` otherwise.
 *
 * Requirement 3.4: checks the DB (not only in-memory cache) so restarts don't bypass deduplication.
 */
export async function isAlreadyProcessed(
  prisma: PrismaClient,
  key: { ledgerSequence: number; contractId: string; eventId: string }
): Promise<boolean> {
  const existing = await (prisma as any).processedEvent.findUnique({
    where: {
      ledgerSequence_contractId_eventId: key,
    },
  });
  return existing !== null;
}

/**
 * Returns true if the error is a Prisma unique-constraint violation (P2002).
 */
export function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (err as any)?.code === "P2002";
}

/**
 * Wraps the handler call and the `ProcessedEvent` marker insert in a single
 * Prisma transaction, guaranteeing atomicity (Requirement 2.1, 2.2, 2.3).
 *
 * If a P2002 unique-constraint violation is raised (concurrent duplicate),
 * the error is swallowed and the event is treated as already-processed
 * (Requirement 1.3).
 */
export async function processEventAtomically(
  prisma: PrismaClient,
  event: ParsedEvent,
  handler: (tx: Prisma.TransactionClient, event: ParsedEvent) => Promise<void>
): Promise<void> {
  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await handler(tx, event);
      await (tx as any).processedEvent.create({
        data: {
          ledgerSequence: event.ledgerSequence,
          contractId: event.contractId,
          eventId: event.eventId,
        },
      });
    });
  } catch (err) {
    if (isPrismaUniqueConstraintError(err)) {
      appLogger.debug({ eventId: event.eventId }, "[EventListener] Duplicate insert ignored");
      return;
    }
    throw err;
  }
}

/**
 * EventListenerService — long-running service that polls Soroban RPC for
 * contract events and synchronises on-chain state to the local database.
 *
 * Design choices:
 * - Recursive setTimeout (not setInterval) to avoid overlapping polls
 * - In-memory Set + DB table for duplicate ledger filtering
 * - Exponential backoff with jitter on RPC failures
 */
export class EventListenerService {
  private prisma: PrismaClient;
  private config: EventListenerConfig;
  private server: StellarSdk.rpc.Server;
  private processedEvents: Set<string> = new Set();
  private lastLedger: number = 0;
  private running: boolean = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private currentBackoffMs: number;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.config = getEventListenerConfig();
    this.server = new StellarSdk.rpc.Server(this.config.rpcUrl);
    this.currentBackoffMs = this.config.backoffInitialMs;
  }

  /** Boot the polling loop. Loads recent processed ledgers from DB into memory. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Hydrate in-memory set from DB on startup
    const recentEvents = await (this.prisma as any).processedEvent.findMany({
      orderBy: { ledgerSequence: "desc" },
      take: this.config.processedLedgersCacheSize,
    });
    for (const e of recentEvents) {
      const cacheKey = `${e.ledgerSequence}:${e.contractId}:${e.eventId}`;
      this.processedEvents.add(cacheKey);
    }
    if (recentEvents.length > 0) {
      this.lastLedger = recentEvents[0].ledgerSequence;
    }

    appLogger.info(
      {
        pollIntervalMs: this.config.pollIntervalMs,
        contractId: this.config.contractId,
      },
      "[EventListener] Started",
    );
    this.scheduleNextPoll(0);
  }

  /** Gracefully stop the polling loop. */
  stop(): void {
    this.running = false;
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    appLogger.info("[EventListener] Stopped");
  }

  /** Schedule the next poll with a given delay. */
  private scheduleNextPoll(delayMs: number): void {
    if (!this.running) return;
    this.timeoutHandle = setTimeout(() => this.pollEvents(), delayMs);
  }

  /** Single poll cycle: fetch events from RPC, parse, and dispatch. */
  async pollEvents(): Promise<void> {
    if (!this.running) return;

    try {
      const startLedger = this.lastLedger > 0 ? this.lastLedger + 1 : undefined;

      const response = await this.server.getEvents({
        startLedger,
        filters: [
          {
            type: "contract",
            contractIds: [this.config.contractId],
          },
        ],
        limit: 100,
      } as StellarSdk.rpc.Server.GetEventsRequest);

      if (response.events && response.events.length > 0) {
        for (const rawEvent of response.events) {
          await this.processEvent(rawEvent);
        }
      }

      this.resetBackoff();
      this.scheduleNextPoll(this.config.pollIntervalMs);
    } catch (error) {
      appLogger.error({ error }, "[EventListener] Poll failed");
      this.handleBackoff();
    }
  }

  /** Parse a single raw Soroban event and dispatch to the appropriate handler. */
  async processEvent(rawEvent: StellarSdk.rpc.Api.EventResponse): Promise<void> {
    const parsed = this.parseEvent(rawEvent);
    if (!parsed) return;

    const { ledgerSequence, contractId, eventId } = parsed;
    const cacheKey = `${ledgerSequence}:${contractId}:${eventId}`;

    // Fast path: in-memory cache
    if (this.processedEvents.has(cacheKey)) return;

    // Durable path: DB check (survives restarts)
    if (await isAlreadyProcessed(this.prisma, { ledgerSequence, contractId, eventId })) {
      this.processedEvents.add(cacheKey);
      return;
    }

    if (!this.supportsOutboxPersistence()) {
      try {
        await processEventAtomically(this.prisma, parsed, dispatchEvent);
        this.processedEvents.add(cacheKey);
        this.evictOldEvents();
        if (ledgerSequence > this.lastLedger) {
          this.lastLedger = ledgerSequence;
        }
        appLogger.debug(
          {
            eventType: parsed.eventType,
            tradeId: parsed.tradeId,
            ledger: ledgerSequence,
          },
          "[EventListener] Processed event",
        );
      } catch (error) {
        appLogger.error({ error, eventId }, "[EventListener] Failed to process event");
        throw error;
      }
      return;
    }

    const outbox = await this.ensureOutboxRecord(parsed);
    if (!this.isOutboxReadyForAttempt(outbox)) {
      return;
    }

    try {
      await this.processOutboxEventAtomically(outbox.id, parsed);
      this.processedEvents.add(cacheKey);
      this.evictOldEvents();
      if (ledgerSequence > this.lastLedger) {
        this.lastLedger = ledgerSequence;
      }
      appLogger.debug(
        {
          eventType: parsed.eventType,
          tradeId: parsed.tradeId,
          ledger: ledgerSequence,
        },
        "[EventListener] Processed event",
      );
    } catch (error) {
      await this.recordOutboxFailure(outbox, error);
      appLogger.error({ error, eventId }, "[EventListener] Failed to process event; scheduled for retry");
    }
  }

  private supportsOutboxPersistence(): boolean {
    const outbox = (this.prisma as any).chainEventOutbox;
    return Boolean(outbox && typeof outbox.findUnique === "function");
  }

  private async ensureOutboxRecord(event: ParsedEvent): Promise<OutboxRecord> {
    const key = {
      ledgerSequence: event.ledgerSequence,
      contractId: event.contractId,
      eventId: event.eventId,
    };

    const existing = await (this.prisma as any).chainEventOutbox.findUnique({
      where: {
        ledgerSequence_contractId_eventId: key,
      },
      select: {
        id: true,
        status: true,
        attempts: true,
        nextAttemptAt: true,
      },
    });

    if (existing) {
      return existing as OutboxRecord;
    }

    try {
      const created = await (this.prisma as any).chainEventOutbox.create({
        data: {
          ledgerSequence: event.ledgerSequence,
          contractId: event.contractId,
          eventId: event.eventId,
          eventType: event.eventType,
          tradeId: event.tradeId,
          payload: event.data,
          status: "PENDING",
        },
        select: {
          id: true,
          status: true,
          attempts: true,
          nextAttemptAt: true,
        },
      });
      return created as OutboxRecord;
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) {
        throw error;
      }
      const concurrent = await (this.prisma as any).chainEventOutbox.findUnique({
        where: {
          ledgerSequence_contractId_eventId: key,
        },
        select: {
          id: true,
          status: true,
          attempts: true,
          nextAttemptAt: true,
        },
      });
      if (!concurrent) {
        throw error;
      }
      return concurrent as OutboxRecord;
    }
  }

  private isOutboxReadyForAttempt(outbox: OutboxRecord): boolean {
    if (outbox.status === "PROCESSED") {
      return false;
    }
    if (outbox.status === "DEAD_LETTER") {
      appLogger.warn({ outboxId: outbox.id }, "[EventListener] Skipping dead-letter event");
      return false;
    }
    const now = Date.now();
    if (new Date(outbox.nextAttemptAt).getTime() > now) {
      return false;
    }
    return true;
  }

  private async processOutboxEventAtomically(outboxId: number, event: ParsedEvent): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await dispatchEvent(tx, event);
        await (tx as any).processedEvent.create({
          data: {
            ledgerSequence: event.ledgerSequence,
            contractId: event.contractId,
            eventId: event.eventId,
          },
        });
        await (tx as any).chainEventOutbox.update({
          where: { id: outboxId },
          data: {
            status: "PROCESSED",
            attempts: { increment: 1 },
            nextAttemptAt: new Date(),
            lastError: null,
            deadLetteredAt: null,
            processedAt: new Date(),
          },
        });
      });
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) {
        throw error;
      }
      await (this.prisma as any).chainEventOutbox.update({
        where: { id: outboxId },
        data: {
          status: "PROCESSED",
          nextAttemptAt: new Date(),
          lastError: null,
          deadLetteredAt: null,
          processedAt: new Date(),
        },
      });
    }
  }

  private computeRetryDelay(attemptNumber: number): number {
    const exponent = Math.max(attemptNumber - 1, 0);
    const baseDelay = this.config.backoffInitialMs * Math.pow(2, exponent);
    return Math.min(baseDelay, this.config.backoffMaxMs);
  }

  private async recordOutboxFailure(outbox: OutboxRecord, error: unknown): Promise<void> {
    const nextAttempts = outbox.attempts + 1;
    const canRetry = nextAttempts < this.config.outboxMaxAttempts;
    const retryDelayMs = this.computeRetryDelay(nextAttempts);
    const now = Date.now();
    const message = error instanceof Error ? error.message : String(error);

    await (this.prisma as any).chainEventOutbox.update({
      where: { id: outbox.id },
      data: {
        attempts: nextAttempts,
        status: canRetry ? "RETRYING" : "DEAD_LETTER",
        nextAttemptAt: canRetry ? new Date(now + retryDelayMs) : new Date(now),
        lastError: message.slice(0, 2000),
        deadLetteredAt: canRetry ? null : new Date(now),
      },
    });

    if (!canRetry) {
      appLogger.error(
        {
          outboxId: outbox.id,
          attempts: nextAttempts,
        },
        "[EventListener] Event moved to dead-letter state",
      );
    }
  }

  /** Parse raw Soroban event into our internal format. */
  private parseEvent(
    rawEvent: StellarSdk.rpc.Api.EventResponse,
  ): ParsedEvent | null {
    try {
      const topic = rawEvent.topic;
      if (!topic || topic.length === 0) return null;

      // The first topic element is the event type symbol
      const eventSymbol = this.extractSymbolValue(topic[0]);
      if (!eventSymbol) return null;

      const eventType = this.mapSymbolToEventType(eventSymbol);
      if (!eventType) {
        appLogger.warn({ eventSymbol }, "[EventListener] Unknown event symbol");
        return null;
      }

      // Extract trade_id from second topic element or from value
      const tradeId =
        topic.length > 1 ? this.extractScalarValue(topic[1]) : "unknown";

      const data: Record<string, unknown> = {};
      if (rawEvent.value) {
        data.raw = rawEvent.value;
      }

      return {
        eventType,
        tradeId: String(tradeId),
        ledgerSequence: rawEvent.ledger,
        contractId: String(rawEvent.contractId ?? this.config.contractId),
        eventId: rawEvent.id,
        data,
      };
    } catch (error) {
      appLogger.error({ error }, "[EventListener] Failed to parse event");
      return null;
    }
  }

  /** Extract a Symbol string value from an XDR ScVal. */
  private extractSymbolValue(scVal: StellarSdk.xdr.ScVal): string | null {
    try {
      const nativeVal = StellarSdk.scValToNative(scVal);
      if (typeof nativeVal === "string") return nativeVal;
      return String(nativeVal);
    } catch {
      return null;
    }
  }

  /** Extract a scalar value (string or number) from an XDR ScVal. */
  private extractScalarValue(scVal: StellarSdk.xdr.ScVal): string {
    try {
      const nativeVal = StellarSdk.scValToNative(scVal);
      return String(nativeVal);
    } catch {
      return "unknown";
    }
  }

  /** Map Soroban event topic symbol to our EventType enum. */
  private mapSymbolToEventType(symbol: string): EventType | null {
    const mapping: Record<string, EventType> = {
      TradeCreated: EventType.TradeCreated,
      trade_created: EventType.TradeCreated,
      TradeFunded: EventType.TradeFunded,
      trade_funded: EventType.TradeFunded,
      DeliveryConfirmed: EventType.DeliveryConfirmed,
      delivery_confirmed: EventType.DeliveryConfirmed,
      FundsReleased: EventType.FundsReleased,
      funds_released: EventType.FundsReleased,
      DisputeInitiated: EventType.DisputeInitiated,
      dispute_initiated: EventType.DisputeInitiated,
      DisputeResolved: EventType.DisputeResolved,
      dispute_resolved: EventType.DisputeResolved,
    };
    return mapping[symbol] ?? null;
  }

  /** Exponential backoff on RPC failure. */
  handleBackoff(): void {
    const jitter = Math.random() * this.currentBackoffMs * 0.1;
    const delay = Math.min(
      this.currentBackoffMs + jitter,
      this.config.backoffMaxMs,
    );

    appLogger.warn(
      { delayMs: Math.round(delay) },
      "[EventListener] Backing off",
    );
    this.scheduleNextPoll(delay);

    this.currentBackoffMs = Math.min(
      this.currentBackoffMs * 2,
      this.config.backoffMaxMs,
    );
  }

  /** Reset backoff to initial value after a successful poll. */
  resetBackoff(): void {
    this.currentBackoffMs = this.config.backoffInitialMs;
  }


  /** Evict oldest events from in-memory set when it exceeds the cache limit. */
  private evictOldEvents(): void {
    if (this.processedEvents.size <= this.config.processedLedgersCacheSize) return;

    const sorted = Array.from(this.processedEvents).sort((a, b) => {
      const ledgerA = parseInt(a.split(":")[0], 10);
      const ledgerB = parseInt(b.split(":")[0], 10);
      return ledgerA - ledgerB;
    });
    const toRemove = sorted.length - this.config.processedLedgersCacheSize;
    for (let i = 0; i < toRemove; i++) {
      this.processedEvents.delete(sorted[i]);
    }
  }
}
