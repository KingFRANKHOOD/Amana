import { Router, Response } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { FeeAccountingService } from "../services/feeAccounting.service";
import { AuthRequest } from "../services/auth.service";
import { appLogger } from "../middleware/logger";

const feesQuerySchema = z.object({
  format: z.enum(["csv", "json"]).default("json"),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
}).refine(
  (v) => !v.dateFrom || !v.dateTo || new Date(v.dateFrom) <= new Date(v.dateTo),
  { message: "dateFrom must be before or equal to dateTo", path: ["dateFrom"] },
);

const aggregateQuerySchema = z.object({
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

export function createFeeAccountingRouter(prisma: PrismaClient = defaultPrisma): Router {
  const router = Router();
  const feeService = new FeeAccountingService(prisma);

  /**
   * GET /fees
   * Admin-only. Lists all platform fee events with optional date filtering.
   * Supports ?format=csv for CSV download or ?format=json (default) for paginated JSON.
   */
  router.get(
    "/",
    authMiddleware,
    adminMiddleware,
    validateRequest({ query: feesQuerySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const query = req.query as unknown as z.infer<typeof feesQuerySchema>;
        const dateFrom = query.dateFrom ? new Date(query.dateFrom) : undefined;
        const dateTo = query.dateTo ? new Date(query.dateTo) : undefined;

        if (query.format === "csv") {
          const { csv, totalExported, truncated } = await feeService.exportCsv({ dateFrom, dateTo });
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader(
            "Content-Disposition",
            "attachment; filename=\"platform-fees-export.csv\"",
          );
          if (truncated) {
            res.setHeader("X-Export-Truncated", "true");
            res.setHeader("X-Export-Total", String(totalExported));
          }
          res.status(200).send(`\ufeff${csv}`);
          return;
        }

        const result = await feeService.listFees({
          dateFrom,
          dateTo,
          page: query.page,
          limit: query.limit,
        });

        res.status(200).json(result);
      } catch (error) {
        appLogger.error({ error }, "Failed to list fee events");
        next(error);
      }
    },
  );

  /**
   * GET /fees/summary
   * Admin-only. Returns aggregated totals (total fees, total trades) for a date range.
   */
  router.get(
    "/summary",
    authMiddleware,
    adminMiddleware,
    validateRequest({ query: aggregateQuerySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const query = req.query as unknown as z.infer<typeof aggregateQuerySchema>;
        const dateFrom = query.dateFrom ? new Date(query.dateFrom) : undefined;
        const dateTo = query.dateTo ? new Date(query.dateTo) : undefined;

        const summary = await feeService.aggregateFees({ dateFrom, dateTo });
        res.status(200).json(summary);
      } catch (error) {
        appLogger.error({ error }, "Failed to aggregate fee events");
        next(error);
      }
    },
  );

  return router;
}

export const feeAccountingRoutes = createFeeAccountingRouter();
