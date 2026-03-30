import crypto from "crypto";
import { Prisma, PrismaClient, Trade, TradeStatus, DisputeStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { ContractService } from "./contract.service";

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export interface CreatePendingTradeInput {
  tradeId: string;
  buyerAddress: string;
  sellerAddress: string;
  amountUsdc: string;
  buyerLossBps: number;
  sellerLossBps: number;
}

export type TradeListFilters = {
  status?: TradeStatus;
  page?: number;
  limit?: number;
  sort?: string;
};

type TradeDatabase = Pick<PrismaClient, "trade">;

export class TradeAccessDeniedError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "TradeAccessDeniedError";
  }
}

export class DisputeTradeStatusError extends Error {
  status = 400;
  constructor(status: string) {
    super(`Trade must be in FUNDED or DELIVERED status to initiate a dispute (current: ${status})`);
    this.name = "DisputeTradeStatusError";
  }
}

export class TradeService {
  constructor(
    private readonly prisma: TradeDatabase = defaultPrisma,
    private readonly contractService: ContractService = new ContractService(),
  ) { }

  async createPendingTrade(input: CreatePendingTradeInput): Promise<Trade> {
    return this.prisma.trade.create({
      data: {
        ...input,
        status: TradeStatus.PENDING_SIGNATURE,
      },
    });
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

    if (trade.buyerAddress !== callerAddress && trade.sellerAddress !== callerAddress) {
      throw new TradeAccessDeniedError();
    }

    return trade;
  }

  async getUserStats(address: string) {
    const trades = await this.prisma.trade.findMany({
      where: {
        OR: [{ buyerAddress: address }, { sellerAddress: address }],
      },
      select: {
        amountUsdc: true,
        status: true,
      },
    });

    const openStatuses = new Set<TradeStatus>([
      TradeStatus.PENDING_SIGNATURE,
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
      "buyerAddress",
      "sellerAddress",
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

  async initiateDispute(id: string, callerAddress: string, reason: string, category: string) {
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

    const reasonHash = sha256(reason);

    // Build contract transaction
    // Note: getTradeById handles both numeric and string IDs for local lookup,
    // but the contract needs the tradeId (the blockchain-sourced one).
    const { unsignedXdr } = await this.contractService.buildInitiateDisputeTx({
      tradeId: trade.tradeId,
      initiatorAddress: callerAddress,
      reasonHash,
    });

    // Create DB record
    // We store the plaintext reason for human review.
    await (this.prisma as PrismaClient).dispute.create({
      data: {
        tradeId: trade.tradeId,
        initiator: callerAddress,
        reason,
        status: DisputeStatus.OPEN,
      },
    });

    return { unsignedXdr };
  }
}
