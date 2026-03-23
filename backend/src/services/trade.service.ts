import { TradeStatus, Prisma } from "@prisma/client";
import prisma from "../config/prisma";

const VALID_STATUSES = new Set<string>(Object.values(TradeStatus));
const SORTABLE_FIELDS = new Set(["createdAt", "updatedAt", "amount_usdc", "status", "trade_id"]);
const FIELD_MAP: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  amount_usdc: "amount_usdc",
  status: "status",
  trade_id: "trade_id",
};

export interface TradeFilters {
  status?: string;
  page?: number;
  limit?: number;
  sort?: string;
}

export async function listUserTrades(address: string, filters: TradeFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

  const where: Prisma.TradeWhereInput = {
    OR: [{ buyer: address }, { seller: address }],
  };

  if (filters.status) {
    if (!VALID_STATUSES.has(filters.status)) {
      throw new ValidationError(`Invalid status: ${filters.status}`);
    }
    where.status = filters.status as TradeStatus;
  }

  let orderBy: Prisma.TradeOrderByWithRelationInput = { created_at: "desc" };
  if (filters.sort) {
    const [field, direction] = filters.sort.split(":");
    if (field && SORTABLE_FIELDS.has(field)) {
      const mappedField = FIELD_MAP[field] || field;
      const dir = direction === "asc" ? "asc" : "desc";
      orderBy = { [mappedField]: dir };
    }
  }

  const [trades, total] = await Promise.all([
    prisma.trade.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.trade.count({ where }),
  ]);

  return {
    trades,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getTradeById(id: number, callerAddress: string) {
  const trade = await prisma.trade.findUnique({ where: { id } });

  if (!trade) {
    return { trade: null, error: "not_found" as const };
  }

  if (trade.buyer !== callerAddress && trade.seller !== callerAddress) {
    return { trade: null, error: "forbidden" as const };
  }

  return { trade, error: null };
}

export async function getUserStats(address: string) {
  const where: Prisma.TradeWhereInput = {
    OR: [{ buyer: address }, { seller: address }],
  };

  const openStatuses: TradeStatus[] = [
    TradeStatus.Created,
    TradeStatus.Funded,
    TradeStatus.Delivered,
    TradeStatus.Disputed,
  ];

  const [totalTrades, volumeResult, openTrades] = await Promise.all([
    prisma.trade.count({ where }),
    prisma.trade.aggregate({
      where,
      _sum: { amount_usdc: true },
    }),
    prisma.trade.count({
      where: {
        ...where,
        status: { in: openStatuses },
      },
    }),
  ]);

  return {
    totalTrades,
    totalVolume: volumeResult._sum.amount_usdc ?? 0,
    openTrades,
  };
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
