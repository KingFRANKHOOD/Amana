import { PrismaClient, DisputeStatus } from "@prisma/client";
import { AppError, ErrorCode } from "../errors/errorCodes";
import { isMediatorAddress } from "../lib/accessControl";
import { TracingHelper } from "../config/tracing";
import { auditLogService } from "./auditLog.service";
import {
  COMPLETED_DISPUTE_STATUSES,
  applyDisputeStatusTransition,
  assertTransitionApplied,
  assertValidTransition,
} from "./disputeTransitions";

export { COMPLETED_DISPUTE_STATUSES, DisputeStatus };

export interface DisputeCleanupResult {
  purgedCount: number;
  tradeIds: string[];
}

export interface DisputeResponse {
  id: number;
  tradeId: string;
  initiator: string;
  reason: string;
  status: DisputeStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  trade: {
    buyerAddress: string;
    sellerAddress: string;
    amountUsdc: string;
  };
}

export interface DisputeListResponse {
  items: DisputeResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const disputeInclude = {
  trade: {
    select: { buyerAddress: true, sellerAddress: true, amountUsdc: true },
  },
} as const;

function toDisputeResponse(dispute: {
  id: number;
  tradeId: string;
  initiator: string;
  reason: string;
  status: DisputeStatus;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  trade: { buyerAddress: string; sellerAddress: string; amountUsdc: string };
}): DisputeResponse {
  return {
    id: dispute.id,
    tradeId: dispute.tradeId,
    initiator: dispute.initiator,
    reason: dispute.reason,
    status: dispute.status,
    createdAt: dispute.createdAt.toISOString(),
    updatedAt: dispute.updatedAt.toISOString(),
    resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
    trade: dispute.trade,
  };
}

export class DisputeService {
  constructor(private prisma: PrismaClient) {}

  async listMediatorDisputes(
    mediatorAddress: string,
    params: { status?: DisputeStatus; page?: number; limit?: number } = {},
  ): Promise<DisputeListResponse> {
    const { status, page = 1, limit = 10 } = params;
    const offset = (page - 1) * limit;

    if (!isMediatorAddress(mediatorAddress)) {
      throw new AppError(
        ErrorCode.AUTH_ERROR,
        "Unauthorized: Not a mediator",
        403,
      );
    }

    const where = status ? { status } : {};

    const [disputes, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        include: disputeInclude,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      this.prisma.dispute.count({ where }),
    ]);

    return {
      items: disputes.map(toDisputeResponse),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getDisputeByTradeId(tradeId: string): Promise<DisputeResponse | null> {
    const dispute = await this.prisma.dispute.findFirst({
      where: { tradeId },
      include: disputeInclude,
    });

    if (!dispute) return null;

    return toDisputeResponse(dispute);
  }

  /**
   * Purge transient/sensitive data fields from disputes that have reached a
   * terminal status (RESOLVED or CLOSED).  The core record is retained for
   * audit purposes; only the free-text `reason` field is cleared so that PII
   * is not stored indefinitely after a case concludes.
   *
   * Only a mediator (address listed in ADMIN_STELLAR_PUBKEYS) may trigger this
   * operation.  Returns the number of records updated and the affected tradeIds.
   */
  async purgeCompletedDisputeData(
    mediatorAddress: string,
    olderThanDays = 90,
  ): Promise<DisputeCleanupResult> {
    if (!isMediatorAddress(mediatorAddress)) {
      throw new AppError(
        ErrorCode.AUTH_ERROR,
        "Unauthorized: Not a mediator",
        403,
      );
    }

    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const completed = await this.prisma.dispute.findMany({
      where: {
        status: { in: COMPLETED_DISPUTE_STATUSES },
        resolvedAt: { lte: cutoff },
        reason: { not: "" },
      },
      select: { id: true, tradeId: true },
    });

    if (completed.length === 0) {
      return { purgedCount: 0, tradeIds: [] };
    }

    const ids = completed.map((d: { id: number; tradeId: string }) => d.id);

    await this.prisma.dispute.updateMany({
      where: { id: { in: ids } },
      data: { reason: "" },
    });

    return {
      purgedCount: completed.length,
      tradeIds: completed.map(
        (d: { id: number; tradeId: string }) => d.tradeId,
      ),
    };
  }

  /**
   * Transition a dispute to a new status.
   * Only valid forward transitions are permitted; backwards or sideways moves throw
   * DISPUTE_STATUS_TRANSITION_INVALID. Concurrent updates throw DISPUTE_STATUS_CONFLICT.
   */
  async transitionDisputeStatus(
    tradeId: string,
    mediatorAddress: string,
    newStatus: DisputeStatus,
  ): Promise<DisputeResponse> {
    return TracingHelper.withSpan(
      "dispute.transition_status",
      async (span) => {
        if (!isMediatorAddress(mediatorAddress)) {
          throw new AppError(
            ErrorCode.AUTH_ERROR,
            "Unauthorized: Not a mediator",
            403,
          );
        }

        return this.prisma.$transaction(async (tx) => {
          const dispute = await tx.dispute.findFirst({
            where: { tradeId },
            include: disputeInclude,
          });

          if (!dispute) {
            throw new AppError(
              ErrorCode.DISPUTE_NOT_FOUND,
              `No dispute found for trade: ${tradeId}`,
              404,
            );
          }

          span.setAttributes({
            "trade.id": tradeId,
            "dispute.id": dispute.id,
            "dispute.status_from": dispute.status,
            "dispute.status_to": newStatus,
          });

          // Idempotency: a retry after a network timeout should succeed silently
          // when the first request already applied the transition.
          if (dispute.status === newStatus) {
            return toDisputeResponse(dispute);
          }

          assertValidTransition(dispute.status, newStatus);

          const applied = await applyDisputeStatusTransition(
            tx,
            dispute,
            newStatus,
          );
          assertTransitionApplied(applied, tradeId);

          const updated = await tx.dispute.findUniqueOrThrow({
            where: { id: dispute.id },
            include: disputeInclude,
          });

          await auditLogService.record(tx, {
            tradeId,
            eventType: "DisputeStatusTransition",
            toStatus: newStatus,
            actor: mediatorAddress,
            metadata: { fromStatus: dispute.status, disputeId: dispute.id },
          });

          return toDisputeResponse(updated);
        });
      },
      { attributes: { "trade.id": tradeId } },
    );
  }
}
