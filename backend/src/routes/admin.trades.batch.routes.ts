import { PrismaClient, TradeStatus } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";

const tradeStatusUpdateSchema = z.object({
  tradeId: z.string().min(1, "tradeId is required"),
  status: z.nativeEnum(TradeStatus),
});

const batchStatusBodySchema = z.object({
  updates: z.array(tradeStatusUpdateSchema).min(1, "At least one update is required").max(100, "Maximum 100 updates per request"),
});

const VALID_TRANSITIONS: Record<TradeStatus, TradeStatus[]> = {
  [TradeStatus.PENDING_SIGNATURE]: [TradeStatus.CREATED, TradeStatus.CANCELLED],
  [TradeStatus.CREATED]: [TradeStatus.FUNDED, TradeStatus.CANCELLED],
  [TradeStatus.FUNDED]: [TradeStatus.DELIVERED, TradeStatus.DISPUTED, TradeStatus.CANCELLED],
  [TradeStatus.DELIVERED]: [TradeStatus.COMPLETED, TradeStatus.DISPUTED, TradeStatus.CANCELLED],
  [TradeStatus.DISPUTED]: [TradeStatus.COMPLETED, TradeStatus.CANCELLED],
  [TradeStatus.COMPLETED]: [],
  [TradeStatus.CANCELLED]: [],
};

function isValidTransition(from: TradeStatus, to: TradeStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function createAdminTradeBatchRouter(prisma: PrismaClient = defaultPrisma) {
  const router = Router();

  router.post(
    "/admin/trades/batch/status",
    authMiddleware,
    adminMiddleware,
    validateRequest({ body: batchStatusBodySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const { updates } = req.body as { updates: { tradeId: string; status: TradeStatus }[] };

        const succeeded: string[] = [];
        const failed: { tradeId: string; reason: string }[] = [];

        for (const { tradeId, status: targetStatus } of updates) {
          const trade = await prisma.trade.findFirst({
            where: {
              OR: [
                { tradeId },
                { id: Number.isInteger(Number(tradeId)) ? Number(tradeId) : -1 },
              ],
            },
            select: { tradeId: true, status: true, version: true },
          });

          if (!trade) {
            failed.push({ tradeId, reason: "Trade not found" });
            continue;
          }

          if (!isValidTransition(trade.status, targetStatus)) {
            failed.push({
              tradeId,
              reason: `Invalid transition from ${trade.status} to ${targetStatus}`,
            });
            continue;
          }

          const result = await prisma.trade.updateMany({
            where: { tradeId: trade.tradeId, version: trade.version },
            data: { status: targetStatus, version: { increment: 1 } },
          });

          if (result.count === 0) {
            failed.push({ tradeId, reason: "Concurrency conflict: trade was modified" });
          } else {
            succeeded.push(trade.tradeId);
          }
        }

        res.status(200).json({ succeeded, failed });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
