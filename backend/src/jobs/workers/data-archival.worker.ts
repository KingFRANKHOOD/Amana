import { Worker, Job } from "bullmq";
import { appLogger } from "../../middleware/logger";
import { createQueueConnection, dataArchivalQueue } from "../queue";
import { DataArchivalService, dataArchivalService as defaultService } from "../../services/dataArchival.service";
import MetricsService from "../../services/metrics.service";
import { MeterProvider } from "@opentelemetry/sdk-metrics";

const QUEUE_NAME = "data-archival";

/**
 * Schedule weekly automated archival cron if not already scheduled.
 * Runs weekly on Sunday at 03:30 UTC.
 */
export async function scheduleDataArchival(): Promise<void> {
  const existing = await dataArchivalQueue.getRepeatableJobs();
  if (existing.some((j) => j.name === "weekly-cold-data-archival")) return;

  await dataArchivalQueue.add(
    "weekly-cold-data-archival",
    { triggeredBy: "cron" },
    { repeat: { pattern: "30 3 * * 0" } }, // 03:30 UTC every Sunday
  );
  appLogger.info("Weekly data archival cron scheduled (03:30 UTC Sundays)");
}

export function createDataArchivalWorker(
  service: DataArchivalService = defaultService,
  metricsService?: MetricsService,
): Worker {
  const metrics = metricsService ?? MetricsService.getInstance(new MeterProvider());

  return new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      appLogger.info({ jobId: job.id, data: job.data }, "Running automated data archival worker");
      const thresholdDays = job.data?.thresholdDays;
      const result = await service.archiveColdTrades(thresholdDays);

      if (result) {
        metrics.recordArchivalMetrics(result.entityType, result.recordCount);
        appLogger.info(
          {
            jobId: job.id,
            archiveId: result.archiveId,
            records: result.recordCount,
            durationMs: result.durationMs,
          },
          "Data archival job finished successfully",
        );
      } else {
        appLogger.info({ jobId: job.id }, "Data archival completed with 0 cold records to archive");
      }

      return result;
    },
    { connection: createQueueConnection() },
  );
}
