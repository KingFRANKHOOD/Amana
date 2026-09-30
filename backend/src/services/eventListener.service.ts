import { PrismaClient, Prisma } from "@prisma/client";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  getEventListenerConfig,
  EventListenerConfig,
} from "../config/eventListener.config";
import { EventType, ParsedEvent, EVENT_TOPIC_MAP } from "../types/events";
import { dispatchEvent, MissingTradeError } from "./eventHandlers";
import { appLogger } from "../middleware/logger";
import { CircuitBreaker, CircuitBreakerOpenError } from "../lib/circuitBreaker";

type OutboxStatus = "PENDING" | "RETRYING" | "PROCESSED" | "DEAD_LETTER";

type OutboxRecord = {
  id: number;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
  tradeId: string;
  ledgerSequence: number;
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
  key: { ledgerSequence: number; contractId: string; eventId: string },
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
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

/**
 * Returns true when the handler failed because the trade row does not exist
 * yet (MissingTradeError from eventHandlers). This signals an ordering gap —
 * the predecessor (usually TradeCreated) has not committed — not a poison
 * event, so callers must defer rather than count towards dead-letter.
 */
export function isMissingTradeError(err: unknown): boolean {
  try {
    if (typeof MissingTradeError === "function" && err instanceof MissingTradeError) return true;
  } catch {
    /* mocked module may not export the class — fall through to name check */
  }
  if (err instanceof Error && err.name === "MissingTradeError") return true;
  return false;
}

/**
 * Wraps the handler call and the `ProcessedEvent` marker insert in a single
 * Prisma transaction, guaranteeing atomicity (Requirement 2.1, 2.2, 2.3).
 *
 * The handler returns a post-commit thunk (e.g. webhook dispatch) which is
 * invoked **after** the transaction commits so that:
 *   - deliveries cannot race the commit
 *   - delivery failures never roll back committed state
 *   - no unhandled promise rejections escape the transaction boundary
 *
 * If a P2002 unique-constraint violation is raised (concurrent duplicate),
 * the error is swallowed and the event is treated as already-processed
 * (Requirement 1.3).
 */
export async function processEventAtomically(
  prisma: PrismaClient,
  event: ParsedEvent,
  handler: (
    tx: Prisma.TransactionClient,
    event: ParsedEvent,
  ) => Promise<() => void>,
): Promise<void> {
  let postCommit: (() => void) | undefined;
  try {
    postCommit = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const thunk = await handler(tx, event);
        await tx.processedEvent.create({
          data: {
            ledgerSequence: event.ledgerSequence,
            contractId: event.contractId,
            eventId: event.eventId,
          },
        });
        return thunk;
      },
    );
  } catch (err) {
    if (isPrismaUniqueConstraintError(err)) {
      appLogger.debug(
        { eventId: event.eventId },
        "[EventListener] Duplicate insert ignored",
      );
      return;
    }
    throw err;
  }
  // Fire post-commit work (e.g. webhook dispatch) only after the transaction
  // has successfully committed.
  postCommit?.();
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
        appLogger.warn(
          {},
          "[EventListener] Circuit breaker open — skipping poll",
        );
        this.scheduleNextPoll(this.stellarCircuit.cooldownMsValue);
      } else {
        appLogger.error({ error }, "[EventListener] Poll failed");
        this.handleBackoff();
      }
    }
  }

  /** Parse a single raw Soroban event and dispatch to the appropriate handler. */
  async processEvent(
    rawEvent: StellarSdk.rpc.Api.EventResponse,
  ): Promise<void> {
    const parsed = this.parseEvent(rawEvent);
    if (!parsed) return;

    const { ledgerSequence, contractId, eventId } = parsed;
    const cacheKey = `${ledgerSequence}:${contractId}:${eventId}`;

    // Fast path: in-memory cache
    if (this.processedEvents.has(cacheKey)) return;

    // Durable path: DB check (survives restarts)
    if (
      await isAlreadyProcessed(this.prisma, {
        ledgerSequence,
        contractId,
        eventId,
      })
    ) {
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
        appLogger.error(
          { error, eventId },
          "[EventListener] Failed to process event",
        );
        throw error;
      }
      return;
    }

    const outbox = await this.ensureOutboxRecord(parsed);
    if (!this.isOutboxReadyForAttempt(outbox)) {
      return;
    }

    // Per-trade ordering guard (issue #1404): if an earlier event for the same
    // trade is still PENDING/RETRYING/DEAD_LETTER, defer this event without
    // consuming a retry attempt. This prevents a later event (e.g. TradeFunded)
    // from being attempted — and potentially dead-lettered — before an earlier
    // event (e.g. TradeCreated) succeeds within the same poll batch.
    if (await this.hasBlockingPredecessor(outbox, parsed)) {
      await this.deferEventForPredecessor(outbox);
      appLogger.warn(
        { outboxId: outbox.id, tradeId: parsed.tradeId, eventType: parsed.eventType },
        "[EventListener] Deferring event until earlier event for same trade succeeds",
      );
      return;
    }

    try {
      await this.processOutboxEventAtomically(outbox.id, parsed);
      this.cacheProcessedEvent(cacheKey, ledgerSequence);
      this.evictOldEvents();
      if (ledgerSequence > this.lastLedger) {
        this.lastLedger = ledgerSequence;
      }
      // Re-drive any successors that dead-lettered while waiting for this
      // predecessor (e.g. TradeFunded that exhausted retries while TradeCreated
      // was still failing). Without this, the trade would stay stranded.
      await this.requeueDeadLetterSuccessors(parsed.tradeId);
      appLogger.debug(
        {
          eventType: parsed.eventType,
          tradeId: parsed.tradeId,
          ledger: ledgerSequence,
        },
        "[EventListener] Processed event",
      );
    } catch (error) {
      if (isMissingTradeError(error)) {
        // Dependency gap, not a poison event: back off without consuming a
        // dead-letter attempt so the event survives until TradeCreated lands.
        await this.recordDeferredFailure(outbox, error);
        appLogger.warn(
          { error, eventId, tradeId: parsed.tradeId },
          "[EventListener] Missing trade — deferring event until predecessor arrives",
        );
        return;
      }
      await this.recordOutboxFailure(outbox, error);
      appLogger.error(
        { error, eventId },
        "[EventListener] Failed to process event; scheduled for retry",
      );
    }
  }

  private supportsOutboxPersistence(): boolean {
    const isSupported = isChainEventOutboxDelegate(
      this.prisma.chainEventOutbox,
    );
    if (!isSupported) {
      appLogger.warn(
        "[EventListener] chainEventOutbox Prisma model is unavailable. Falling back to non-outbox atomic event processing.",
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
        tradeId: true,
        ledgerSequence: true,
      },
    });
    // Older test doubles may not return tradeId/ledgerSequence from the upsert
    // select — fall back to the in-memory event values so ordering guards work.
    return {
      ...(record as OutboxRecord),
      tradeId: (record as Partial<OutboxRecord>).tradeId ?? event.tradeId,
      ledgerSequence:
        (record as Partial<OutboxRecord>).ledgerSequence ?? event.ledgerSequence,
    };
  }

  private isOutboxReadyForAttempt(outbox: OutboxRecord): boolean {
    if (outbox.status === "PROCESSED") {
      return false;
    }
    if (outbox.status === "DEAD_LETTER") {
      appLogger.warn(
        { outboxId: outbox.id },
        "[EventListener] Skipping dead-letter event",
      );
      return false;
    }
    const now = Date.now();
    if (new Date(outbox.nextAttemptAt).getTime() > now) {
      return false;
    }
    return true;
  }

  /**
   * Returns true when another outbox record for the same tradeId must be
   * processed first (smaller ledger, or same ledger with smaller id) and is
   * still unprocessed (PENDING / RETRYING / DEAD_LETTER).
   *
   * This enforces per-trade FIFO across independent retries so a transient
   * TradeCreated failure cannot be overtaken by TradeFunded in the same batch.
   */
  private async hasBlockingPredecessor(
    outbox: OutboxRecord,
    event: ParsedEvent,
  ): Promise<boolean> {
    const delegate = this.prisma.chainEventOutbox as unknown as {
      findMany?: (args: unknown) => Promise<Array<{
        id: number;
        ledgerSequence: number;
        status: OutboxStatus;
      }>>;
    };
    if (typeof delegate.findMany !== "function") return false;
    try {
      const candidates = await delegate.findMany({
        where: {
          tradeId: event.tradeId,
          status: { in: ["PENDING", "RETRYING", "DEAD_LETTER"] },
          NOT: { id: outbox.id },
        },
        orderBy: [{ ledgerSequence: "asc" }, { id: "asc" }],
        take: 10,
      });
      return candidates.some(
        (row) =>
          row.ledgerSequence < event.ledgerSequence ||
          (row.ledgerSequence === event.ledgerSequence && row.id < outbox.id),
      );
    } catch {
      return false;
    }
  }

  /**
   * Postpone the current event without consuming a retry attempt — it is not
   * failing, it is simply waiting for its predecessor. Keeps status stable and
   * pushes nextAttemptAt into the future to avoid a hot poll loop.
   */
  private async deferEventForPredecessor(outbox: OutboxRecord): Promise<void> {
    try {
      const delayMs = this.computeRetryDelay(Math.max(outbox.attempts, 1));
      await this.prisma.chainEventOutbox.update({
        where: { id: outbox.id },
        data: {
          status: outbox.status === "PENDING" ? "PENDING" : "RETRYING",
          nextAttemptAt: new Date(Date.now() + delayMs),
        },
      });
    } catch {
      /* best-effort: next poll will retry anyway */
    }
  }

  /**
   * Record a MissingTradeError without moving towards DEAD_LETTER. The event
   * stays RETRYING with exponential backoff until its TradeCreated predecessor
   * commits, no matter how many ticks pass.
   */
  private async recordDeferredFailure(
    outbox: OutboxRecord,
    error: unknown,
  ): Promise<void> {
    const retryDelayMs = this.computeRetryDelay(outbox.attempts + 1);
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.chainEventOutbox.update({
      where: { id: outbox.id },
      data: {
        status: "RETRYING",
        // Do NOT increment attempts — dependency gaps must never exhaust
        // EVENT_OUTBOX_MAX_ATTEMPTS on their own.
        nextAttemptAt: new Date(Date.now() + retryDelayMs),
        lastError: message.slice(0, 2000),
        deadLetteredAt: null,
      },
    });
  }

  /**
   * After a predecessor commits, re-drive successors for the same trade that
   * previously dead-lettered with a missing-trade error. Without this, a trade
   * whose TradeFunded exhausted retries before TradeCreated succeeded would be
   * stranded at CREATED forever.
   */
  private async requeueDeadLetterSuccessors(tradeId: string): Promise<void> {
    const delegate = this.prisma.chainEventOutbox as unknown as {
      updateMany?: (args: unknown) => Promise<unknown>;
    };
    if (typeof delegate.updateMany !== "function") return;
    try {
      await delegate.updateMany({
        where: {
          tradeId,
          status: "DEAD_LETTER",
          lastError: { contains: "not found for event" },
        },
        data: {
          status: "PENDING",
          attempts: 0,
          nextAttemptAt: new Date(),
          lastError: null,
          deadLetteredAt: null,
        },
      });
    } catch {
      /* best-effort: admin can replay dead letters manually */
    }
  }

  private async processOutboxEventAtomically(
    outboxId: number,
    event: ParsedEvent,
  ): Promise<void> {
    let postCommit: (() => void) | undefined;
    try {
      postCommit = await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          // Re-read status inside the transaction: if a concurrent worker already
          // committed PROCESSED, skip dispatch to prevent duplicate event handling.
          const current = await tx.chainEventOutbox.findUnique({
            where: { id: outboxId },
            select: { status: true },
          });
          if (current?.status === "PROCESSED") {
            return undefined;
          }

          const thunk = await dispatchEvent(tx, event);
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
          return thunk;
        },
      );
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
    // Fire post-commit work (e.g. webhook dispatch) only after the transaction
    // has successfully committed.
    postCommit?.();
  }

  private computeRetryDelay(attemptNumber: number): number {
    const exponent = Math.max(attemptNumber - 1, 0);
    const baseDelay = this.config.backoffInitialMs * Math.pow(2, exponent);
    return Math.min(baseDelay, this.config.backoffMaxMs);
  }

  private async recordOutboxFailure(
    outbox: OutboxRecord,
    error: unknown,
  ): Promise<void> {
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
        const val = rawEvent.value as unknown as {
          type?: string;
          value?: Array<{ key: { value: string }; val: { value: unknown } }>;
        };
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
      appLogger.warn(
        { symbol },
        "[EventListener] Unknown event symbol, dropping event",
      );
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
        [number, Set<string>] | undefined;
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
