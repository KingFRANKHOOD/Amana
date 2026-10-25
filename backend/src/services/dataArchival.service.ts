import fs from "fs";
import path from "path";
import crypto from "crypto";
import zlib from "zlib";
import { PrismaClient, TradeStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { appLogger } from "../middleware/logger";
import { runtimeEnvValue } from "../config/env";

export interface ArchiveMetadata {
  archiveId: string;
  entityType: "trades" | "audit_logs" | "manifests";
  generatedAt: string;
  recordCount: number;
  dateRange: {
    from: string;
    to: string;
  };
  checksumSha256: string;
  compressed: boolean;
  filePath: string;
}

export interface ArchiveResult {
  archiveId: string;
  entityType: string;
  recordCount: number;
  filePath: string;
  checksumSha256: string;
  durationMs: number;
}

export interface ArchivedTradeQuery {
  tradeId: string;
  archiveId?: string;
}

export class DataArchivalService {
  private readonly storageDir: string;

  constructor(
    private readonly db: PrismaClient = defaultPrisma,
    customStorageDir?: string,
  ) {
    const configuredPath = customStorageDir ?? runtimeEnvValue("ARCHIVE_STORAGE_PATH") ?? "./data/archives";
    this.storageDir = path.resolve(process.cwd(), configuredPath);
    this.ensureDirectoryExists(this.storageDir);
  }

  private ensureDirectoryExists(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private computeSha256(data: Buffer | string): string {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /**
   * Archive closed (COMPLETED / CANCELLED) trades older than the threshold window.
   */
  async archiveColdTrades(thresholdDays?: number): Promise<ArchiveResult | null> {
    const startTime = Date.now();
    const days = thresholdDays ?? runtimeEnvValue("TRADE_ARCHIVAL_THRESHOLD_DAYS") ?? 180;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    appLogger.info({ cutoff, days }, "[DataArchival] Querying cold trades for archival");

    const trades = await this.db.trade.findMany({
      where: {
        status: {
          in: [TradeStatus.COMPLETED, TradeStatus.CANCELLED],
        },
        updatedAt: { lt: cutoff },
      },
      include: {
        dispute: true,
        manifest: true,
        evidence: true,
        notes: true,
        releaseMilestones: true,
      },
      orderBy: { createdAt: "asc" },
      take: 500, // Process in safe batches
    });

    if (trades.length === 0) {
      appLogger.info("[DataArchival] No cold trades eligible for archival");
      return null;
    }

    const archiveId = `trades_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const tradesDir = path.join(this.storageDir, "trades");
    this.ensureDirectoryExists(tradesDir);

    const dates = trades.map((t) => t.createdAt.getTime());
    const minDate = new Date(Math.min(...dates)).toISOString();
    const maxDate = new Date(Math.max(...dates)).toISOString();

    const archivePayload = {
      archiveId,
      entityType: "trades" as const,
      generatedAt: new Date().toISOString(),
      recordCount: trades.length,
      dateRange: { from: minDate, to: maxDate },
      records: trades,
    };

    const rawJson = JSON.stringify(archivePayload, null, 2);
    const checksumSha256 = this.computeSha256(rawJson);

    // Write compressed gzip archive
    const gzipped = zlib.gzipSync(rawJson);
    const fileName = `${archiveId}.json.gz`;
    const filePath = path.join(tradesDir, fileName);
    fs.writeFileSync(filePath, gzipped);

    // Write accompanying metadata manifest
    const metadata: ArchiveMetadata = {
      archiveId,
      entityType: "trades",
      generatedAt: archivePayload.generatedAt,
      recordCount: trades.length,
      dateRange: { from: minDate, to: maxDate },
      checksumSha256,
      compressed: true,
      filePath,
    };

    const metaPath = path.join(tradesDir, `${archiveId}.meta.json`);
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    const durationMs = Date.now() - startTime;
    appLogger.info(
      { archiveId, recordCount: trades.length, filePath, checksumSha256, durationMs },
      "[DataArchival] Cold trades successfully archived",
    );

    return {
      archiveId,
      entityType: "trades",
      recordCount: trades.length,
      filePath,
      checksumSha256,
      durationMs,
    };
  }

  /**
   * Verify integrity of an archive bundle against its SHA-256 checksum.
   */
  verifyArchive(archiveId: string, entityType: "trades" | "audit_logs" = "trades"): {
    isValid: boolean;
    recordCount: number;
    checksumMatch: boolean;
    error?: string;
  } {
    try {
      const dir = path.join(this.storageDir, entityType);
      const metaPath = path.join(dir, `${archiveId}.meta.json`);
      const dataPath = path.join(dir, `${archiveId}.json.gz`);

      if (!fs.existsSync(metaPath) || !fs.existsSync(dataPath)) {
        return { isValid: false, recordCount: 0, checksumMatch: false, error: "Archive files not found" };
      }

      const meta: ArchiveMetadata = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      const gzipped = fs.readFileSync(dataPath);
      const decompressed = zlib.gunzipSync(gzipped).toString("utf-8");
      const computedChecksum = this.computeSha256(decompressed);

      const checksumMatch = computedChecksum === meta.checksumSha256;
      return {
        isValid: checksumMatch,
        recordCount: meta.recordCount,
        checksumMatch,
      };
    } catch (error) {
      return {
        isValid: false,
        recordCount: 0,
        checksumMatch: false,
        error: error instanceof Error ? error.message : "Unknown verification error",
      };
    }
  }

  /**
   * Search and retrieve an archived trade by tradeId from archival storage.
   */
  findArchivedTrade(tradeId: string): Record<string, unknown> | null {
    const tradesDir = path.join(this.storageDir, "trades");
    if (!fs.existsSync(tradesDir)) return null;

    const files = fs.readdirSync(tradesDir).filter((f) => f.endsWith(".json.gz"));

    for (const file of files) {
      try {
        const filePath = path.join(tradesDir, file);
        const gzipped = fs.readFileSync(filePath);
        const decompressed = zlib.gunzipSync(gzipped).toString("utf-8");
        const payload = JSON.parse(decompressed);

        if (Array.isArray(payload.records)) {
          const match = payload.records.find((r: { tradeId?: string }) => r.tradeId === tradeId);
          if (match) return match;
        }
      } catch (err) {
        appLogger.warn({ file, err }, "[DataArchival] Failed to inspect archive file");
      }
    }

    return null;
  }

  /**
   * List all available archives with metadata.
   */
  listArchives(): ArchiveMetadata[] {
    const results: ArchiveMetadata[] = [];
    const entityTypes = ["trades", "audit_logs"];

    for (const entity of entityTypes) {
      const dir = path.join(this.storageDir, entity);
      if (!fs.existsSync(dir)) continue;

      const metaFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".meta.json"));
      for (const metaFile of metaFiles) {
        try {
          const content = fs.readFileSync(path.join(dir, metaFile), "utf-8");
          results.push(JSON.parse(content));
        } catch {
          // ignore corrupted metadata files
        }
      }
    }

    return results.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
  }
}

export const dataArchivalService = new DataArchivalService();
