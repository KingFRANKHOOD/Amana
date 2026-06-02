import { TradeStatus } from "@prisma/client";
import { appLogger } from "../middleware/logger";

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

/**
 * Writes a durable, structured audit log entry for an escrow lifecycle transition.
 *
 * All fields are flat (no nesting beyond `extra`) so log aggregators can index
 * them without schema gymnastics. The `audit: true` sentinel lets operations
 * filter for audit events independently of debug/info noise.
 */
export function logEscrowEvent(ctx: EscrowAuditContext): void {
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
}
