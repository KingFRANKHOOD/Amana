import { Router, Response } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { createWalletRateLimiter } from "../lib/rateLimit";
import { RATE_LIMIT_CONFIG } from "../config/rateLimit";
import { AuthRequest } from "../services/auth.service";
import { AuditLogService } from "../services/auditLog.service";
import { appLogger } from "../middleware/logger";

const auditLogQueryLimiter = createWalletRateLimiter(RATE_LIMIT_CONFIG.eventQuery);

const auditLogQuerySchema = z
  .object({
    tradeId: z.string().trim().min(1).max(255).optional(),
    eventType: z.string().trim().min(1).max(100).optional(),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .refine(
    (v) => !v.dateFrom || !v.dateTo || new Date(v.dateFrom) <= new Date(v.dateTo),
    { message: "dateFrom must be before or equal to dateTo", path: ["dateFrom"] },
  );

/**
 * Admin-only audit dashboard API: paginated, filterable read access over the
 * append-only AuditLog table backing financial-operation audit trails
 * (trade creation, fund movement, dispute resolution).
 */
export function createAuditLogRouter(prisma: PrismaClient = defaultPrisma): Router {
  const router = Router();
  const auditLogService = new AuditLogService(prisma);

  router.get(
    "/admin/audit-logs",
    authMiddleware,
    adminMiddleware,
    auditLogQueryLimiter,
    validateRequest({ query: auditLogQuerySchema }),
    async (req: AuthRequest, res: Response) => {
      try {
        const query = req.query as unknown as z.infer<typeof auditLogQuerySchema>;

        const result = await auditLogService.list({
          tradeId: query.tradeId,
          eventType: query.eventType,
          dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
          dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
          page: query.page,
          limit: query.limit,
        });

        res.status(200).json(result);
      } catch (error) {
        appLogger.error({ error }, "[AuditLogRouter] Failed to list audit logs");
        res.status(500).json({ error: "Failed to list audit logs" });
      }
    },
  );

  return router;
}

export const auditLogRoutes = createAuditLogRouter();
