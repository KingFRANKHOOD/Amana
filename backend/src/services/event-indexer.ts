import { PrismaClient, Prisma } from "@prisma/client";
import * as StellarSdk from "@stellar/stellar-sdk";
import { getEventListenerConfig, EventListenerConfig } from "../config/eventListener.config";
import { ParsedEvent, EVENT_TOPIC_MAP } from "../types/events";
import { appLogger } from "../middleware/logger";
import { EventEmitter } from "events";
import { recordDuplicateEventAttempt } from "../lib/metrics";

export const eventIndexerEmitter = new EventEmitter();
eventIndexerEmitter.setMaxListeners(100);

export interface IndexedEventRecord {
  id: number;
  eventId: string;
  tradeId: string | null;
  eventType: string;
  ledgerSequence: number;
  contractId: string;
  txHash: string | null;
  payload: Prisma.JsonValue;
  ingestedAt: Date;
}

export interface EventQuery {
  tradeId?: string;
  type?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

export interface TimelineEvent {
  eventType: string;
  ledgerSequence: number;
  txHash: string | null;
  payload: Prisma.JsonValue;
  ingestedAt: Date;
}

export class EventIndexerService {
  private prisma: PrismaClient;
  private config: EventListenerConfig;
  private server: StellarSdk.rpc.Server;
  private running: boolean = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private activePoll: Promise<void> | null = null;
  private lastIngestedLedger: number = 0;
  private backoffMs: number;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.config = getEventListenerConfig();
    this.server = new StellarSdk.rpc.Server(this.config.rpcUrl);
    this.backoffMs = this.config.backoffInitialMs;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const latest = await this.prisma.indexedEvent.findFirst({
      orderBy: { ledgerSequence: "desc" },
      select: { ledgerSequence: true },
    });
    if (latest) {
      this.lastIngestedLedger = latest.ledgerSequence;
    }

    appLogger.info(
      {
        pollIntervalMs: this.config.pollIntervalMs,
        contractId: this.config.contractId,
        lastLedger: this.lastIngestedLedger || "none (full backfill)",
      },
      "[EventIndexer] Started",
    );

    this.scheduleNextPoll(0);
  }

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
    appLogger.info("[EventIndexer] Stopped");
  }

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

  async pollEvents(): Promise<void> {
    if (!this.running) return;

    try {
      const startLedger = this.lastIngestedLedger > 0 ? this.lastIngestedLedger + 1 : 1;

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
          await this.ingestEvent(rawEvent);
        }
      }

      this.backoffMs = this.config.backoffInitialMs;
      this.scheduleNextPoll(this.config.pollIntervalMs);
    } catch (error) {
      const jitter = Math.random() * this.backoffMs * 0.1;
      const delay = Math.min(this.backoffMs + jitter, this.config.backoffMaxMs);
      appLogger.error({ error, delayMs: Math.round(delay) }, "[EventIndexer] Poll failed, backing off");
      this.backoffMs = Math.min(this.backoffMs * 2, this.config.backoffMaxMs);
      this.scheduleNextPoll(delay);
    }
  }

  async ingestEvent(rawEvent: StellarSdk.rpc.Api.EventResponse): Promise<void> {
    const parsed = this.parseEvent(rawEvent);
    if (!parsed) return;

    const txHash = rawEvent.txHash || null;

    let record: IndexedEventRecord;
    try {
      record = await this.prisma.indexedEvent.create({
        data: {
          eventId: parsed.eventId,
          tradeId: parsed.tradeId === "unknown" ? null : parsed.tradeId,
          eventType: parsed.eventType,
          ledgerSequence: parsed.ledgerSequence,
          contractId: parsed.contractId,
          txHash,
          payload: parsed.data as Prisma.JsonObject,
        },
      }) as IndexedEventRecord;
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        recordDuplicateEventAttempt("event-indexer", parsed.eventType);
        appLogger.debug(
          { eventId: parsed.eventId, eventType: parsed.eventType },
          "[EventIndexer] Duplicate event ignored",
        );
        return;
      }
      throw error;
    }

    if (parsed.ledgerSequence > this.lastIngestedLedger) {
      this.lastIngestedLedger = parsed.ledgerSequence;
    }

    appLogger.debug(
      { eventId: parsed.eventId, eventType: parsed.eventType, ledger: parsed.ledgerSequence },
      "[EventIndexer] Event ingested",
    );

    eventIndexerEmitter.emit("event", record);
  }

  async backfill(fromLedger?: number, toLedger?: number): Promise<{ ingested: number }> {
    const start = fromLedger ?? 1;
    const end = toLedger ?? 1_000_000_000;
    let ingested = 0;
    let cursor = start;

    while (cursor < end) {
      try {
        const response = await this.server.getEvents({
          startLedger: cursor,
          filters: [
            {
              type: "contract",
              contractIds: [this.config.contractId],
            },
          ],
          limit: 100,
        } as StellarSdk.rpc.Server.GetEventsRequest);

        if (!response.events || response.events.length === 0) break;

        for (const rawEvent of response.events) {
          const parsed = this.parseEvent(rawEvent);
          if (!parsed) continue;

          const inserted = await this.persistIndexedEvent(parsed, rawEvent.txHash || null);
          if (inserted) ingested += 1;
          cursor = Math.max(cursor, parsed.ledgerSequence);
        }

        cursor += 1;
      } catch (error) {
        appLogger.error({ error, cursor }, "[EventIndexer] Backfill error, stopping");
        break;
      }
    }

    appLogger.info({ ingested, from: start, to: cursor }, "[EventIndexer] Backfill complete");
    return { ingested };
  }

  async queryEvents(query: EventQuery): Promise<IndexedEventRecord[]> {
    const where: Record<string, unknown> = {};

    if (query.tradeId) {
      where.tradeId = query.tradeId;
    }
    if (query.type) {
      where.eventType = query.type;
    }
    if (query.from !== undefined || query.to !== undefined) {
      const ledgerFilter: Record<string, number> = {};
      if (query.from !== undefined) ledgerFilter.gte = query.from;
      if (query.to !== undefined) ledgerFilter.lte = query.to;
      where.ledgerSequence = ledgerFilter;
    }

    const limit = Math.min(query.limit ?? 100, 1000);
    const offset = query.offset ?? 0;

    const results = await (this.prisma as any).indexedEvent.findMany({
      where,
      orderBy: [{ ledgerSequence: "desc" }, { id: "desc" }],
      take: limit,
      skip: offset,
    });

    return results as IndexedEventRecord[];
  }

  async getTradeTimeline(tradeId: string): Promise<TimelineEvent[]> {
    const events = await (this.prisma as any).indexedEvent.findMany({
      where: { tradeId },
      orderBy: [{ ledgerSequence: "asc" }, { id: "asc" }],
    });

    return events.map((e: Record<string, unknown>) => ({
      eventType: e.eventType,
      ledgerSequence: e.ledgerSequence,
      txHash: e.txHash,
      payload: e.payload,
      ingestedAt: e.ingestedAt,
    }));
  }

  getLastIngestedLedger(): number {
    return this.lastIngestedLedger;
  }

  private async persistIndexedEvent(parsed: ParsedEvent, txHash: string | null): Promise<boolean> {
    try {
      await this.prisma.indexedEvent.create({
        data: {
          eventId: parsed.eventId,
          tradeId: parsed.tradeId === "unknown" ? null : parsed.tradeId,
          eventType: parsed.eventType,
          ledgerSequence: parsed.ledgerSequence,
          contractId: parsed.contractId,
          txHash,
          payload: parsed.data as Prisma.JsonObject,
        },
      });
      return true;
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        recordDuplicateEventAttempt("event-indexer", parsed.eventType);
        return false;
      }
      throw error;
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === "P2002"
    );
  }

  private parseEvent(rawEvent: StellarSdk.rpc.Api.EventResponse): ParsedEvent | null {
    try {
      const topic = rawEvent.topic;
      if (!topic || topic.length === 0) return null;

      const eventSymbol = this.extractSymbolValue(topic[0]!);
      if (!eventSymbol) return null;

      const topicKey = topic.length > 1
        ? `${eventSymbol}:${this.extractSymbolValue(topic[1]!)}`
        : eventSymbol;

      const eventType = EVENT_TOPIC_MAP[topicKey] ?? EVENT_TOPIC_MAP[eventSymbol];
      if (!eventType) {
        appLogger.warn({ topicKey, eventSymbol }, "[EventIndexer] Unknown event symbol");
        return null;
      }

      const data: Record<string, unknown> = {};
      if (rawEvent.value) {
        data.raw = rawEvent.value;
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
          "[EventIndexer] Event data missing trade_id",
        );
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
      appLogger.error({ error }, "[EventIndexer] Failed to parse event");
      return null;
    }
  }

  private extractSymbolValue(scVal: StellarSdk.xdr.ScVal): string | null {
    try {
      const nativeVal = StellarSdk.scValToNative(scVal);
      if (typeof nativeVal === "string") return nativeVal;
      return String(nativeVal);
    } catch {
      return null;
    }
  }
}
