import { Worker, Job } from "bullmq";
import { appLogger } from "../../middleware/logger";
import { createQueueConnection, dataRetentionCleanupQueue } from "../queue";
import { DataRetentionService, dataRetentionService as defaultService } from "../../services/dataRetention.service";
import MetricsService from "../../services/metrics.service";
import { MeterProvider } from "@opentelemetry/sdk-metrics";

const QUEUE_NAME = "data-retention-cleanup";

/**
 * Schedule the daily data retention cleanup cron if not already scheduled.
 * Runs daily at 02:00 UTC.
 */
export async function scheduleDataRetentionCleanup(): Promise<void> {
  const existing = await dataRetentionCleanupQueue.getRepeatableJobs();
  if (existing.some((j) => j.name === "daily-retention-cleanup")) return;

  await dataRetentionCleanupQueue.add(
    "daily-retention-cleanup",
    { triggeredBy: "cron" },
    { repeat: { pattern: "0 2 * * *" } }, // 02:00 UTC daily
  );
  appLogger.info("Data retention cleanup cron scheduled (02:00 UTC daily)");
}

export function createDataRetentionCleanupWorker(
  service: DataRetentionService = defaultService,
  metricsService?: MetricsService,
): Worker {
  const metrics = metricsService ?? MetricsService.getInstance(new MeterProvider());

  return new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      appLogger.info({ jobId: job.id, data: job.data }, "Running automated data retention cleanup job");
      const result = await service.runAllRetentionJobs();

      // Record pruned record metrics
      metrics.recordRetentionPruned("refresh_tokens", result.refreshTokens);
      metrics.recordRetentionPruned("read_notifications", result.readNotifications);
      metrics.recordRetentionPruned("unread_notifications", result.unreadNotifications);
      metrics.recordRetentionPruned("webhook_deliveries", result.webhookDeliveryAttempts);
      metrics.recordRetentionPruned("processed_events", result.processedEvents);
      metrics.recordRetentionPruned("outbox_processed", result.chainEventOutboxProcessed);
      metrics.recordRetentionPruned("outbox_deadletter", result.chainEventOutboxDeadLetter);
      metrics.recordRetentionPruned("indexed_events", result.indexedEvents);
      metrics.recordRetentionPruned("trade_notes", result.tradeNotes);
      metrics.recordRetentionPruned("manifest_pii_redacted", result.manifestPiiRedacted);
      metrics.recordRetentionPruned("audit_logs", result.auditLogs);

      appLogger.info(
        { jobId: job.id, totalPruned: result.totalPruned, durationMs: result.durationMs },
        "Automated data retention cleanup job completed successfully",
      );

      return result;
    },
    { connection: createQueueConnection() },
  );
}
