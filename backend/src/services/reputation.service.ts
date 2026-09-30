import { PrismaClient, TradeStatus } from "@prisma/client";
import { withDatabaseQueryTimeout } from "../lib/queryTimeout";

export interface ReputationEvent {
  id: string;
  event: string;
  impact: number;
  impactLabel: string;
  timestamp: string;
  type: "trade_completed" | "trade_initiated" | "dispute_initiated" | "dispute_resolved" | "dispute_involved" | "account_created";
}

export interface ReputationResponse {
  trustScore: number;
  totalTrades: number;
  completedTrades: number;
  disputedTrades: number;
  successRate: number;
  history: ReputationEvent[];
}

const HISTORY_TRADE_LIMIT = 5;
const HISTORY_DISPUTE_LIMIT = 5;

type ReputationDatabase = {
  trade: Pick<PrismaClient["trade"], "aggregate" | "findMany">;
  dispute: Pick<PrismaClient["dispute"], "aggregate" | "findMany">;
  $transaction?: <TResult>(
    operation: (transaction: ReputationDatabase) => Promise<TResult>,
    options: { maxWait: number; timeout: number },
  ) => Promise<TResult>;
};

export class ReputationService {
  constructor(private prisma: ReputationDatabase) {}

  async getUserReputation(walletAddress: string): Promise<ReputationResponse> {
    const normalized = walletAddress.toLowerCase();

    const tradeParticipantFilter = {
      OR: [{ buyerAddress: normalized }, { sellerAddress: normalized }],
    };

    const {
      totalTrades,
      completedCount,
      disputedCount,
      completedTrades,
      disputesInitiatedCount,
      recentDisputes,
    } = await withDatabaseQueryTimeout(this.prisma, async (database) => {
      const [
        totalAggregate,
        completedAggregate,
        disputedAggregate,
        recentCompletedTrades,
        disputeAggregate,
        latestDisputes,
      ] = await Promise.all([
        database.trade.aggregate({ where: tradeParticipantFilter, _count: { _all: true } }),
        database.trade.aggregate({
          where: { ...tradeParticipantFilter, status: TradeStatus.COMPLETED },
          _count: { _all: true },
        }),
        database.trade.aggregate({
          where: { ...tradeParticipantFilter, status: TradeStatus.DISPUTED },
          _count: { _all: true },
        }),
        database.trade.findMany({
          where: { ...tradeParticipantFilter, status: TradeStatus.COMPLETED },
          orderBy: { createdAt: "desc" },
          take: HISTORY_TRADE_LIMIT,
        }),
        database.dispute.aggregate({
          where: { initiator: normalized },
          _count: { _all: true },
        }),
        database.dispute.findMany({
          where: { initiator: normalized },
          orderBy: { createdAt: "desc" },
          take: HISTORY_DISPUTE_LIMIT,
        }),
      ]);

      return {
        totalTrades: totalAggregate._count._all,
        completedCount: completedAggregate._count._all,
        disputedCount: disputedAggregate._count._all,
        completedTrades: recentCompletedTrades,
        disputesInitiatedCount: disputeAggregate._count._all,
        recentDisputes: latestDisputes,
      };
    });

    let trustScore = 50;
    trustScore += completedCount * 5;
    // Disputes carry no recorded outcome, so a RESOLVED/CLOSED status cannot be
    // treated as "lost" — only the initiation penalty applies.
    trustScore -= disputesInitiatedCount * 2;
    if (totalTrades >= 50) trustScore += 15;
    else if (totalTrades >= 25) trustScore += 8;
    else if (totalTrades >= 10) trustScore += 5;
    trustScore = Math.max(0, Math.min(100, trustScore));

    const successRate =
      totalTrades > 0
        ? Math.round(((completedCount) / totalTrades) * 1000) / 10
        : 100;

    const history: ReputationEvent[] = [];

    for (const trade of completedTrades.slice(0, 5)) {
      const role = trade.buyerAddress === normalized ? "buyer" : "seller";
      history.push({
        id: `trade-${trade.tradeId}`,
        event: `Completed trade as ${role} (${trade.tradeId.slice(0, 8)}...)`,
        impact: 5,
        impactLabel: "+5",
        timestamp: trade.completedAt?.toISOString() ?? trade.createdAt.toISOString(),
        type: "trade_completed",
      });
    }

    for (const dispute of recentDisputes) {
      const resolved = dispute.status === "RESOLVED" || dispute.status === "CLOSED";
      history.push({
        id: `dispute-${dispute.id}`,
        event: resolved
          ? `Dispute on trade ${dispute.tradeId.slice(0, 8)}... was resolved`
          : `Initiated dispute on trade ${dispute.tradeId.slice(0, 8)}...`,
        impact: -2,
        impactLabel: "-2",
        timestamp: dispute.createdAt.toISOString(),
        type: resolved ? "dispute_resolved" : "dispute_initiated",
      });
    }

    history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return {
      trustScore,
      totalTrades,
      completedTrades: completedCount,
      disputedTrades: disputedCount,
      successRate,
      history: history.slice(0, 20),
    };
  }
}
