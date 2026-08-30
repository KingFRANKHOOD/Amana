import { Response, Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";
import { dataRetentionService } from "../services/dataRetention.service";
import { dataArchivalService } from "../services/dataArchival.service";
import { storageMonitoringService } from "../services/storageMonitoring.service";
import { dataRetentionCleanupQueue } from "../jobs/queue";

const runArchivalBodySchema = z.object({
  thresholdDays: z.number().int().positive().optional(),
});

export function createAdminRetentionRouter(): Router {
  const router = Router();

  /**
   * GET /admin/retention/policy
   * Retrieve active data retention periods and policies.
   */
  router.get(
    "/admin/retention/policy",
    authMiddleware,
    adminMiddleware,
    async (_req: AuthRequest, res: Response) => {
      const config = dataRetentionService.getPolicyConfig();
      res.status(200).json({
        policies: config,
        lastExecution: dataRetentionService.getLastPruneResult(),
      });
    },
  );

  /**
   * POST /admin/retention/cleanup
   * Synchronously execute data retention cleanup or enqueue a job.
   */
  router.post(
    "/admin/retention/cleanup",
    authMiddleware,
    adminMiddleware,
    async (req: AuthRequest, res: Response, next) => {
      try {
        const caller = req.user?.walletAddress ?? "admin";
        const asyncFlag = req.query.async === "true";

        if (asyncFlag) {
          const job = await dataRetentionCleanupQueue.add("manual-cleanup", {
            triggeredBy: caller,
          });
          return res.status(202).json({
            jobId: job.id,
            status: "queued",
            message: "Data retention cleanup job enqueued",
          });
        }

        const result = await dataRetentionService.runAllRetentionJobs();
        return res.status(200).json({
          status: "completed",
          result,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * GET /admin/retention/archives
   * List all stored archival bundles.
   */
  router.get(
    "/admin/retention/archives",
    authMiddleware,
    adminMiddleware,
    async (_req: AuthRequest, res: Response) => {
      const archives = dataArchivalService.listArchives();
      res.status(200).json({
        total: archives.length,
        archives,
      });
    },
  );

  /**
   * POST /admin/retention/archives/run
   * Trigger cold trade archival.
   */
  router.post(
    "/admin/retention/archives/run",
    authMiddleware,
    adminMiddleware,
    validateRequest({ body: runArchivalBodySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const { thresholdDays } = (req.body ?? {}) as { thresholdDays?: number };
        const result = await dataArchivalService.archiveColdTrades(thresholdDays);
        if (!result) {
          return res.status(200).json({
            status: "no_records",
            message: "No cold records matched the archival threshold",
          });
        }

        return res.status(200).json({
          status: "archived",
          archive: result,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * GET /admin/retention/archives/:id/verify
   * Verify integrity of a specific archive bundle.
   */
  router.get(
    "/admin/retention/archives/:id/verify",
    authMiddleware,
    adminMiddleware,
    async (req: AuthRequest, res: Response) => {
      const archiveId = String(req.params.id ?? "");
      const verification = dataArchivalService.verifyArchive(archiveId);
      res.status(verification.isValid ? 200 : 400).json(verification);
    },
  );

  /**
   * GET /admin/retention/storage
   * Get storage growth snapshot and PostgreSQL table diagnostics.
   */
  router.get(
    "/admin/retention/storage",
    authMiddleware,
    adminMiddleware,
    async (_req: AuthRequest, res: Response, next) => {
      try {
        const snapshot = await storageMonitoringService.collectStorageMetrics();
        res.status(200).json(snapshot);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
