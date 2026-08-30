import { PrismaClient, TradeStatus, ChainEventSyncStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { appLogger } from "../middleware/logger";
import { runtimeEnvValue } from "../config/env";
import { auditLogService } from "./auditLog.service";

export interface DataRetentionPruneResult {
  refreshTokens: number;
  readNotifications: number;
  unreadNotifications: number;
  webhookDeliveryAttempts: number;
  processedEvents: number;
  chainEventOutboxProcessed: number;
  chainEventOutboxDeadLetter: number;
  indexedEvents: number;
  tradeNotes: number;
  manifestPiiRedacted: number;
  auditLogs: number;
  totalPruned: number;
  durationMs: number;
  executedAt: string;
}

export interface DataRetentionPolicyConfig {
  refreshTokenRetentionDays: number;
  notificationReadRetentionDays: number;
  notificationUnreadRetentionDays: number;
  webhookDeliveryRetentionDays: number;
  processedEventRetentionDays: number;
  indexedEventRetentionDays: number;
  tradeNoteRetentionDays: number;
  manifestPiiRetentionDays: number;
  auditLogRetentionDays: number;
  tradeArchivalThresholdDays: number;
}

export class DataRetentionService {
  private lastPruneResult: DataRetentionPruneResult | null = null;

  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  /**
   * Retrieves the effective retention configuration from environment settings.
   */
  getPolicyConfig(): DataRetentionPolicyConfig {
    return {
      refreshTokenRetentionDays: runtimeEnvValue("REFRESH_TOKEN_RETENTION_DAYS") ?? 7,
      notificationReadRetentionDays: runtimeEnvValue("NOTIFICATION_READ_RETENTION_DAYS") ?? 30,
      notificationUnreadRetentionDays: runtimeEnvValue("NOTIFICATION_UNREAD_RETENTION_DAYS") ?? 90,
      webhookDeliveryRetentionDays: runtimeEnvValue("WEBHOOK_DELIVERY_RETENTION_DAYS") ?? 14,
      processedEventRetentionDays: runtimeEnvValue("PROCESSED_EVENT_RETENTION_DAYS") ?? 30,
      indexedEventRetentionDays: runtimeEnvValue("INDEXED_EVENT_RETENTION_DAYS") ?? 90,
      tradeNoteRetentionDays: runtimeEnvValue("TRADE_NOTE_RETENTION_DAYS") ?? 90,
      manifestPiiRetentionDays: runtimeEnvValue("MANIFEST_PII_RETENTION_DAYS") ?? 30,
      auditLogRetentionDays: runtimeEnvValue("AUDIT_LOG_RETENTION_DAYS") ?? 365 * 7,
      tradeArchivalThresholdDays: runtimeEnvValue("TRADE_ARCHIVAL_THRESHOLD_DAYS") ?? 180,
    };
  }

  /**
   * Delete expired RefreshToken records (tokens past expiresAt + retention window).
   */
  async pruneExpiredRefreshTokens(retentionDays: number = this.getPolicyConfig().refreshTokenRetentionDays): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.db.refreshToken.deleteMany({
      where: {
        expiresAt: { lt: cutoff },
      },
    });
    appLogger.info({ count: result.count, cutoff }, "[DataRetention] Pruned expired refresh tokens");
    return result.count;
  }

  /**
   * Delete stale InAppNotification records:
   * - Read notifications past notificationReadRetentionDays
   * - Unread notifications past notificationUnreadRetentionDays
   */
  async pruneExpiredNotifications(
    readDays: number = this.getPolicyConfig().notificationReadRetentionDays,
    unreadDays: number = this.getPolicyConfig().notificationUnreadRetentionDays,
  ): Promise<{ read: number; unread: number }> {
    const readCutoff = new Date(Date.now() - readDays * 24 * 60 * 60 * 1000);
    const unreadCutoff = new Date(Date.now() - unreadDays * 24 * 60 * 60 * 1000);

    const [readResult, unreadResult] = await Promise.all([
      this.db.inAppNotification.deleteMany({
        where: {
          isRead: true,
          createdAt: { lt: readCutoff },
        },
      }),
      this.db.inAppNotification.deleteMany({
        where: {
          isRead: false,
          createdAt: { lt: unreadCutoff },
        },
      }),
    ]);

    appLogger.info(
      { readCount: readResult.count, unreadCount: unreadResult.count },
      "[DataRetention] Pruned notifications",
    );

    return { read: readResult.count, unread: unreadResult.count };
  }

  /**
   * Delete old WebhookDeliveryAttempt records.
   */
  async pruneExpiredWebhookDeliveryAttempts(
    retentionDays: number = this.getPolicyConfig().webhookDeliveryRetentionDays,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.db.webhookDeliveryAttempt.deleteMany({
      where: {
        timestamp: { lt: cutoff },
      },
    });
    appLogger.info({ count: result.count, cutoff }, "[DataRetention] Pruned webhook delivery attempts");
    return result.count;
  }

  /**
   * Delete old on-chain deduplication event logs (ProcessedEvent).
   */
  async pruneExpiredProcessedEvents(
    retentionDays: number = this.getPolicyConfig().processedEventRetentionDays,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.db.processedEvent.deleteMany({
      where: {
        processedAt: { lt: cutoff },
      },
    });
    appLogger.info({ count: result.count, cutoff }, "[DataRetention] Pruned processed events deduplication log");
    return result.count;
  }

  /**
   * Clean processed and dead-lettered event outbox entries:
   * - PROCESSED events older than retentionDays (default 14d)
   * - DEAD_LETTER events older than deadLetterRetentionDays (default 90d)
   */
  async pruneExpiredChainEventOutbox(
    processedRetentionDays: number = this.getPolicyConfig().webhookDeliveryRetentionDays,
    deadLetterRetentionDays: number = this.getPolicyConfig().indexedEventRetentionDays,
  ): Promise<{ processed: number; deadLetter: number }> {
    const processedCutoff = new Date(Date.now() - processedRetentionDays * 24 * 60 * 60 * 1000);
    const deadLetterCutoff = new Date(Date.now() - deadLetterRetentionDays * 24 * 60 * 60 * 1000);

    const [processedResult, deadLetterResult] = await Promise.all([
      this.db.chainEventOutbox.deleteMany({
        where: {
          status: ChainEventSyncStatus.PROCESSED,
          processedAt: { lt: processedCutoff },
        },
      }),
      this.db.chainEventOutbox.deleteMany({
        where: {
          status: ChainEventSyncStatus.DEAD_LETTER,
          deadLetteredAt: { lt: deadLetterCutoff },
        },
      }),
    ]);

    appLogger.info(
      { processedCount: processedResult.count, deadLetterCount: deadLetterResult.count },
      "[DataRetention] Pruned chain event outbox entries",
    );

    return { processed: processedResult.count, deadLetter: deadLetterResult.count };
  }

  /**
   * Delete old indexed events cache (IndexedEvent).
   */
  async pruneExpiredIndexedEvents(
    retentionDays: number = this.getPolicyConfig().indexedEventRetentionDays,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.db.indexedEvent.deleteMany({
      where: {
        ingestedAt: { lt: cutoff },
      },
    });
    appLogger.info({ count: result.count, cutoff }, "[DataRetention] Pruned indexed events cache");
    return result.count;
  }

  /**
   * Delete encrypted trade notes associated with completed or cancelled trades
   * older than the retention threshold.
   */
  async pruneExpiredTradeNotes(
    retentionDays: number = this.getPolicyConfig().tradeNoteRetentionDays,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.db.tradeNote.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        trade: {
          status: {
            in: [TradeStatus.COMPLETED, TradeStatus.CANCELLED],
          },
        },
      },
    });
    appLogger.info({ count: result.count, cutoff }, "[DataRetention] Pruned completed trade notes");
    return result.count;
  }

  /**
   * Permanently redact raw driver PII in DeliveryManifest for closed/aged trades
   * beyond the PII retention window (default 30 days).
   * Note: The on-chain SHA-256 hashes remain immutable on Stellar.
   */
  async redactExpiredManifestPII(
    retentionDays: number = this.getPolicyConfig().manifestPiiRetentionDays,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.db.deliveryManifest.updateMany({
      where: {
        createdAt: { lt: cutoff },
        NOT: {
          driverName: "[REDACTED]",
        },
      },
      data: {
        driverName: "[REDACTED]",
        driverIdNumber: "[REDACTED]",
        routeDescription: "[REDACTED_POST_RETENTION]",
      },
    });

    appLogger.info({ count: result.count, cutoff }, "[DataRetention] Redacted stale delivery manifest PII");
    return result.count;
  }

  /**
   * Prune financial audit logs past the statutory retention window (default 7 years).
   */
  async pruneExpiredAuditLogs(
    retentionDays: number = this.getPolicyConfig().auditLogRetentionDays,
  ): Promise<number> {
    return auditLogService.pruneExpired(retentionDays);
  }

  /**
   * Execute the full comprehensive data retention cycle across all models.
   */
  async runAllRetentionJobs(): Promise<DataRetentionPruneResult> {
    const startTime = Date.now();
    const config = this.getPolicyConfig();

    appLogger.info({ config }, "[DataRetention] Starting comprehensive data retention cleanup cycle");

    const [
      refreshTokens,
      notifications,
      webhookDeliveryAttempts,
      processedEvents,
      outboxEvents,
      indexedEvents,
      tradeNotes,
      manifestPiiRedacted,
      auditLogs,
    ] = await Promise.all([
      this.pruneExpiredRefreshTokens(config.refreshTokenRetentionDays).catch((err) => {
        appLogger.error({ err }, "[DataRetention] Error pruning refresh tokens");
        return 0;
      }),
      this.pruneExpiredNotifications(
        config.notificationReadRetentionDays,
        config.notificationUnreadRetentionDays,
      ).catch((err) => {
        appLogger.error({ err }, "[DataRetention] Error pruning notifications");
        return { read: 0, unread: 0 };
      }),
      this.pruneExpiredWebhookDeliveryAttempts(config.webhookDeliveryRetentionDays).catch((err) => {
        appLogger.error({ err }, "[DataRetention] Error pruning webhook deliveries");
        return 0;
      }),
      this.pruneExpiredProcessedEvents(config.processedEventRetentionDays).catch((err) => {
        appLogger.error({ err }, "[DataRetention] Error pruning processed events");
        return 0;
      }),
      this.pruneExpiredChainEventOutbox(
        config.webhookDeliveryRetentionDays,
        config.indexedEventRetentionDays,
      ).catch((err) => {
        appLogger.error({ err }, "[DataRetention] Error pruning event outbox");
        return { processed: 0, deadLetter: 0 };
      }),
      this.pruneExpiredIndexedEvents(config.indexedEventRetentionDays).catch((err) => {
        appLogger.error({ err }, "[DataRetention] Error pruning indexed events");
        return 0;
      }),
      this.pruneExpiredTradeNotes(config.tradeNoteRetentionDays).catch((err) => {
        appLogger.error({ err }, "[DataRetention] Error pruning trade notes");
        return 0;
      }),
      this.redactExpiredManifestPII(config.manifestPiiRetentionDays).catch((err) => {
        appLogger.error({ err }, "[DataRetention] Error redacting manifest PII");
        return 0;
      }),
      this.pruneExpiredAuditLogs(config.auditLogRetentionDays).catch((err) => {
        appLogger.error({ err }, "[DataRetention] Error pruning audit logs");
        return 0;
      }),
    ]);

    const totalPruned =
      refreshTokens +
      notifications.read +
      notifications.unread +
      webhookDeliveryAttempts +
      processedEvents +
      outboxEvents.processed +
      outboxEvents.deadLetter +
      indexedEvents +
      tradeNotes +
      manifestPiiRedacted +
      auditLogs;

    const durationMs = Date.now() - startTime;
    const executedAt = new Date().toISOString();

    const pruneResult: DataRetentionPruneResult = {
      refreshTokens,
      readNotifications: notifications.read,
      unreadNotifications: notifications.unread,
      webhookDeliveryAttempts,
      processedEvents,
      chainEventOutboxProcessed: outboxEvents.processed,
      chainEventOutboxDeadLetter: outboxEvents.deadLetter,
      indexedEvents,
      tradeNotes,
      manifestPiiRedacted,
      auditLogs,
      totalPruned,
      durationMs,
      executedAt,
    };

    this.lastPruneResult = pruneResult;
    appLogger.info(
      { pruneResult },
      "[DataRetention] Comprehensive data retention cleanup cycle complete",
    );

    return pruneResult;
  }

  /**
   * Get summary of the last executed retention cycle.
   */
  getLastPruneResult(): DataRetentionPruneResult | null {
    return this.lastPruneResult;
  }
}

export const dataRetentionService = new DataRetentionService();
