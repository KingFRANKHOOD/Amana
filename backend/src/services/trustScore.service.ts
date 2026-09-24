import { PrismaClient, TradeStatus, DisputeStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { appLogger } from "../middleware/logger";
import { withDatabaseQueryTimeout } from "../lib/queryTimeout";

export interface TrustScoreBreakdown {
  baseScore: number;
  tradeCompletionBonus: number;
  volumeBonus: number;
  disputePenalty: number;
  activityDecay: number;
  finalScore: number;
}

export interface TrustScoreDetails {
  trustScore: number;
  breakdown: TrustScoreBreakdown;
  stats: {
    totalTrades: number;
    completedTrades: number;
    disputedTrades: number;
    totalVolumeUsdc: number;
    successRate: number;
    accountAgeDays: number;
    lastTradeAt: string | null;
  };
  tier: TrustTier;
  history: TrustScoreEvent[];
}

export type TrustTier =
  | "newcomer"
  | "developing"
  | "established"
  | "trusted"
  | "elite";

export interface TrustScoreEvent {
  id: string;
  event: string;
  impact: number;
  impactLabel: string;
  timestamp: string;
  type:
    | "trade_completed"
    | "trade_initiated"
    | "dispute_initiated"
    | "dispute_lost"
    | "volume_milestone"
    | "account_created";
  decayedImpact: number;
}

interface TrustScoreConfig {
  baseScore: number;
  tradeCompletionPoints: number;
  tradeCompletionMaxTrades: number;
  tradeCompletionDiminishingRate: number;
  volumeThresholds: { minTrades: number; bonus: number }[];
  disputeInitiatedPenalty: number;
  disputeLostPenalty: number;
  decayHalfLifeDays: number;
  minScore: number;
  maxScore: number;
}

const DEFAULT_CONFIG: TrustScoreConfig = {
  baseScore: 50,
  tradeCompletionPoints: 5,
  tradeCompletionMaxTrades: 50,
  tradeCompletionDiminishingRate: 0.8,
  volumeThresholds: [
    { minTrades: 50, bonus: 15 },
    { minTrades: 25, bonus: 8 },
    { minTrades: 10, bonus: 5 },
  ],
  disputeInitiatedPenalty: 2,
  disputeLostPenalty: 8,
  decayHalfLifeDays: 90,
  minScore: 0,
  maxScore: 100,
};

const ACTIVITY_TRADE_LIMIT = 1_000;
const HISTORY_TRADE_LIMIT = 10;
const HISTORY_DISPUTE_LIMIT = 5;

type TrustScoreDatabase = {
  trade: Pick<PrismaClient["trade"], "aggregate" | "findMany" | "findFirst">;
  dispute: Pick<PrismaClient["dispute"], "aggregate" | "findMany">;
  user: Pick<PrismaClient["user"], "findUnique">;
  $queryRaw: PrismaClient["$queryRaw"];
  $transaction?: <TResult>(
    operation: (transaction: TrustScoreDatabase) => Promise<TResult>,
    options: { maxWait: number; timeout: number },
  ) => Promise<TResult>;
};

export class TrustScoreService {
  private config: TrustScoreConfig;

  constructor(
    private readonly prisma: TrustScoreDatabase = defaultPrisma as unknown as TrustScoreDatabase,
    config?: Partial<TrustScoreConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async calculateTrustScore(walletAddress: string): Promise<TrustScoreDetails> {
    const normalized = walletAddress.toLowerCase();
    const startTime = Date.now();

    appLogger.info(
      { walletAddress: normalized },
      "[TrustScore] Calculating trust score",
    );

    const tradeParticipantFilter = {
      OR: [{ buyerAddress: normalized }, { sellerAddress: normalized }],
    };

    const queryResult = await withDatabaseQueryTimeout(this.prisma, async (database) => {
      const [
        user,
        totalAggregate,
        completedAggregate,
        disputedAggregate,
        activityTrades,
        completedTrades,
        disputeAggregate,
        lostDisputeAggregate,
        disputes,
        lastTrade,
        volumeRows,
      ] = await Promise.all([
        database.user.findUnique({ where: { walletAddress: normalized } }),
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
          where: tradeParticipantFilter,
          orderBy: { createdAt: "desc" },
          take: ACTIVITY_TRADE_LIMIT,
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
        database.dispute.aggregate({
          where: { initiator: normalized, status: { in: [DisputeStatus.RESOLVED, DisputeStatus.CLOSED] }, outcome: "LOST" },
          _count: { _all: true },
        }),
        database.dispute.findMany({
          where: { initiator: normalized },
          orderBy: { createdAt: "desc" },
          take: HISTORY_DISPUTE_LIMIT,
        }),
        database.trade.findFirst({
          where: tradeParticipantFilter,
          orderBy: { updatedAt: "desc" },
          select: { updatedAt: true },
        }),
        database.$queryRaw<{ totalVolumeUsdc: string }[]>`
          SELECT COALESCE(SUM(CAST("amountUsdc" AS NUMERIC)), 0)::TEXT AS "totalVolumeUsdc"
          FROM "Trade"
          WHERE "buyerAddress" = ${normalized} OR "sellerAddress" = ${normalized}
        `,
      ]);

      return {
        user,
        totalTrades: totalAggregate._count._all,
        completedCount: completedAggregate._count._all,
        disputedCount: disputedAggregate._count._all,
        activityTrades,
        completedTrades,
        disputeCount: disputeAggregate._count._all,
        lostDisputeCount: lostDisputeAggregate._count._all,
        disputes,
        lastTrade,
        totalVolumeUsdc: Number(volumeRows[0]?.totalVolumeUsdc ?? 0),
      };
    });

    const {
      user,
      totalTrades,
      completedCount,
      disputedCount,
      activityTrades,
      completedTrades,
      disputeCount,
      lostDisputeCount,
      disputes,
      lastTrade,
      totalVolumeUsdc,
    } = queryResult as any;

    const successRate =
      totalTrades > 0
        ? Math.round((completedCount / totalTrades) * 1000) / 10
        : 100;

    const accountAgeDays = user
      ? Math.floor(
          (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24),
        )
      : 0;

    const breakdown = this.calculateBreakdown(
      completedCount,
      totalTrades,
      totalVolumeUsdc,
      disputeCount,
      lostDisputeCount,
      activityTrades,
      normalized,
    );

    const tier = this.getTrustTier(breakdown.finalScore);

    const history = this.buildHistory(
      completedTrades,
      disputes,
      normalized,
    );

    const durationMs = Date.now() - startTime;
    appLogger.info(
      {
        walletAddress: normalized,
        trustScore: breakdown.finalScore,
        tier,
        durationMs,
      },
      "[TrustScore] Calculation complete",
    );

    return {
      trustScore: breakdown.finalScore,
      breakdown,
      stats: {
        totalTrades,
        completedTrades: completedCount,
        disputedTrades: disputedCount,
        totalVolumeUsdc,
        successRate,
        accountAgeDays,
        lastTradeAt: lastTrade?.updatedAt.toISOString() ?? null,
      },
      tier,
      history,
    };
  }

  private calculateBreakdown(
    completedCount: number,
    totalTrades: number,
    totalVolumeUsdc: number,
    disputeCount: number,
    lostDisputeCount: number,
    allTrades: { createdAt: Date; amountUsdc: string; status: TradeStatus }[],
    normalizedAddress: string,
  ): TrustScoreBreakdown {
    const baseScore = this.config.baseScore;

    const tradeCompletionBonus = this.calculateTradeCompletionBonus(
      completedCount,
    );

    const volumeBonus = this.calculateVolumeBonus(totalTrades, totalVolumeUsdc);

    const disputePenalty = this.calculateDisputePenalty(disputeCount, lostDisputeCount);

    const activityDecay = this.calculateActivityDecay(
      allTrades,
      normalizedAddress,
    );

    const rawScore =
      baseScore +
      tradeCompletionBonus +
      volumeBonus -
      disputePenalty +
      activityDecay;

    const finalScore = Math.max(
      this.config.minScore,
      Math.min(this.config.maxScore, Math.round(rawScore * 10) / 10),
    );

    return {
      baseScore,
      tradeCompletionBonus,
      volumeBonus,
      disputePenalty,
      activityDecay,
      finalScore,
    };
  }

  private calculateTradeCompletionBonus(completedCount: number): number {
    if (completedCount === 0) return 0;

    const { tradeCompletionPoints, tradeCompletionMaxTrades, tradeCompletionDiminishingRate } =
      this.config;

    let bonus = 0;
    for (let i = 1; i <= Math.min(completedCount, tradeCompletionMaxTrades); i++) {
      bonus += tradeCompletionPoints * Math.pow(tradeCompletionDiminishingRate, i - 1);
    }

    return Math.round(bonus * 10) / 10;
  }

  private calculateVolumeBonus(totalTrades: number, totalVolumeUsdc: number): number {
    const { volumeThresholds } = this.config;

    let tradeCountBonus = 0;
    for (const threshold of volumeThresholds) {
      if (totalTrades >= threshold.minTrades) {
        tradeCountBonus = threshold.bonus;
        break;
      }
    }

    const volumeBonus = totalVolumeUsdc >= 100000 ? 5
      : totalVolumeUsdc >= 50000 ? 3
      : totalVolumeUsdc >= 10000 ? 2
      : totalVolumeUsdc >= 1000 ? 1
      : 0;

    return tradeCountBonus + volumeBonus;
  }

  private calculateDisputePenalty(disputeCount: number, lostDisputeCount = 0): number {
    if (disputeCount === 0 && lostDisputeCount === 0) return 0;
    return disputeCount * this.config.disputeInitiatedPenalty + lostDisputeCount * this.config.disputeLostPenalty;
  }

  private calculateActivityDecay(
    allTrades: { createdAt: Date; amountUsdc: string; status: TradeStatus }[],
    _normalizedAddress: string,
  ): number {
    if (allTrades.length === 0) return 0;

    const now = Date.now();
    const halfLifeMs = this.config.decayHalfLifeDays * 24 * 60 * 60 * 1000;
    let weightedSum = 0;
    let totalWeight = 0;

    for (const trade of allTrades) {
      const ageMs = now - trade.createdAt.getTime();
      const weight = Math.pow(0.5, ageMs / halfLifeMs);

      let tradeValue = 0;
      if (trade.status === TradeStatus.COMPLETED) {
        tradeValue = 2;
      } else if (trade.status === TradeStatus.DISPUTED) {
        tradeValue = -1;
      } else if (trade.status === TradeStatus.FUNDED || trade.status === TradeStatus.DELIVERED) {
        tradeValue = 1;
      }

      weightedSum += tradeValue * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) return 0;

    const normalizedScore = (weightedSum / totalWeight) * 5;
    return Math.round(Math.max(-20, Math.min(20, normalizedScore)) * 10) / 10;
  }

  getTrustTier(score: number): TrustTier {
    if (score >= 85) return "elite";
    if (score >= 70) return "trusted";
    if (score >= 55) return "established";
    if (score >= 35) return "developing";
    return "newcomer";
  }

  private buildHistory(
    completedTrades: { tradeId: string; buyerAddress: string; sellerAddress: string; completedAt: Date | null; createdAt: Date }[],
    disputes: { id: number; tradeId: string; status: DisputeStatus; createdAt: Date }[],
    normalizedAddress: string,
  ): TrustScoreEvent[] {
    const events: TrustScoreEvent[] = [];
    const now = Date.now();
    const halfLifeMs = this.config.decayHalfLifeDays * 24 * 60 * 60 * 1000;

    for (const trade of completedTrades.slice(0, 10)) {
      const role = trade.buyerAddress === normalizedAddress ? "buyer" : "seller";
      const timestamp = trade.completedAt?.toISOString() ?? trade.createdAt.toISOString();
      const ageMs = now - (trade.completedAt ?? trade.createdAt).getTime();
      const decayFactor = Math.pow(0.5, ageMs / halfLifeMs);
      const rawImpact = this.config.tradeCompletionPoints;
      const decayedImpact = Math.round(rawImpact * decayFactor * 10) / 10;

      events.push({
        id: `trade-${trade.tradeId}`,
        event: `Completed trade as ${role} (${trade.tradeId.slice(0, 8)}...)`,
        impact: rawImpact,
        impactLabel: `+${rawImpact}`,
        timestamp,
        type: "trade_completed",
        decayedImpact,
      });
    }

    for (const dispute of disputes.slice(0, 5)) {
      const isLost = (dispute as any).outcome === "LOST" && (dispute.status === DisputeStatus.RESOLVED || dispute.status === DisputeStatus.CLOSED);
      const timestamp = dispute.createdAt.toISOString();
      const ageMs = now - dispute.createdAt.getTime();
      const decayFactor = Math.pow(0.5, ageMs / halfLifeMs);
      const rawImpact = isLost
        ? -this.config.disputeLostPenalty
        : -this.config.disputeInitiatedPenalty;
      const decayedImpact = Math.round(rawImpact * decayFactor * 10) / 10;

      events.push({
        id: `dispute-${dispute.id}`,
        event: isLost
          ? `Dispute on trade ${dispute.tradeId.slice(0, 8)}... was resolved against you`
          : (dispute.status === DisputeStatus.RESOLVED || dispute.status === DisputeStatus.CLOSED)
            ? `Dispute on trade ${dispute.tradeId.slice(0, 8)}... was resolved in your favor`
            : `Initiated dispute on trade ${dispute.tradeId.slice(0, 8)}...`,
        impact: rawImpact,
        impactLabel: `${rawImpact}`,
        timestamp,
        type: isLost ? "dispute_lost" : "dispute_initiated",
        decayedImpact,
      });
    }

    events.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    return events.slice(0, 20);
  }
}
