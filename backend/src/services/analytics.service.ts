import { appLogger } from "../middleware/logger";
import { prisma } from "../lib/prisma";

export type AnalyticsEventName =
  | "trade.created"
  | "trade.funded"
  | "trade.confirmed"
  | "trade.disputed"
  | "trade.resolved"
  | "trade.cancelled"
  | "user.registered"
  | "user.connected_wallet";

export interface AnalyticsEvent {
  event: AnalyticsEventName;
  timestamp: string;
  userId: string;
  tradeId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Storage backend for analytics events. Implementations must persist events
 * durably; the service never silently drops events in production.
 */
export interface AnalyticsEventStore {
  save(event: AnalyticsEvent): Promise<void>;
}

/**
 * Postgres-backed store using Prisma. This is the default production path so
 * analytics events are always written to a queryable table.
 */
export class PrismaAnalyticsEventStore implements AnalyticsEventStore {
  async save(event: AnalyticsEvent): Promise<void> {
    await prisma.analyticsEvent.create({
      data: {
        event: event.event,
        timestamp: new Date(event.timestamp),
        userId: event.userId,
        tradeId: event.tradeId ?? null,
        metadata: (event.metadata ?? {}) as object,
      },
    });
  }
}

export class AnalyticsService {
  constructor(private readonly store: AnalyticsEventStore = new PrismaAnalyticsEventStore()) {}

  /**
   * Fire-and-forget event tracking. Never throws — errors are logged only.
   */
  track(
    event: AnalyticsEventName,
    userId: string,
    tradeId?: string,
    metadata?: Record<string, unknown>,
  ): void {
    const payload: AnalyticsEvent = {
      event,
      timestamp: new Date().toISOString(),
      userId,
      ...(tradeId !== undefined && { tradeId }),
      ...(metadata !== undefined && { metadata }),
    };

    // Structured log — picked up by any log aggregator
    appLogger.info({ analytics: payload }, "analytics_event");

    // Persist to the configured store (Postgres by default).
    this.persistEvent(payload).catch((err: unknown) =>
      appLogger.warn({ err, event }, "analytics_event: db write failed"),
    );
  }

  /**
   * Persist an event via the configured store. The default store writes to
   * Postgres, so production events are never silently dropped.
   */
  protected async persistEvent(event: AnalyticsEvent): Promise<void> {
    await this.store.save(event);
  }
}

export const analyticsService = new AnalyticsService();
