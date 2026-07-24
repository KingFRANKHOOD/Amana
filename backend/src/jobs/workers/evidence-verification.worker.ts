import { Worker, Job } from "bullmq";
import { appLogger } from "../../middleware/logger";
import { createQueueConnection, EvidenceVerificationJobData } from "../queue";
import {
  EvidenceVerificationService,
} from "../../services/evidence.verification.service";

export function createEvidenceVerificationWorker(): Worker<EvidenceVerificationJobData> {
  return new Worker<EvidenceVerificationJobData>(
    "evidence-verification",
    async (job: Job<EvidenceVerificationJobData>) => {
      const { triggeredBy, repairMissing } = job.data;
      appLogger.info(
        { jobId: job.id, triggeredBy, repairMissing },
        "Processing evidence verification job",
      );

      const verificationService = new EvidenceVerificationService();
      const report = await verificationService.verifyAll();

      let repairResults: Awaited<
        ReturnType<EvidenceVerificationService["repairMissingPins"]>
      > | null = null;

      if (repairMissing && report.missingPins.length > 0) {
        appLogger.info(
          { missingCount: report.missingPins.length, jobId: job.id },
          "Attempting repair of missing pins",
        );
        repairResults = await verificationService.repairMissingPins(
          report.missingPins,
        );

        const repaired = repairResults.filter((r) => r.success).length;
        const failed = repairResults.filter((r) => !r.success).length;
        appLogger.info(
          { repaired, failed, jobId: job.id },
          "Repair pass complete",
        );
      }

      appLogger.info(
        {
          jobId: job.id,
          totalChecked: report.totalChecked,
          pinned: report.pinnedCount,
          missing: report.missingCount,
          errors: report.errorCount,
        },
        "Evidence verification job completed",
      );

      return {
        report: {
          totalChecked: report.totalChecked,
          pinnedCount: report.pinnedCount,
          missingCount: report.missingCount,
          errorCount: report.errorCount,
          durationMs: report.durationMs,
        },
        repairs: repairResults,
      };
    },
    {
      connection: createQueueConnection(),
      concurrency: 1,
    },
  );
}
