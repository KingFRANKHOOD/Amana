import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { appLogger } from "../middleware/logger";
import { runtimeEnvValue } from "../config/env";
import MetricsService from "./metrics.service";
import { MeterProvider } from "@opentelemetry/sdk-metrics";

export interface TableStorageStat {
  tableName: string;
  rowCount: number;
  totalSizeBytes: number;
}

export interface StorageSnapshot {
  databaseSizeBytes: number;
  tables: TableStorageStat[];
  archiveStorageSizeBytes: number;
  archiveFilesCount: number;
  collectedAt: string;
}

export class StorageMonitoringService {
  private metricsService: MetricsService;

  constructor(
    private readonly db: PrismaClient = defaultPrisma,
    metricsService?: MetricsService,
  ) {
    this.metricsService =
      metricsService ?? MetricsService.getInstance(new MeterProvider());
  }

  /**
   * Calculate disk usage of the local archival storage directory.
   */
  private getArchiveStorageStats(): { totalBytes: number; fileCount: number } {
    const archivePath = runtimeEnvValue("ARCHIVE_STORAGE_PATH") ?? "./data/archives";
    const resolvedPath = path.resolve(process.cwd(), archivePath);

    if (!fs.existsSync(resolvedPath)) {
      return { totalBytes: 0, fileCount: 0 };
    }

    let totalBytes = 0;
    let fileCount = 0;

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const stats = fs.statSync(fullPath);
          totalBytes += stats.size;
          fileCount++;
        }
      }
    };

    try {
      walk(resolvedPath);
    } catch (error) {
      appLogger.warn({ error, resolvedPath }, "[StorageMonitoring] Failed to calculate archive dir size");
    }

    return { totalBytes, fileCount };
  }

  /**
   * Collects detailed storage and table statistics from PostgreSQL system catalogs.
   */
  async collectStorageMetrics(): Promise<StorageSnapshot> {
    const tableStats: TableStorageStat[] = [];
    let databaseSizeBytes = 0;

    try {
      // Query PostgreSQL catalog for real table sizes and row counts
      const rawTableSizes: Array<{
        table_name: string;
        row_count: bigint | number | string;
        total_size_bytes: bigint | number | string;
      }> = await this.db.$queryRaw`
        SELECT
          relname AS table_name,
          n_live_tup AS row_count,
          pg_total_relation_size(relid) AS total_size_bytes
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(relid) DESC;
      `;

      for (const row of rawTableSizes) {
        const tableName = row.table_name;
        const rowCount = Number(row.row_count) || 0;
        const totalSizeBytes = Number(row.total_size_bytes) || 0;

        tableStats.push({
          tableName,
          rowCount,
          totalSizeBytes,
        });

        this.metricsService.recordStorageTableMetrics(tableName, totalSizeBytes, rowCount);
      }

      const dbSizeRaw: Array<{ db_size_bytes: bigint | number | string }> = await this.db.$queryRaw`
        SELECT pg_database_size(current_database()) AS db_size_bytes;
      `;

      const firstSizeRow = dbSizeRaw[0];
      if (firstSizeRow && firstSizeRow.db_size_bytes) {
        databaseSizeBytes = Number(firstSizeRow.db_size_bytes);
        this.metricsService.recordDatabaseSize(databaseSizeBytes);
      }
    } catch (err) {
      // Fallback for non-Postgres / unit-test environments
      appLogger.debug({ err }, "[StorageMonitoring] System catalog query failed, using approximate fallback");
      try {
        const [tradeCount, userCount, auditCount, disputeCount] = await Promise.all([
          this.db.trade.count().catch(() => 0),
          this.db.user.count().catch(() => 0),
          this.db.auditLog.count().catch(() => 0),
          this.db.dispute.count().catch(() => 0),
        ]);

        tableStats.push(
          { tableName: "Trade", rowCount: tradeCount, totalSizeBytes: tradeCount * 1024 },
          { tableName: "User", rowCount: userCount, totalSizeBytes: userCount * 512 },
          { tableName: "AuditLog", rowCount: auditCount, totalSizeBytes: auditCount * 1024 },
          { tableName: "Dispute", rowCount: disputeCount, totalSizeBytes: disputeCount * 768 },
        );

        databaseSizeBytes = tableStats.reduce((acc, t) => acc + t.totalSizeBytes, 0);
        this.metricsService.recordDatabaseSize(databaseSizeBytes);
      } catch (fallbackErr) {
        appLogger.warn({ fallbackErr }, "[StorageMonitoring] Fallback counting also failed");
      }
    }

    const archiveStats = this.getArchiveStorageStats();
    const collectedAt = new Date().toISOString();

    const snapshot: StorageSnapshot = {
      databaseSizeBytes,
      tables: tableStats,
      archiveStorageSizeBytes: archiveStats.totalBytes,
      archiveFilesCount: archiveStats.fileCount,
      collectedAt,
    };

    appLogger.info(
      {
        databaseSizeBytes,
        tablesCount: tableStats.length,
        archiveStorageSizeBytes: archiveStats.totalBytes,
      },
      "[StorageMonitoring] Storage metrics collected",
    );

    return snapshot;
  }
}

export const storageMonitoringService = new StorageMonitoringService();
