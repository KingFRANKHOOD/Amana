import { PrismaClient, TradeStatus } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";

const scheduleParamsSchema = z.object({
  id: z.string().min(1),
});

const milestoneSchema = z.object({
  milestoneIndex: z.coerce.number().int().min(0),
  amountUsdc: z.string().regex(/^\d+(\.\d{1,7})?$/, "Invalid USDC amount"),
  dueAt: z.string().datetime({ message: "Invalid ISO date for dueAt" }),
  conditionHash: z.string().max(64).optional(),
});

const createScheduleBodySchema = z.object({
  milestones: z.array(milestoneSchema).min(1).max(100),
});

type SchedulePrisma = PrismaClient & {
  escrowReleaseMilestone?: {
    create: (args: any) => Promise<any>;
    createMany: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<Array<{
      milestoneIndex: number;
      amountUsdc: string;
      dueAt: Date;
      conditionHash: string | null;
      releasedAt: Date | null;
    }>>;
    deleteMany: (args: any) => Promise<any>;
    count: (args: any) => Promise<number>;
  };
};

function caller(req: AuthRequest, res: Response): string | null {
  const walletAddress = req.user?.walletAddress?.trim();
  if (!walletAddress) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return walletAddress;
}

function isBuyerOrSeller(trade: { buyerAddress: string; sellerAddress: string }, walletAddress: string): boolean {
  return (
    trade.buyerAddress.toLowerCase() === walletAddress.toLowerCase() ||
    trade.sellerAddress.toLowerCase() === walletAddress.toLowerCase()
  );
}

function tradeWhere(id: string) {
  const numericId = Number(id);
  const orConditions: Array<Record<string, unknown>> = [{ tradeId: id }];
  if (Number.isInteger(numericId) && numericId > 0) {
    orConditions.push({ id: numericId });
  }
  return { OR: orConditions };
}

export function createEscrowScheduleRouter(
  prisma: SchedulePrisma = defaultPrisma as SchedulePrisma,
) {
  const router = Router();

  router.post(
    "/:id/schedule",
    authMiddleware,
    validateRequest({ params: scheduleParamsSchema, body: createScheduleBodySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const walletAddress = caller(req, res);
        if (!walletAddress) return;

        const id = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
        const { milestones } = req.body as z.infer<typeof createScheduleBodySchema>;

        const trade = await prisma.trade.findFirst({ where: tradeWhere(id) });

        if (!trade) {
          res.status(404).json({ error: "Trade not found" });
          return;
        }

        if (trade.status !== TradeStatus.CREATED && trade.status !== TradeStatus.FUNDED) {
          res.status(400).json({
            error: `Trade must be CREATED or FUNDED to set a release schedule (current: ${trade.status})`,
          });
          return;
        }

        if (!isBuyerOrSeller(trade, walletAddress)) {
          res.status(403).json({ error: "Only the buyer or seller may set the release schedule" });
          return;
        }

        if (!prisma.escrowReleaseMilestone) {
          res.status(500).json({ error: "Release schedule store unavailable" });
          return;
        }

        await prisma.escrowReleaseMilestone.deleteMany({
          where: { tradeId: trade.tradeId },
        });

        const created: any[] = [];
        for (let i = 0; i < milestones.length; i++) {
          const m = milestones[i]!;
          const record = await prisma.escrowReleaseMilestone.create({
            data: {
              tradeId: trade.tradeId,
              milestoneIndex: m.milestoneIndex,
              amountUsdc: m.amountUsdc,
              dueAt: new Date(m.dueAt),
              conditionHash: m.conditionHash ?? null,
            },
          });
          created.push(record);
        }

        const now = new Date();
        const nextMilestone = created.find((m) => m.dueAt > now);

        res.status(201).json({
          tradeId: trade.tradeId,
          milestoneCount: created.length,
          nextReleaseDate: nextMilestone ? nextMilestone.dueAt.toISOString() : null,
          milestones: created.map((m) => ({
            milestoneIndex: m.milestoneIndex,
            amountUsdc: m.amountUsdc,
            dueAt: m.dueAt.toISOString(),
            conditionHash: m.conditionHash ?? null,
            released: m.releasedAt !== null,
          })),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/:id/schedule",
    authMiddleware,
    validateRequest({ params: scheduleParamsSchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const walletAddress = caller(req, res);
        if (!walletAddress) return;

        const id = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);

        const trade = await prisma.trade.findFirst({ where: tradeWhere(id) });

        if (!trade) {
          res.status(404).json({ error: "Trade not found" });
          return;
        }

        if (!prisma.escrowReleaseMilestone) {
          res.status(500).json({ error: "Release schedule store unavailable" });
          return;
        }

        const milestones = await prisma.escrowReleaseMilestone.findMany({
          where: { tradeId: trade.tradeId },
          orderBy: { milestoneIndex: "asc" },
        });

        const now = new Date();
        const nextMilestone = milestones.find((m) => m.dueAt > now && !m.releasedAt);

        res.json({
          tradeId: trade.tradeId,
          milestoneCount: milestones.length,
          nextReleaseDate: nextMilestone ? nextMilestone.dueAt.toISOString() : null,
          milestones: milestones.map((m) => ({
            milestoneIndex: m.milestoneIndex,
            amountUsdc: m.amountUsdc,
            dueAt: m.dueAt.toISOString(),
            conditionHash: m.conditionHash ?? null,
            released: m.releasedAt !== null,
          })),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export const escrowScheduleRoutes = createEscrowScheduleRouter();
