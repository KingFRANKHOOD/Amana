import { HttpError } from "../errors/httpError";
import crypto from "crypto";
import { Prisma, PrismaClient, Trade, TradeStatus, DisputeStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { ContractService } from "./contract.service";
import { appLogger } from "../middleware/logger";
import { TracingHelper } from "../config/tracing";
import { cacheService } from "../lib/cache";
import { auditLogService } from "./auditLog.service";

let _adminPubkeysCache: Set<string> | null = null;

function getAdminPubkeys(): Set<string> {
  if (_adminPubkeysCache === null) {
    const raw = process.env.ADMIN_STELLAR_PUBKEYS ?? "";
    _adminPubkeysCache = new Set(
      raw
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
  }
  return _adminPubkeysCache;
}

export function resetAdminPubkeys(): void {
  _adminPubkeysCache = null;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sanitizeLogField(value: string, maxLength = 200): string {
  return String(value).replace(/[\r\n\t]/g, "_").slice(0, maxLength);
}

export interface CreatePendingTradeInput {
  tradeId: string;
  buyerAddress: string;
  sellerAddress: string;
  amountUsdc: string;
  buyerLossBps: number;
  sellerLossBps: number;
  /** Client-supplied Idempotency-Key header value, if present. */
  idempotencyKey?: string;
}

export type TradeListFilters = {
  status?: TradeStatus;
  page?: number;
  limit?: number;
  sort?: string;
};

type TradeDatabase = Pick<
  PrismaClient,
  "trade" | "dispute" | "disputeCategory" | "auditLog" | "$queryRaw"
> &
  Partial<Pick<PrismaClient, "$transaction" | "userWatchlist">>;

export class TradeAccessDeniedError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "TradeAccessDeniedError";
  }
}

export class DisputeTradeStatusError extends HttpError {
  status = 400;
  constructor(status: string) {
    super(`Trade must be in FUNDED or DELIVERED status to initiate a dispute (current: ${status})`);
    this.name = "DisputeTradeStatusError";
  }
}

export class DisputeCategoryValidationError extends HttpError {
  status = 400;

  constructor(category: string | number) {
    super(`Invalid dispute category: ${category}`);
    this.name = "DisputeCategoryValidationError";
  }
}

export class DuplicateDisputeError extends HttpError {
  status = 409;

  constructor() {
    super("A dispute already exists for this trade");
    this.name = "DuplicateDisputeError";
  }
}

export class TradeService {
  constructor(
    private readonly prisma: TradeDatabase = defaultPrisma,
    private readonly contractService: ContractService = new ContractService(),
  ) { }

  async createPendingTrade(input: CreatePendingTradeInput): Promise<Trade> {
    return TracingHelper.withSpan(
      "trade.create_pending",
      async () => {
        appLogger.info({
          requestId: undefined, // Will be filled by context if available
          userId: sanitizeLogField(input.buyerAddress),
          paymentId: sanitizeLogField(input.tradeId),
          provider: "stellar",
          status: "authorization_started",
          timestamp: new Date().toISOString()
        }, "Payment authorization started");

        TracingHelper.addEvent("authorization_started", {
          paymentId: sanitizeLogField(input.tradeId),
          userId: sanitizeLogField(input.buyerAddress)
        });

        const createTradeAndAuditLog = async (tx: TradeDatabase): Promise<Trade> => {
          const trade = await tx.trade.create({
            data: {
              ...input,
              status: TradeStatus.PENDING_SIGNATURE,
            },
          });

          await auditLogService.record(tx as unknown as Prisma.TransactionClient, {
            tradeId: trade.tradeId,
            eventType: "TradeCreationRequested",
            toStatus: TradeStatus.PENDING_SIGNATURE,
            actor: input.buyerAddress,
            amountUsdc: input.amountUsdc,
            metadata: { seller: input.sellerAddress },
          });

          return trade;
        };

        try {
          if (this.prisma.$transaction) {
            return await this.prisma.$transaction((tx) => createTradeAndAuditLog(tx as TradeDatabase));
          }
          return await createTradeAndAuditLog(this.prisma);
        } catch (error) {
          if (
            input.idempotencyKey &&
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            // A retry with the same Idempotency-Key raced or followed a prior
            // create — return the trade that already exists for that key
            // instead of creating a duplicate.
            const existing = await this.prisma.trade.findUnique({
              where: { idempotencyKey: input.idempotencyKey },
            });
            if (existing) {
              return existing;
            }
          }
          throw error;
        }
      },
      { attributes: { "trade.id": sanitizeLogField(input.tradeId), "trade.status": TradeStatus.PENDING_SIGNATURE } },
    );
  }

  async listUserTrades(address: string, filters: TradeListFilters) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const skip = (page - 1) * limit;
    const orderBy = this.parseSort(filters.sort);

    const where: Prisma.TradeWhereInput = {
      OR: [{ buyerAddress: address }, { sellerAddress: address }],
      ...(filters.status ? { status: filters.status } : {}),
    };

    const watchlist = this.prisma.userWatchlist;
    if (watchlist) {
      // Prisma cannot order a relation by whether it belongs to *this* caller.
      // Fetch the caller's indexed bookmarks first, then query only the
      // remaining trades for the rest of the page. This keeps watched trades at
      // the top without incorrectly promoting trades watched by other users.
      const [entries, total] = await Promise.all([
        watchlist.findMany({
          where: { userAddress: address.toLowerCase() },
          include: { trade: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        this.prisma.trade.count({ where }),
      ]);
      const watched = entries
        .map((entry) => entry.trade)
        .filter((trade) =>
          !filters.status || trade.status === filters.status,
        );
      const watchedIds = watched.map((trade) => trade.tradeId);
      const watchedPage = watched.slice(skip, skip + limit);
      const remainingSlots = limit - watchedPage.length;
      const remainingSkip = Math.max(0, skip - watched.length);
      const unwatchlisted = remainingSlots > 0
        ? await this.prisma.trade.findMany({
          where: watchedIds.length > 0
            ? { AND: [where, { NOT: { tradeId: { in: watchedIds } } }] }
            : where,
          orderBy,
          skip: remainingSkip,
          take: remainingSlots,
        })
        : [];

      return {
        items: [...watchedPage, ...unwatchlisted],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      };
    }

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

    const trade = await cacheService.getOrSet<Trade | null>(
      `cache:trade:${id}`,
      60,
      () => this.prisma.trade.findFirst({ where: { OR: orConditions } }),
    );

    if (!trade) {
      return null;
    }

    const caller = callerAddress.toLowerCase();
    if (
      trade.buyerAddress.toLowerCase() !== caller &&
      trade.sellerAddress.toLowerCase() !== caller &&
      !getAdminPubkeys().has(caller)
    ) {
      throw new TradeAccessDeniedError();
    }

    return trade;
  }

  private async invalidateTradeCache(id: string, tradeId?: string): Promise<void> {
    await cacheService.invalidateOne(`cache:trade:${id}`);
    if (tradeId && tradeId !== id) {
      await cacheService.invalidateOne(`cache:trade:${tradeId}`);
    }
  }

  async getUserStats(address: string) {
    const key = `stats:user:${address}`;
    return cacheService.getOrSet(key, 300, async () => {
      // Total trades (count)
      const where = {
        OR: [{ buyerAddress: address }, { sellerAddress: address }],
      } as Prisma.TradeWhereInput;

      const totalTrades = await this.prisma.trade.count({ where });

      // Total volume: cast stored string to numeric in SQL
      const totalVolumeRows: Array<{ total_volume: string }> = await this.prisma.$queryRaw`
        SELECT COALESCE(SUM((amount_usdc)::numeric), 0)::text AS total_volume
        FROM "Trade"
        WHERE buyer_address = ${address} OR seller_address = ${address}
      `;
      const totalVolume = parseFloat(totalVolumeRows[0]?.total_volume ?? "0");

      // Status-based counts using groupBy
      const grouped = await this.prisma.trade.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      });

      const openStatuses = new Set<TradeStatus>([
        TradeStatus.PENDING_SIGNATURE,
        TradeStatus.CREATED,
        TradeStatus.FUNDED,
        TradeStatus.DELIVERED,
        TradeStatus.DISPUTED,
      ]);

      const openTrades = grouped.reduce((sum, g) => {
        if (openStatuses.has(g.status as TradeStatus)) return sum + (g._count?._all ?? 0);
        return sum;
      }, 0);

      return { totalTrades, totalVolume, openTrades };
    });
  }

  private parseSort(sort?: string): Prisma.TradeOrderByWithRelationInput[] {
    if (!sort) {
      return [{ createdAt: "desc" }, { id: "desc" }];
    }

    const [fieldRaw, dirRaw] = sort.split(":");
    const field = (fieldRaw ?? "") as keyof Prisma.TradeOrderByWithRelationInput;
    const direction = dirRaw?.toLowerCase() === "asc" ? "asc" : "desc";

    const allowedFields = new Set<string>([
      "id",
      "tradeId",
      "buyerAddress",
      "sellerAddress",
      "amountUsdc",
      "status",
      "createdAt",
      "updatedAt",
    ]);

    if (!allowedFields.has(fieldRaw!)) {
      return [{ createdAt: "desc" }, { id: "desc" }];
    }

    if (fieldRaw === "id") {
      return [{ id: direction }];
    }

    return [{ [field]: direction }, { id: direction }];
  }

  async initiateDispute(
    id: string,
    callerAddress: string,
    reason: string,
    category: string,
    categoryId?: number,
  ) {
    return TracingHelper.withSpan(
      "dispute.initiate",
      async (span) => {
        const trade = await this.getTradeById(id, callerAddress);
        if (!trade) {
          throw new Error("Trade not found");
        }

        // Access check is already done by getTradeById, but let's be explicit
        if (trade.buyerAddress !== callerAddress && trade.sellerAddress !== callerAddress) {
          throw new TradeAccessDeniedError();
        }

        // Check status: FUNDED or DELIVERED
        if (trade.status !== TradeStatus.FUNDED && trade.status !== TradeStatus.DELIVERED) {
          throw new DisputeTradeStatusError(trade.status);
        }

        const resolvedCategoryId = await this.resolveDisputeCategoryId(category, categoryId);
        const reasonHash = sha256(reason);

        span.setAttributes({
          "trade.id": sanitizeLogField(trade.tradeId),
          "trade.status": trade.status,
          "dispute.category_id": resolvedCategoryId,
        });

        // Build contract transaction
        // Note: getTradeById handles both numeric and string IDs for local lookup,
        // but the contract needs the tradeId (the blockchain-sourced one).
        const { unsignedXdr } = await this.contractService.buildInitiateDisputeTx({
          tradeId: trade.tradeId,
          initiatorAddress: callerAddress,
          reasonHash,
        });

        try {
          await this.createDisputeAtomically({
            tradeId: trade.tradeId,
            callerAddress,
            reason,
            categoryId: resolvedCategoryId,
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            throw new DuplicateDisputeError();
          }
          throw error;
        }

        await this.invalidateTradeCache(id, trade.tradeId);

        return { unsignedXdr };
      },
      { attributes: { "trade.id": id } },
    );
  }

  private async createDisputeAtomically(input: {
    tradeId: string;
    callerAddress: string;
    reason: string;
    categoryId: number;
  }): Promise<void> {
    const createDispute = async (tx: TradeDatabase) => {
      const current = await tx.trade.findUnique({
        where: { tradeId: input.tradeId },
        select: {
          tradeId: true,
          buyerAddress: true,
          sellerAddress: true,
          status: true,
        },
      });

      if (!current) {
        throw new Error("Trade not found");
      }

      if (
        current.buyerAddress !== input.callerAddress &&
        current.sellerAddress !== input.callerAddress
      ) {
        throw new TradeAccessDeniedError();
      }

      if (current.status !== TradeStatus.FUNDED && current.status !== TradeStatus.DELIVERED) {
        throw new DisputeTradeStatusError(current.status);
      }

      await tx.dispute.create({
        data: {
          tradeId: current.tradeId,
          initiator: input.callerAddress,
          reason: input.reason,
          status: DisputeStatus.OPEN,
          categoryId: input.categoryId,
        },
      });
    };

    if (this.prisma.$transaction) {
      await this.prisma.$transaction((tx) => createDispute(tx as TradeDatabase));
      return;
    }

    await createDispute(this.prisma);
  }

  private async resolveDisputeCategoryId(category: string, categoryId?: number): Promise<number> {
    if (categoryId !== undefined) {
      const categoryRecord = await this.prisma.disputeCategory.findFirst({
        where: { id: categoryId, isActive: true },
        select: { id: true },
      });

      if (!categoryRecord) {
        throw new DisputeCategoryValidationError(categoryId);
      }

      return categoryRecord.id;
    }

    const normalizedCategory = category.trim();
    if (!normalizedCategory) {
      throw new DisputeCategoryValidationError(category);
    }

    const categoryRecord = await this.prisma.disputeCategory.findFirst({
      where: { name: normalizedCategory, isActive: true },
      select: { id: true },
    });

    if (!categoryRecord) {
      throw new DisputeCategoryValidationError(normalizedCategory);
    }

    return categoryRecord.id;
  }

  /** Alias for listUserTrades — used by trade.controller.test.ts */
  listTrades = this.listUserTrades.bind(this);
}
