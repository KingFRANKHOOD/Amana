import { Worker, Job, Queue } from "bullmq";
import { appLogger } from "../../middleware/logger";
import { createQueueConnection } from "../queue";
import { AuditLogService, getAuditLogRetentionDays } from "../../services/auditLog.service";

const QUEUE_NAME = "audit-log-retention";

export const auditLogRetentionQueue = new Queue(QUEUE_NAME, {
  connection: createQueueConnection(),
});

/** Schedule the daily audit-log retention cron if not already scheduled. */
export async function scheduleAuditLogRetention(): Promise<void> {
  const existing = await auditLogRetentionQueue.getRepeatableJobs();
  if (existing.some((j) => j.name === "daily-retention-prune")) return;

  await auditLogRetentionQueue.add(
    "daily-retention-prune",
    {},
    { repeat: { pattern: "0 4 * * *" } }, // 04:00 UTC daily
  );
  appLogger.info("Audit log retention cron scheduled");
}

export function createAuditLogRetentionWorker(): Worker {
  const auditLogService = new AuditLogService();

  return new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      const retentionDays = getAuditLogRetentionDays();
      appLogger.info({ retentionDays }, "Running audit log retention prune");
      const deleted = await auditLogService.pruneExpired(retentionDays);
      appLogger.info({ deleted }, "Audit log retention prune complete");
    },
    { connection: createQueueConnection() },
  );
}
