import { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { appLogger } from "../middleware/logger";
import { runtimeEnvValue } from "../config/env";

export interface AuditLogEntry {
  tradeId: string;
  eventType: string;
  toStatus: string;
  actor?: string;
  amountUsdc?: string;
  ledgerSequence?: number;
  contractId?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogRecord {
  id: number;
  tradeId: string;
  eventType: string;
  toStatus: string;
  actor: string | null;
  amountUsdc: string | null;
  ledgerSequence: number | null;
  contractId: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}

export interface AuditLogListFilters {
  tradeId?: string;
  eventType?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  limit?: number;
}

export interface AuditLogListResult {
  items: AuditLogRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const DEFAULT_AUDIT_LOG_RETENTION_DAYS = 365 * 7;

/**
 * Append-only audit trail for financial operations. Insert-only by design:
 * this service intentionally exposes no update or delete methods for
 * individual rows — see `pruneExpired` for the sole (bulk, retention-driven)
 * deletion path.
 */
export class AuditLogService {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  /** Record a financial-operation audit entry. Never throws into the caller's transaction. */
  async record(tx: Prisma.TransactionClient, entry: AuditLogEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        tradeId: entry.tradeId,
        eventType: entry.eventType,
        toStatus: entry.toStatus,
        actor: entry.actor ?? null,
        amountUsdc: entry.amountUsdc ?? null,
        ledgerSequence: entry.ledgerSequence ?? null,
        contractId: entry.contractId ?? null,
        metadata: (entry.metadata as Prisma.JsonObject) ?? undefined,
      },
    });
  }

  /** Paginated, filterable read path backing the admin audit dashboard. */
  async list(filters: AuditLogListFilters): Promise<AuditLogListResult> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

    const where: Prisma.AuditLogWhereInput = {};
    if (filters.tradeId) where.tradeId = filters.tradeId;
    if (filters.eventType) where.eventType = filters.eventType;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      };
    }

    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.auditLog.count({ where }),
    ]);

    return {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  /**
   * Bulk-delete rows older than the retention window. This is the only
   * deletion path for AuditLog and is intended to be invoked exclusively by
   * the scheduled retention job, never from request-handling code.
   */
  async pruneExpired(retentionDays: number = getAuditLogRetentionDays()): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.db.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    appLogger.info(
      { deleted: result.count, cutoff: cutoff.toISOString(), retentionDays },
      "[AuditLog] Retention prune complete",
    );
    return result.count;
  }
}

export function getAuditLogRetentionDays(): number {
  return runtimeEnvValue("AUDIT_LOG_RETENTION_DAYS");
}

export const auditLogService = new AuditLogService();
