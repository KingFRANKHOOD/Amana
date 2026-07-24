import { Response, Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";
import { EvidenceVerificationService } from "../services/evidence.verification.service";
import { IPFSService } from "../services/ipfs.service";
import { evidenceVerificationQueue } from "../jobs/queue";
import { appLogger } from "../middleware/logger";

const verifySingleBodySchema = z.object({
  cid: z.string().min(1, "CID is required"),
});

const verifyRepairBodySchema = z.object({
  repairMissing: z.boolean().default(true),
});

export function createAdminEvidenceVerificationRouter() {
  const router = Router();

  // POST /admin/evidence/verify — synchronous verification pass
  router.post(
    "/admin/evidence/verify",
    authMiddleware,
    adminMiddleware,
    async (_req: AuthRequest, res: Response, next) => {
      try {
        const service = new EvidenceVerificationService();
        const report = await service.verifyAll();
        res.status(200).json({
          totalChecked: report.totalChecked,
          pinnedCount: report.pinnedCount,
          missingCount: report.missingCount,
          errorCount: report.errorCount,
          missingPins: report.missingPins.map((r) => ({
            evidenceId: r.evidenceId,
            tradeId: r.tradeId,
            cid: r.cid,
            filename: r.filename,
            error: r.pinResult.error,
          })),
          errors: report.errors.map((r) => ({
            evidenceId: r.evidenceId,
            tradeId: r.tradeId,
            cid: r.cid,
            error: r.pinResult.error,
          })),
          checkedAt: report.checkedAt.toISOString(),
          durationMs: report.durationMs,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  // POST /admin/evidence/verify/repair — verification + auto-repair missing pins
  router.post(
    "/admin/evidence/verify/repair",
    authMiddleware,
    adminMiddleware,
    validateRequest({ body: verifyRepairBodySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const service = new EvidenceVerificationService();
        const report = await service.verifyAll();

        let repairs: Awaited<
          ReturnType<EvidenceVerificationService["repairMissingPins"]>
        > | null = null;

        const { repairMissing } = req.body as { repairMissing: boolean };
        if (repairMissing && report.missingPins.length > 0) {
          repairs = await service.repairMissingPins(report.missingPins);
        }

        const repairedCount = repairs?.filter((r) => r.success).length ?? 0;
        const failedCount = repairs?.filter((r) => !r.success).length ?? 0;

        res.status(200).json({
          totalChecked: report.totalChecked,
          pinnedCount: report.pinnedCount,
          missingCount: report.missingCount,
          errorCount: report.errorCount,
          repairs: {
            attempted: report.missingPins.length,
            repaired: repairedCount,
            failed: failedCount,
            details: repairs?.map((r) => ({
              evidenceId: r.evidenceId,
              cid: r.cid,
              success: r.success,
              error: r.error,
            })),
          },
          checkedAt: report.checkedAt.toISOString(),
          durationMs: report.durationMs,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  // POST /admin/evidence/verify/single — verify a single CID
  router.post(
    "/admin/evidence/verify/single",
    authMiddleware,
    adminMiddleware,
    validateRequest({ body: verifySingleBodySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const { cid } = req.body as { cid: string };
        const ipfs = new IPFSService();
        const result = await ipfs.verifyPin(cid);
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  // POST /admin/evidence/verify/queue — enqueue an async verification job
  router.post(
    "/admin/evidence/verify/queue",
    authMiddleware,
    adminMiddleware,
    validateRequest({ body: verifyRepairBodySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const callerAddress = req.user?.walletAddress ?? "unknown";
        const { repairMissing } = req.body as { repairMissing: boolean };
        const job = await evidenceVerificationQueue.add("verify", {
          triggeredBy: callerAddress,
          repairMissing,
        });

        appLogger.info(
          { jobId: job.id, triggeredBy: callerAddress, repairMissing },
          "Evidence verification job queued",
        );

        res.status(202).json({
          jobId: job.id,
          status: "queued",
          repairMissing,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
