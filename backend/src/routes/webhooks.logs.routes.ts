import { PrismaClient } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";

const webhookLogsParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, "Webhook ID must be a numeric string"),
});

const webhookLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

function caller(req: AuthRequest, res: Response): string | null {
  const walletAddress = req.user?.walletAddress?.trim();
  if (!walletAddress) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return walletAddress;
}

export function createWebhookLogsRouter(prisma: PrismaClient = defaultPrisma) {
  const router = Router();

  router.get(
    "/webhooks/:id/logs",
    authMiddleware,
    validateRequest({ params: webhookLogsParamsSchema, query: webhookLogsQuerySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const walletAddress = caller(req, res);
        if (!walletAddress) return;

        const webhookId = Number(req.params.id);
        const { page, limit } = req.query as unknown as { page: number; limit: number };
        const skip = (page - 1) * limit;

        const webhook = await prisma.webhookSubscription.findUnique({
          where: { id: webhookId },
          select: { userAddress: true },
        });

        if (!webhook) {
          res.status(404).json({ error: "Webhook not found" });
          return;
        }

        if (webhook.userAddress !== walletAddress) {
          res.status(403).json({ error: "Forbidden: you do not own this webhook" });
          return;
        }

        const [attempts, total] = await Promise.all([
          prisma.webhookDeliveryAttempt.findMany({
            where: { webhookId },
            orderBy: { timestamp: "desc" },
            skip,
            take: limit,
            select: {
              timestamp: true,
              status: true,
              statusCode: true,
              responseBody: true,
            },
          }),
          prisma.webhookDeliveryAttempt.count({
            where: { webhookId },
          }),
        ]);

        res.status(200).json({
          attempts,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
