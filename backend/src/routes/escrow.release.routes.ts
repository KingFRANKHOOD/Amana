import { PrismaClient, TradeStatus } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { prisma as defaultPrisma } from "../lib/db";
import { getMediatorAllowlist } from "../lib/accessControl";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";
import { ContractService } from "../services/contract.service";
import { strictTradeIdSchema } from "../schemas/trade.schemas";

const releaseParamsSchema = z.object({
  id: strictTradeIdSchema,
});

const milestoneBodySchema = z.object({
  milestoneIndex: z.coerce.number().int().min(0),
});

type ReleasePrisma = PrismaClient & {
  escrowReleaseMilestone?: {
    findMany: (args: any) => Promise<Array<{
      milestoneIndex: number;
      dueAt: Date;
      releasedAt: Date | null;
    }>>;
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

function canRelease(trade: { buyerAddress: string }, walletAddress: string): boolean {
  const callerAddress = walletAddress.toLowerCase();
  return (
    trade.buyerAddress.toLowerCase() === callerAddress ||
    getMediatorAllowlist().has(callerAddress)
  );
}

function tradeWhere(id: string) {
  return { tradeId: id };
}

export function createEscrowReleaseRouter(
  prisma: ReleasePrisma = defaultPrisma as ReleasePrisma,
  contractService: Pick<ContractService, "buildReleaseMilestoneTx"> = new ContractService(),
) {
  const router = Router();

  router.post(
    "/:id/release/milestone",
    authMiddleware,
    validateRequest({ params: releaseParamsSchema, body: milestoneBodySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const walletAddress = caller(req, res);
        if (!walletAddress) return;

        const id = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
        const { milestoneIndex } = req.body as z.infer<typeof milestoneBodySchema>;
        const trade = await prisma.trade.findFirst({ where: tradeWhere(id) });

        if (!trade) {
          res.status(404).json({ error: "Trade not found" });
          return;
        }

        if (trade.status !== TradeStatus.FUNDED && trade.status !== TradeStatus.DELIVERED) {
          res.status(400).json({
            error: `Trade must be FUNDED or DELIVERED for milestone release (current: ${trade.status})`,
          });
          return;
        }

        if (!canRelease(trade, walletAddress)) {
          res.status(403).json({ error: "Only the buyer or an admin may release a milestone" });
          return;
        }

        if (!prisma.escrowReleaseMilestone) {
          res.status(404).json({ error: "Release schedule not found" });
          return;
        }

        const schedule = await prisma.escrowReleaseMilestone.findMany({
          where: { tradeId: trade.tradeId },
          orderBy: { milestoneIndex: "asc" },
        });

        if (schedule.length === 0) {
          res.status(404).json({ error: "Release schedule not found" });
          return;
        }

        if (schedule.every((milestone: { releasedAt: Date | null }) => milestone.releasedAt)) {
          res.status(409).json({ error: "Release schedule is already completed" });
          return;
        }

        const milestone = schedule.find(
          (item: { milestoneIndex: number }) => item.milestoneIndex === milestoneIndex,
        );
        if (!milestone) {
          res.status(400).json({ error: "Milestone index is outside the release schedule" });
          return;
        }

        if (milestone.releasedAt) {
          res.status(409).json({ error: "Milestone has already been released" });
          return;
        }

        if (milestone.dueAt.getTime() > Date.now()) {
          res.status(400).json({ error: "Milestone is not due yet" });
          return;
        }

        const { unsignedXdr } = await contractService.buildReleaseMilestoneTx({
          tradeId: trade.tradeId,
          sourceAddress: walletAddress,
          milestoneIndex,
        });

        res.status(200).json({ unsignedXdr });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export const escrowReleaseRoutes = createEscrowReleaseRouter();
