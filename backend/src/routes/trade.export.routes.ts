import { Prisma, PrismaClient, TradeStatus } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { Parser } from "json2csv";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";

const dateQueryParam = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "must be a valid date",
  });

const exportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).default("json"),
  status: z.nativeEnum(TradeStatus).optional(),
  from: dateQueryParam.optional(),
  to: dateQueryParam.optional(),
  dateFrom: dateQueryParam.optional(),
  dateTo: dateQueryParam.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
}).refine(
  (value: {
    from?: string;
    to?: string;
    dateFrom?: string;
    dateTo?: string;
  }) => {
    const from = value.from ?? value.dateFrom;
    const to = value.to ?? value.dateTo;
    return !from || !to || new Date(from) <= new Date(to);
  },
  { message: "from must be before or equal to to", path: ["from"] },
);

const csvFields = [
  "trade_id",
  "buyer",
  "seller",
  "amount",
  "asset",
  "status",
  "created_at",
  "completed_at",
  "fee",
  "dispute_flag",
];

function caller(req: AuthRequest, res: Response): string | null {
  const walletAddress = req.user?.walletAddress?.trim();
  if (!walletAddress) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return walletAddress;
}

function buildWhere(walletAddress: string, query: z.infer<typeof exportQuerySchema>): Prisma.TradeWhereInput {
  const from = query.from ?? query.dateFrom;
  const to = query.to ?? query.dateTo;
  const where: Prisma.TradeWhereInput = {
    OR: [{ buyerAddress: walletAddress }, { sellerAddress: walletAddress }],
  };

  if (query.status) {
    where.status = query.status;
  }

  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  return where;
}

function serializeTrade(trade: Record<string, unknown>) {
  const dispute = trade.dispute as { id?: number } | null | undefined;
  return {
    trade_id: trade.tradeId,
    buyer: trade.buyerAddress,
    seller: trade.sellerAddress,
    amount: trade.amountUsdc,
    asset: "USDC",
    status: trade.status,
    created_at: trade.createdAt,
    completed_at: trade.completedAt,
    fee: "",
    dispute_flag: Boolean(dispute) || trade.status === TradeStatus.DISPUTED,
  };
}

export function createTradeExportRouter(prisma: PrismaClient = defaultPrisma) {
  const router = Router();

  router.get(
    "/export",
    authMiddleware,
    validateRequest({ query: exportQuerySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const walletAddress = caller(req, res);
        if (!walletAddress) return;

        const query = req.query as unknown as z.infer<typeof exportQuerySchema>;
        const where = buildWhere(walletAddress, query);

        if (query.format === "csv") {
          const trades = await prisma.trade.findMany({
            where,
            include: { dispute: { select: { id: true } } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });
          const rows = trades.map((trade: unknown) => serializeTrade(trade as any));
          const parser = new Parser({ fields: csvFields });
          const csv = parser.parse(rows);
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader("Content-Disposition", `attachment; filename="trades-${new Date().toISOString().slice(0, 10)}.csv"`);
          res.status(200).send(`\ufeff${csv}`);
          return;
        }

        const skip = (query.page - 1) * query.limit;
        const [trades, total] = await Promise.all([
          prisma.trade.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip,
            take: query.limit,
          }),
          prisma.trade.count({ where }),
        ]);

        res.status(200).json({
          items: trades.map((trade: unknown) => serializeTrade(trade as any)),
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.ceil(total / query.limit),
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export const tradeExportRoutes = createTradeExportRouter();
