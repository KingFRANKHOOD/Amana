import { PrismaClient, TradeStatus } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";
import { strictTradeIdSchema } from "../schemas/trade.schemas";

const scheduleParamsSchema = z.object({
  id: strictTradeIdSchema,
});

// Reject zero-equivalent values ("0", "00.0") and cap digit length to avoid
// precision/DoS via arbitrarily long digit strings. At least one non-zero
// digit is required, and the integer part is limited to 12 digits.
const amountUsdcSchema = z
  .string()
  .regex(/^(?=.*[1-9])\d{1,12}(\.\d{1,7})?$/, "Invalid USDC amount");

const milestoneSchema = z.object({
  milestoneIndex: z.coerce.number().int().min(0),
  amountUsdc: amountUsdcSchema,
  dueAt: z.string().datetime({ message: "Invalid ISO date for dueAt" }),
  conditionHash: z.string().max(64).optional(),
});

const createScheduleBodySchema = z
  .object({
    milestones: z.array(milestoneSchema).min(1).max(100),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<number>();
    value.milestones.forEach((milestone, index) => {
      if (seen.has(milestone.milestoneIndex)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["milestones", index, "milestoneIndex"],
          message: `Duplicate milestoneIndex: ${milestone.milestoneIndex}`,
        });
      }
      seen.add(milestone.milestoneIndex);
    });
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

function isParty(
  trade: { buyerAddress: string; sellerAddress: string; mediatorAddress?: string | null },
  walletAddress: string,
): boolean {
  if (isBuyerOrSeller(trade, walletAddress)) return true;
  const mediator = trade.mediatorAddress?.trim();
  return !!mediator && mediator.toLowerCase() === walletAddress.toLowerCase();
}

function tradeWhere(id: string) {
  return { tradeId: id };
}

// Compare USDC amounts as scaled integers to avoid floating point drift.
const USDC_DECIMALS = 7;
const USDC_SCALE = 10n ** BigInt(USDC_DECIMALS);

function toScaledAmount(amount: string): bigint {
  const [whole, fraction = ""] = amount.split(".");
  const paddedFraction = (fraction + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  return BigInt(whole) * USDC_SCALE + BigInt(paddedFraction || "0");
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

        const tradeAmount = (trade as { amountUsdc?: string | null }).amountUsdc;
        if (tradeAmount) {
          const milestoneTotal = milestones.reduce(
            (sum, m) => sum + toScaledAmount(m.amountUsdc),
            0n,
          );
          if (milestoneTotal !== toScaledAmount(tradeAmount)) {
            res.status(400).json({
              error: "Milestone amounts must sum to the trade amount",
            });
            return;
          }
        }

        const created = await prisma.$transaction(async (tx) => {
          const txMilestone = (tx as SchedulePrisma).escrowReleaseMilestone;
          if (!txMilestone) {
            throw new Error("Release schedule store unavailable");
          }

          await txMilestone.deleteMany({
            where: { tradeId: trade.tradeId },
          });

          const records: any[] = [];
          for (let i = 0; i < milestones.length; i++) {
            const m = milestones[i]!;
            const record = await txMilestone.create({
              data: {
                tradeId: trade.tradeId,
                milestoneIndex: m.milestoneIndex,
                amountUsdc: m.amountUsdc,
                dueAt: new Date(m.dueAt),
                conditionHash: m.conditionHash ?? null,
              },
            });
            records.push(record);
          }
          return records;
        });

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

        if (!isParty(trade, walletAddress)) {
          res.status(403).json({ error: "Only the buyer, seller, or mediator may view the release schedule" });
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
