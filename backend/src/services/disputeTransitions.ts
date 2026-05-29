import { DisputeStatus, Prisma } from "@prisma/client";
import { AppError, ErrorCode } from "../errors/errorCodes";

/** Terminal dispute statuses — disputes in these states are considered complete. */
export const COMPLETED_DISPUTE_STATUSES: DisputeStatus[] = [
  DisputeStatus.RESOLVED,
  DisputeStatus.CLOSED,
];

/** Valid forward-only status transition map for mediator-initiated updates. */
export const VALID_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  [DisputeStatus.OPEN]: [DisputeStatus.UNDER_REVIEW, DisputeStatus.CLOSED],
  [DisputeStatus.UNDER_REVIEW]: [DisputeStatus.RESOLVED, DisputeStatus.CLOSED],
  [DisputeStatus.RESOLVED]: [],
  [DisputeStatus.CLOSED]: [],
};

export function getAllowedTransitions(status: DisputeStatus): DisputeStatus[] {
  return VALID_TRANSITIONS[status] ?? [];
}

export function isValidTransition(from: DisputeStatus, to: DisputeStatus): boolean {
  return getAllowedTransitions(from).includes(to);
}

export function isTerminalDisputeStatus(status: DisputeStatus): boolean {
  return COMPLETED_DISPUTE_STATUSES.includes(status);
}

export function resolvedAtForStatus(status: DisputeStatus): Date | undefined {
  return status === DisputeStatus.RESOLVED || status === DisputeStatus.CLOSED
    ? new Date()
    : undefined;
}

/**
 * Atomically apply a dispute status transition using optimistic concurrency.
 * Returns true when the update succeeded, false when another writer won the race.
 */
export async function applyDisputeStatusTransition(
  tx: Prisma.TransactionClient,
  dispute: { id: number; status: DisputeStatus; version: number },
  newStatus: DisputeStatus,
): Promise<boolean> {
  const resolvedAt = resolvedAtForStatus(newStatus);

  const result = await tx.dispute.updateMany({
    where: {
      id: dispute.id,
      status: dispute.status,
      version: dispute.version,
    },
    data: {
      status: newStatus,
      version: { increment: 1 },
      ...(resolvedAt !== undefined && { resolvedAt }),
    },
  });

  return result.count > 0;
}

export function assertValidTransition(
  currentStatus: DisputeStatus,
  requestedStatus: DisputeStatus,
): void {
  const allowedNext = getAllowedTransitions(currentStatus);
  if (!allowedNext.includes(requestedStatus)) {
    throw new AppError(
      ErrorCode.DISPUTE_STATUS_TRANSITION_INVALID,
      `Cannot transition dispute from ${currentStatus} to ${requestedStatus}`,
      422,
      {
        currentStatus,
        requestedStatus,
        allowedTransitions: allowedNext,
      },
    );
  }
}

export function assertTransitionApplied(
  applied: boolean,
  tradeId: string,
): void {
  if (!applied) {
    throw new AppError(
      ErrorCode.DISPUTE_STATUS_CONFLICT,
      "Dispute status changed concurrently; retry the transition",
      409,
      { tradeId },
    );
  }
}

/**
 * Authoritative chain sync: mark an active dispute RESOLVED when the contract
 * emits DisputeResolved. Bypasses the mediator-only forward path so OPEN
 * disputes are not left stale after on-chain resolution.
 */
export async function syncDisputeResolvedFromChain(
  tx: Prisma.TransactionClient,
  tradeId: string,
): Promise<void> {
  const dispute = await tx.dispute.findUnique({ where: { tradeId } });
  if (!dispute || isTerminalDisputeStatus(dispute.status)) {
    return;
  }

  const result = await tx.dispute.updateMany({
    where: {
      id: dispute.id,
      status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
      version: dispute.version,
    },
    data: {
      status: DisputeStatus.RESOLVED,
      resolvedAt: new Date(),
      version: { increment: 1 },
    },
  });

  if (result.count === 0) {
    throw new Error("Dispute concurrency conflict during chain sync");
  }
}

/**
 * Ensure a dispute row exists after DisputeInitiated chain events so trade and
 * dispute persistence stay aligned when initiation happens on-chain first.
 */
export async function syncDisputeInitiatedFromChain(
  tx: Prisma.TransactionClient,
  tradeId: string,
  initiator: string,
): Promise<void> {
  const existing = await tx.dispute.findUnique({ where: { tradeId } });
  if (existing) {
    return;
  }

  await tx.dispute.create({
    data: {
      tradeId,
      initiator: initiator || "unknown",
      reason: "On-chain dispute initiation",
      status: DisputeStatus.OPEN,
      version: 0,
    },
  });
}
