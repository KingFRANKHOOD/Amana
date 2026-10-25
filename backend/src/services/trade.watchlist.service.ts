import { HttpError } from "../errors/httpError";
import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";

export class WatchTradeNotFoundError extends HttpError {
  status = 404;
  constructor() {
    super("Trade not found");
    this.name = "WatchTradeNotFoundError";
  }
}

export class WatchTradeAccessDeniedError extends HttpError {
  status = 403;
  constructor() {
    super("Forbidden");
    this.name = "WatchTradeAccessDeniedError";
  }
}

type WatchlistDatabase = Pick<PrismaClient, "trade" | "userWatchlist">;

export class TradeWatchlistService {
  constructor(private readonly prisma: WatchlistDatabase = defaultPrisma) {}

  private async assertTradeAccess(tradeId: string, userAddress: string) {
    const trade = await this.prisma.trade.findUnique({ where: { tradeId } });
    if (!trade) throw new WatchTradeNotFoundError();
    const caller = userAddress.toLowerCase();
    if (
      trade.buyerAddress.toLowerCase() !== caller &&
      trade.sellerAddress.toLowerCase() !== caller
    ) {
      throw new WatchTradeAccessDeniedError();
    }
    return trade;
  }

  async add(tradeId: string, userAddress: string) {
    const trade = await this.assertTradeAccess(tradeId, userAddress);
    const userAddressNormalized = userAddress.toLowerCase();
    const item = await this.prisma.userWatchlist.upsert({
      where: {
        userAddress_tradeId: {
          userAddress: userAddressNormalized,
          tradeId: trade.tradeId,
        },
      },
      create: { userAddress: userAddressNormalized, tradeId: trade.tradeId },
      update: {},
    });
    return item;
  }

  async remove(tradeId: string, userAddress: string) {
    // Verify ownership even when no bookmark exists, avoiding a delete endpoint
    // that can be used to probe unrelated trades.
    const trade = await this.assertTradeAccess(tradeId, userAddress);
    const result = await this.prisma.userWatchlist.deleteMany({
      where: { userAddress: userAddress.toLowerCase(), tradeId: trade.tradeId },
    });
    return { removed: result.count > 0 };
  }

  async list(userAddress: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const normalizedAddress = userAddress.toLowerCase();
    const [entries, total] = await Promise.all([
      this.prisma.userWatchlist.findMany({
        where: { userAddress: normalizedAddress },
        include: { trade: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: limit,
      }),
      this.prisma.userWatchlist.count({
        where: { userAddress: normalizedAddress },
      }),
    ]);
    const items = entries.map(({ trade, createdAt }) => ({
      ...trade,
      watchedAt: createdAt,
    }));
    return { items, total, page, limit };
  }
}
