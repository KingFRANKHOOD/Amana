import { PrismaClient, Prisma } from "@prisma/client";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  getEventListenerConfig,
  EventListenerConfig,
} from "../config/eventListener.config";
import { EventType, ParsedEvent, EVENT_TOPIC_MAP } from "../types/events";
import { dispatchEvent } from "./eventHandlers";
import { appLogger } from "../middleware/logger";
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from "../lib/circuitBreaker";

type OutboxStatus = "PENDING" | "RETRYING" | "PROCESSED" | "DEAD_LETTER";

type OutboxRecord = {
  id: number;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
};

type ChainEventOutboxDelegate = PrismaClient["chainEventOutbox"];

function isChainEventOutboxDelegate(
  delegate: ChainEventOutboxDelegate | undefined,
): delegate is ChainEventOutboxDelegate {
  return typeof delegate?.findUnique === "function";
}

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
  const existing = await prisma.processedEvent.findUnique({
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
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  );
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
      await tx.processedEvent.create({
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
 * - In-memory Set indexed by ledger + DB table for duplicate filtering
 * - Exponential backoff with jitter on RPC failures
 */
export class EventListenerService {
  private prisma: PrismaClient;
  private config: EventListenerConfig;
  private server: StellarSdk.rpc.Server;
  private processedEvents: Set<string> = new Set();
  private processedEventsByLedger: Map<number, Set<string>> = new Map();
  private lastLedger: number = 0;
  private running: boolean = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private activePoll: Promise<void> | null = null;
  private currentBackoffMs: number;
  private stellarCircuit: CircuitBreaker;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.config = getEventListenerConfig();
    this.server = new StellarSdk.rpc.Server(this.config.rpcUrl);
    this.currentBackoffMs = this.config.backoffInitialMs;
    this.stellarCircuit = new CircuitBreaker("stellar-rpc", {
      failureThreshold: 3,
      successThreshold: 2,
      cooldownMs: 30_000,
    });
  }

  /** Boot the polling loop. Loads recent processed ledgers from DB into memory. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Hydrate in-memory set from DB on startup
    const recentEvents = await this.prisma.processedEvent.findMany({
      orderBy: { ledgerSequence: "desc" },
      take: this.config.processedLedgersCacheSize,
    });
    // The query is newest-first; hydrate oldest-first so Map insertion order
    // remains the eviction order used by the O(1) ledger bucket cache.
    for (const e of [...recentEvents].reverse()) {
      const cacheKey = `${e.ledgerSequence}:${e.contractId}:${e.eventId}`;
      this.cacheProcessedEvent(cacheKey, e.ledgerSequence);
    }
    if (recentEvents.length > 0) {
      this.lastLedger = recentEvents[0]!.ledgerSequence;
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
  async stop(): Promise<void> {
    this.running = false;
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    if (this.activePoll) {
      await this.activePoll;
      this.activePoll = null;
    }
    appLogger.info("[EventListener] Stopped");
  }

  /** Schedule the next poll with a given delay. */
  private scheduleNextPoll(delayMs: number): void {
    if (!this.running) return;
    this.timeoutHandle = setTimeout(() => {
      const poll = this.pollEvents();
      this.activePoll = poll;
      void poll.then(
        () => {
          if (this.activePoll === poll) this.activePoll = null;
        },
        () => {
          if (this.activePoll === poll) this.activePoll = null;
        },
      );
    }, delayMs);
  }

  /** Single poll cycle: fetch events from RPC, parse, and dispatch. */
  async pollEvents(): Promise<void> {
    if (!this.running) return;

    try {
      const startLedger = this.lastLedger > 0 ? this.lastLedger + 1 : undefined;

      const response = await this.stellarCircuit.call(() =>
        this.server.getEvents({
          startLedger,
          filters: [
            {
              type: "contract",
              contractIds: [this.config.contractId],
            },
          ],
          limit: 100,
        } as StellarSdk.rpc.Server.GetEventsRequest),
      );

      if (response.events && response.events.length > 0) {
        for (const rawEvent of response.events) {
          await this.processEvent(rawEvent);
        }
      }

      this.resetBackoff();
      this.scheduleNextPoll(this.config.pollIntervalMs);
    } catch (error) {
      if (error instanceof CircuitBreakerOpenError) {
        appLogger.warn({}, "[EventListener] Circuit breaker open — skipping poll");
        this.scheduleNextPoll(this.stellarCircuit.cooldownMsValue);
      } else {
        appLogger.error({ error }, "[EventListener] Poll failed");
        this.handleBackoff();
      }
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
      this.cacheProcessedEvent(cacheKey, ledgerSequence);
      this.evictOldEvents();
      return;
    }

    if (!this.supportsOutboxPersistence()) {
      try {
        await processEventAtomically(this.prisma, parsed, dispatchEvent);
        this.cacheProcessedEvent(cacheKey, ledgerSequence);
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
      this.cacheProcessedEvent(cacheKey, ledgerSequence);
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
    const isSupported = isChainEventOutboxDelegate(this.prisma.chainEventOutbox);
    if (!isSupported) {
      appLogger.warn(
        "[EventListener] chainEventOutbox Prisma model is unavailable. Falling back to non-outbox atomic event processing."
      );
    }
    return isSupported;
  }

  private async ensureOutboxRecord(event: ParsedEvent): Promise<OutboxRecord> {
    const key = {
      ledgerSequence: event.ledgerSequence,
      contractId: event.contractId,
      eventId: event.eventId,
    };

    // Atomic upsert: concurrent poll cycles racing on the same event all get
    // back the single canonical record without a non-atomic check-then-create.
    const record = await this.prisma.chainEventOutbox.upsert({
      where: { ledgerSequence_contractId_eventId: key },
      create: {
        ledgerSequence: event.ledgerSequence,
        contractId: event.contractId,
        eventId: event.eventId,
        eventType: event.eventType,
        tradeId: event.tradeId,
        payload: event.data as Prisma.JsonObject,
        status: "PENDING",
      },
      update: {},
      select: {
        id: true,
        status: true,
        attempts: true,
        nextAttemptAt: true,
      },
    });
    return record as OutboxRecord;
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
        // Re-read status inside the transaction: if a concurrent worker already
        // committed PROCESSED, skip dispatch to prevent duplicate event handling.
        const current = await tx.chainEventOutbox.findUnique({
          where: { id: outboxId },
          select: { status: true },
        });
        if (current?.status === "PROCESSED") {
          return;
        }

        await dispatchEvent(tx, event);
        await tx.processedEvent.create({
          data: {
            ledgerSequence: event.ledgerSequence,
            contractId: event.contractId,
            eventId: event.eventId,
          },
        });
        await tx.chainEventOutbox.update({
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
      await this.prisma.chainEventOutbox.update({
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

    await this.prisma.chainEventOutbox.update({
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
      const eventSymbol = this.extractSymbolValue(topic[0]!);
      if (!eventSymbol) return null;

      const eventType = this.mapSymbolToEventType(eventSymbol);
      if (!eventType) {
        appLogger.warn({ eventSymbol }, "[EventListener] Unknown event symbol");
        return null;
      }

      const data: Record<string, unknown> = {};
      if (rawEvent.value) {
        data.raw = rawEvent.value;
        // Extract map entries into named fields for easy handler access
        const val = rawEvent.value as unknown as { type?: string; value?: Array<{ key: { value: string }; val: { value: unknown } }> };
        if (val?.type === "map" && Array.isArray(val.value)) {
          for (const entry of val.value) {
            if (entry?.key?.value) {
              data[entry.key.value] = entry.val?.value;
            }
          }
        }
      }

      // The contract emits a single topic element (the event symbol); the
      // trade_id lives in the event's data map, not in a second topic slot.
      const tradeId = data.trade_id != null ? String(data.trade_id) : "unknown";
      if (tradeId === "unknown") {
        appLogger.warn(
          { eventSymbol, eventId: rawEvent.id },
          "[EventListener] Event data missing trade_id",
        );
      }

      return {
        eventType,
        tradeId,
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

  /** Map Soroban event topic symbol to our EventType enum. */
  private mapSymbolToEventType(symbol: string): EventType | null {
    const eventType = EVENT_TOPIC_MAP[symbol];
    if (!eventType) {
      appLogger.warn({ symbol }, "[EventListener] Unknown event symbol, dropping event");
      return null;
    }
    return eventType;
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


  /** Add an event to the membership set and its ledger eviction bucket. */
  private cacheProcessedEvent(key: string, ledgerSequence: number): void {
    if (this.processedEvents.has(key)) return;

    this.processedEvents.add(key);
    const bucket = this.processedEventsByLedger.get(ledgerSequence);
    if (bucket) {
      bucket.add(key);
      return;
    }
    this.processedEventsByLedger.set(ledgerSequence, new Set([key]));
  }

  /**
   * Evict oldest events without materialising and sorting the full Set.
   * Soroban events arrive in ledger order, so Map insertion order is the
   * oldest-ledger queue. Work is proportional only to entries evicted.
   */
  private evictOldEvents(): void {
    let overflow =
      this.processedEvents.size - this.config.processedLedgersCacheSize;

    while (overflow > 0) {
      const oldest = this.processedEventsByLedger.entries().next().value as
        | [number, Set<string>]
        | undefined;
      if (!oldest) return;

      const [ledger, keys] = oldest;
      for (const key of keys) {
        if (overflow === 0) break;
        keys.delete(key);
        this.processedEvents.delete(key);
        overflow -= 1;
      }
      if (keys.size === 0) {
        this.processedEventsByLedger.delete(ledger);
      }
    }
  }
}
