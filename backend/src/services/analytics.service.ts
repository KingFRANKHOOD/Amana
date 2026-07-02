import { appLogger } from "../middleware/logger";

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

export class AnalyticsService {
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

    // Optional Postgres persistence (best-effort, override persistEvent to enable)
    this.persistEvent(payload).catch((err: unknown) =>
      appLogger.warn({ err, event }, "analytics_event: db write failed"),
    );
  }

  /**
   * Override in production to persist to Postgres once an AnalyticsEvent
   * table exists in the schema. The default is a no-op so the service works
   * without a DB migration.
   */
  protected async persistEvent(_event: AnalyticsEvent): Promise<void> {
    // no-op by default
  }
}

export const analyticsService = new AnalyticsService();
