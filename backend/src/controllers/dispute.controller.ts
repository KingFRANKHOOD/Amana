import { NextFunction, Response } from "express";
import { DisputeService, DisputeStatus } from "../services/dispute.service";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { Router } from "express";
import { z } from "zod";
import { AppError } from '../errors/appError';
import { isMediatorAddress } from "../lib/accessControl";
import { Parser } from "json2csv";

const listDisputesQuerySchema = z.object({
  status: z.enum(["OPEN", "UNDER_REVIEW", "RESOLVED", "CLOSED"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const transitionDisputeSchema = z.object({
  status: z.enum(["UNDER_REVIEW", "RESOLVED", "CLOSED"]),
});

const disputeIdParamSchema = z.object({
  id: z
    .string()
    .min(1, "Dispute/trade ID is required")
    .max(255, "Dispute/trade ID is too long")
    .regex(
      /^[A-Za-z0-9_-]+$/,
      "Dispute/trade ID contains invalid characters",
    ),
});

export { disputeIdParamSchema };

const exportDisputesQuerySchema = z.object({
  format: z.enum(["csv"]).default("csv"),
  status: z.enum(["OPEN", "UNDER_REVIEW", "RESOLVED", "CLOSED"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
}).refine(
  (value) => !value.from || !value.to || new Date(value.from) <= new Date(value.to),
  { message: "from must be before or equal to to", path: ["from"] },
);

const disputeCsvFields = [
  "dispute_id",
  "trade_id",
  "initiator",
  "status",
  "reason",
  "buyer",
  "seller",
  "amount",
  "created_at",
  "resolved_at",
];

export class DisputeController {
  constructor(private disputeService: DisputeService) {}

  public listMediatorDisputes = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    const callerAddress = req.user?.walletAddress?.trim();
    if (!callerAddress) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { status, page, limit } = req.query as any;

    try {
      const result = await this.disputeService.listMediatorDisputes(
        callerAddress,
        {
          status,
          page,
          limit,
        },
      );

      res.status(200).json(result);
    } catch (error) {
      if (error instanceof AppError) {
        return next(error);
      }
      return next(error);
    }
  };

  public transitionDisputeStatus = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    const callerAddress = req.user?.walletAddress?.trim();
    if (!callerAddress) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const tradeId = req.params.id as string;
    const { status } = req.body as { status: DisputeStatus };

    try {
      const result = await this.disputeService.transitionDisputeStatus(
        tradeId,
        callerAddress,
        status,
      );

      res.status(200).json(result);
    } catch (error) {
      if (error instanceof AppError) {
        return next(error);
      }
      return next(error);
    }
  };
}

export function createDisputeRouter(prisma = defaultPrisma) {
  const router = Router();
  const disputeService = new DisputeService(prisma);
  const disputeController = new DisputeController(disputeService);

  router.get(
    "/export",
    authMiddleware,
    validateRequest({ query: exportDisputesQuerySchema }),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      const callerAddress = req.user?.walletAddress?.trim();
      if (!callerAddress) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!isMediatorAddress(callerAddress)) {
        return res.status(403).json({ error: "Unauthorized: Not a mediator" });
      }

      const query = req.query as unknown as z.infer<typeof exportDisputesQuerySchema>;
      try {
        const disputes = await prisma.dispute.findMany({
          where: {
            ...(query.status ? { status: query.status } : {}),
            ...(query.from || query.to
              ? {
                  createdAt: {
                    ...(query.from ? { gte: new Date(query.from) } : {}),
                    ...(query.to ? { lte: new Date(query.to) } : {}),
                  },
                }
              : {}),
          },
          include: {
            trade: {
              select: {
                buyerAddress: true,
                sellerAddress: true,
                amountUsdc: true,
              },
            },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });

        const rows = disputes.map((dispute) => ({
          dispute_id: dispute.id,
          trade_id: dispute.tradeId,
          initiator: dispute.initiator,
          status: dispute.status,
          reason: dispute.reason,
          buyer: dispute.trade.buyerAddress,
          seller: dispute.trade.sellerAddress,
          amount: dispute.trade.amountUsdc,
          created_at: dispute.createdAt,
          resolved_at: dispute.resolvedAt,
        }));

        const parser = new Parser({ fields: disputeCsvFields });
        const csv = parser.parse(rows);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="disputes-${new Date().toISOString().slice(0, 10)}.csv"`);
        return res.status(200).send(`\ufeff${csv}`);
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    "/",
    authMiddleware,
    validateRequest({ query: listDisputesQuerySchema }),
    disputeController.listMediatorDisputes,
  );

  router.post(
    "/:id/transition",
    authMiddleware,
    validateRequest({ params: disputeIdParamSchema, body: transitionDisputeSchema }),
    disputeController.transitionDisputeStatus,
  );

  return router;
}
