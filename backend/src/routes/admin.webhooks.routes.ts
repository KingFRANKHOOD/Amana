import { Response, Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";
import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { appLogger } from "../middleware/logger";

const webhookAdminQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  webhookUrl: z.string().optional(),
  tradeId: z.string().optional(),
});

export function createAdminWebhooksRouter(prisma: PrismaClient = defaultPrisma) {
  const router = Router();

  router.get(
    "/admin/webhooks/status",
    authMiddleware,
    adminMiddleware,
    async (_req: AuthRequest, res: Response) => {
      try {
        const [
          totalSubscriptions,
          activeSubscriptions,
          deadLetterCount,
          recentDeadLetters,
        ] = await Promise.all([
          prisma.webhookSubscription.count(),
          prisma.webhookSubscription.count({ where: { isActive: true } }),
          prisma.webhookDeadLetter.count(),
          prisma.webhookDeadLetter.findMany({
            orderBy: { deadLetteredAt: "desc" },
            take: 10,
            select: {
              id: true,
              webhookUrl: true,
              event: true,
              tradeId: true,
              attempts: true,
              lastError: true,
              deadLetteredAt: true,
            },
          }),
        ]);

        res.status(200).json({
          subscriptions: {
            total: totalSubscriptions,
            active: activeSubscriptions,
          },
          deadLetter: {
            total: deadLetterCount,
            recent: recentDeadLetters,
          },
        });
      } catch (error) {
        appLogger.error({ error }, "Failed to load admin webhook status");
        res.status(500).json({ error: "Failed to load webhook status" });
      }
    },
  );

  router.get(
    "/admin/webhooks/dead-letters",
    authMiddleware,
    adminMiddleware,
    validateRequest({ query: webhookAdminQuerySchema }),
    async (req: AuthRequest, res: Response) => {
      try {
        const { page, limit, webhookUrl, tradeId } = req.query as unknown as {
          page: number;
          limit: number;
          webhookUrl?: string;
          tradeId?: string;
        };
        const skip = (page - 1) * limit;

        const where: Record<string, unknown> = {};
        if (webhookUrl) {
          where.webhookUrl = { contains: webhookUrl };
        }
        if (tradeId) {
          where.tradeId = tradeId;
        }

        const [deadLetters, total] = await Promise.all([
          prisma.webhookDeadLetter.findMany({
            where,
            orderBy: { deadLetteredAt: "desc" },
            skip,
            take: limit,
            select: {
              id: true,
              webhookUrl: true,
              subscriptionId: true,
              event: true,
              tradeId: true,
              attempts: true,
              lastError: true,
              deadLetteredAt: true,
              payload: true,
            },
          }),
          prisma.webhookDeadLetter.count({ where }),
        ]);

        res.status(200).json({
          deadLetters,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error) {
        appLogger.error({ error }, "Failed to load dead-letter webhooks");
        res.status(500).json({ error: "Failed to load dead-letter webhooks" });
      }
    },
  );

  return router;
}
