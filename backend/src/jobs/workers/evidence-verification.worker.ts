import { Worker, Job } from "bullmq";
import { createQueueConnection, EvidenceVerificationJobData } from "../queue";
import {
  EvidenceVerificationService,
} from "../../services/evidence.verification.service";
import { getJobContextualLogger } from "../../lib/logging";

export function createEvidenceVerificationWorker(): Worker<EvidenceVerificationJobData> {
  return new Worker<EvidenceVerificationJobData>(
    "evidence-verification",
    async (job: Job<EvidenceVerificationJobData>) => {
      const { triggeredBy, repairMissing } = job.data;
      const logger = getJobContextualLogger(job.id, undefined, { triggeredBy, repairMissing });

      logger.info("Processing evidence verification job");

      const verificationService = new EvidenceVerificationService();
      const report = await verificationService.verifyAll(async (progress) => {
        await job.updateProgress({
          ...progress,
          percentage:
            progress.total === 0
              ? 100
              : Math.min(
                  100,
                  Math.round((progress.processed / progress.total) * 100),
                ),
        });
      });

      let repairResults: Awaited<
        ReturnType<EvidenceVerificationService["repairMissingPins"]>
      > | null = null;

      if (repairMissing && report.missingPins.length > 0) {
        logger.info({ missingCount: report.missingPins.length }, "Attempting repair of missing pins");
        repairResults = await verificationService.repairMissingPins(
          report.missingPins,
        );

        const repaired = repairResults.filter((r) => r.success).length;
        const failed = repairResults.filter((r) => !r.success).length;
        logger.info({ repaired, failed }, "Repair pass complete");
      }

      logger.info(
        {
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
