import { Prisma, PrismaClient, TradeStatus } from "@prisma/client";

export type TradeListFilters = {
  status?: TradeStatus;
  page?: number;
  limit?: number;
  sort?: string;
};

export class TradeAccessDeniedError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "TradeAccessDeniedError";
  }
}

export class TradeService {
  constructor(private readonly prisma: PrismaClient) {}

  async listUserTrades(address: string, filters: TradeListFilters) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const skip = (page - 1) * limit;
    const orderBy = this.parseSort(filters.sort);

    const where: Prisma.TradeWhereInput = {
      OR: [{ buyer: address }, { seller: address }],
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.trade.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.trade.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async getTradeById(id: string, callerAddress: string) {
    const numericId = Number(id);
    const orConditions: Prisma.TradeWhereInput[] = [{ tradeId: id }];

    if (Number.isInteger(numericId) && numericId > 0) {
      orConditions.push({ id: numericId });
    }

    const trade = await this.prisma.trade.findFirst({
      where: {
        OR: orConditions,
      },
    });

    if (!trade) {
      return null;
    }

    if (trade.buyer !== callerAddress && trade.seller !== callerAddress) {
      throw new TradeAccessDeniedError();
    }

    return trade;
  }

  async getUserStats(address: string) {
    const trades = await this.prisma.trade.findMany({
      where: {
        OR: [{ buyer: address }, { seller: address }],
      },
      select: {
        amountUsdc: true,
        status: true,
      },
    });

    const openStatuses = new Set<TradeStatus>([
      TradeStatus.CREATED,
      TradeStatus.FUNDED,
      TradeStatus.DELIVERED,
      TradeStatus.DISPUTED,
    ]);

    const totalTrades = trades.length;
    const totalVolume = trades.reduce((sum, trade) => {
      const amount = Number(trade.amountUsdc);
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0);
    const openTrades = trades.filter((trade) => openStatuses.has(trade.status)).length;

    return {
      totalTrades,
      totalVolume,
      openTrades,
    };
  }

  private parseSort(sort?: string): Prisma.TradeOrderByWithRelationInput {
    if (!sort) {
      return { createdAt: "desc" };
    }

    const [fieldRaw, dirRaw] = sort.split(":");
    const field = fieldRaw as keyof Prisma.TradeOrderByWithRelationInput;
    const direction = dirRaw?.toLowerCase() === "asc" ? "asc" : "desc";

    const allowedFields = new Set<string>([
      "id",
      "tradeId",
      "buyer",
      "seller",
      "amountUsdc",
      "status",
      "createdAt",
      "updatedAt",
    ]);

    if (!allowedFields.has(fieldRaw)) {
      return { createdAt: "desc" };
    }

    return { [field]: direction };
  }
}
