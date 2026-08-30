import { Prisma, TradeStatus } from "@prisma/client";
import { appLogger } from "../middleware/logger";
import { AuditLogService } from "../services/auditLog.service";

export interface EscrowAuditContext {
  tradeId: string;
  eventType: string;
  toStatus: TradeStatus;
  ledgerSequence: number;
  contractId: string;
  actor?: string;
  amountUsdc?: string;
  extra?: Record<string, unknown>;
}

const auditLogService = new AuditLogService();

/**
 * Writes a durable, structured audit log entry for an escrow lifecycle
 * transition: a structured log line (for log-aggregator search) plus an
 * append-only row in the AuditLog table (for the audit dashboard and
 * compliance/dispute review), persisted in the same DB transaction as the
 * state change it documents so the two can never diverge.
 *
 * The `audit: true` sentinel lets operations filter for audit events
 * independently of debug/info noise.
 */
export async function logEscrowEvent(tx: Prisma.TransactionClient, ctx: EscrowAuditContext): Promise<void> {
  appLogger.info(
    {
      audit: true,
      tradeId: ctx.tradeId,
      eventType: ctx.eventType,
      toStatus: ctx.toStatus,
      ledgerSequence: ctx.ledgerSequence,
      contractId: ctx.contractId,
      actor: ctx.actor ?? null,
      amountUsdc: ctx.amountUsdc ?? null,
      timestamp: new Date().toISOString(),
      ...ctx.extra,
    },
    `[EscrowAudit] ${ctx.eventType} → ${ctx.toStatus}`,
  );

  await auditLogService.record(tx, {
    tradeId: ctx.tradeId,
    eventType: ctx.eventType,
    toStatus: ctx.toStatus,
    actor: ctx.actor,
    amountUsdc: ctx.amountUsdc,
    ledgerSequence: ctx.ledgerSequence,
    contractId: ctx.contractId,
    metadata: ctx.extra,
  });
}
