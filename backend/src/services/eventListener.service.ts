import { PrismaClient } from "@prisma/client";
import * as StellarSdk from "@stellar/stellar-sdk";
import { getEventListenerConfig, EventListenerConfig } from "../config/eventListener.config";
import { EventType, ParsedEvent } from "../types/events";
import { dispatchEvent } from "./eventHandlers";
import { appLogger } from "../middleware/logger";

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
  private processedLedgers: Set<number> = new Set();
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
    const recentLedgers = await this.prisma.processedLedger.findMany({
      orderBy: { ledgerSequence: "desc" },
      take: this.config.processedLedgersCacheSize,
    });
    for (const l of recentLedgers) {
      this.processedLedgers.add(l.ledgerSequence);
    }
    if (recentLedgers.length > 0) {
      this.lastLedger = recentLedgers[0].ledgerSequence;
    }

    appLogger.info(
      { pollIntervalMs: this.config.pollIntervalMs, contractId: this.config.contractId },
      "[EventListener] Started"
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
    const ledgerSequence = rawEvent.ledger;

    // Duplicate check — skip if already processed
    if (this.processedLedgers.has(ledgerSequence)) {
      return;
    }

    const parsed = this.parseEvent(rawEvent);
    if (!parsed) return;

    try {
      await dispatchEvent(this.prisma, parsed);

      // Record as processed — memory + DB
      this.processedLedgers.add(ledgerSequence);
      this.evictOldLedgers();

      await this.prisma.processedLedger.upsert({
        where: { ledgerSequence },
        update: {},
        create: { ledgerSequence },
      });

      if (ledgerSequence > this.lastLedger) {
        this.lastLedger = ledgerSequence;
      }

      appLogger.debug(
        { eventType: parsed.eventType, tradeId: parsed.tradeId, ledger: ledgerSequence },
        "[EventListener] Processed event"
      );
    } catch (error) {
      appLogger.error({ error, ledgerSequence }, "[EventListener] Failed to process event");
    }
  }

  /** Parse raw Soroban event into our internal format. */
  private parseEvent(rawEvent: StellarSdk.rpc.Api.EventResponse): ParsedEvent | null {
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
      const tradeId = topic.length > 1
        ? this.extractScalarValue(topic[1])
        : "unknown";

      const data: Record<string, unknown> = {};
      if (rawEvent.value) {
        data.raw = rawEvent.value;
      }

      return {
        eventType,
        tradeId: String(tradeId),
        ledgerSequence: rawEvent.ledger,
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
    const delay = Math.min(this.currentBackoffMs + jitter, this.config.backoffMaxMs);

    appLogger.warn({ delayMs: Math.round(delay) }, "[EventListener] Backing off");
    this.scheduleNextPoll(delay);

    this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, this.config.backoffMaxMs);
  }

  /** Reset backoff to initial value after a successful poll. */
  resetBackoff(): void {
    this.currentBackoffMs = this.config.backoffInitialMs;
  }

  /** Evict oldest ledgers from in-memory set when it exceeds the cache limit. */
  private evictOldLedgers(): void {
    if (this.processedLedgers.size <= this.config.processedLedgersCacheSize) return;

    const sorted = Array.from(this.processedLedgers).sort((a, b) => a - b);
    const toRemove = sorted.length - this.config.processedLedgersCacheSize;
    for (let i = 0; i < toRemove; i++) {
      this.processedLedgers.delete(sorted[i]);
    }
  }
}
