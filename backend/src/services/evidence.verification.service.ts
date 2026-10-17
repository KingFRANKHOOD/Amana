import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { env } from "../config/env";
import { IPFSService, PinVerificationResult } from "./ipfs.service";
import { appLogger } from "../middleware/logger";
import { recordEvidenceVerificationBatch } from "../lib/metrics";

export interface EvidenceVerificationRecord {
  evidenceId: number;
  tradeId: string;
  cid: string;
  filename: string;
  mimeType: string;
  uploadedBy: string;
  createdAt: Date;
  pinResult: PinVerificationResult;
}

/** Per-batch processing metrics, useful for spotting slow or flaky batches. */
export interface BatchMetrics {
  batchNumber: number;
  recordCount: number;
  uniqueCidCount: number;
  durationMs: number;
  /** Number of extra verification attempts spent retrying transient failures. */
  retries: number;
  /** CIDs still failing with a transient error after all retries were spent. */
  failedCidCount: number;
}

/** Aggregate performance summary across every batch in a run. */
export interface VerificationPerformance {
  batchCount: number;
  batchesWithRetries: number;
  totalRetries: number;
  avgBatchMs: number;
  minBatchMs: number;
  maxBatchMs: number;
  recordsPerSecond: number;
}

/** Emitted after each batch so callers can surface progress for long runs. */
export interface VerificationProgress {
  batchNumber: number;
  processedRecords: number;
  /** Total records to check, or `null` when the datastore cannot be counted. */
  totalRecords: number | null;
  pinnedCount: number;
  missingCount: number;
  errorCount: number;
  batchDurationMs: number;
}

export interface VerifyAllOptions {
  /** Override the configured batch size for this run. */
  batchSize?: number;
  /** Max retry attempts per batch for transient pin-check failures. */
  maxRetries?: number;
  /** Invoked after every batch with cumulative progress. */
  onProgress?: (progress: VerificationProgress) => void | Promise<void>;
  /** Injectable delay, primarily for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface VerificationReport {
  totalChecked: number;
  pinnedCount: number;
  missingCount: number;
  errorCount: number;
  missingPins: EvidenceVerificationRecord[];
  errors: EvidenceVerificationRecord[];
  checkedAt: Date;
  durationMs: number;
  /** Number of database pages processed. */
  batchCount: number;
  batchMetrics: BatchMetrics[];
  performance: VerificationPerformance;
}

export interface RepairResult {
  evidenceId: number;
  cid: string;
  success: boolean;
  error?: string;
}

type EvidenceRow = {
  id: number;
  tradeId: string;
  cid: string;
  filename: string;
  mimeType: string;
  uploadedBy: string;
  createdAt: Date;
};

type EvidenceDatabase = {
  tradeEvidence: Pick<
    PrismaClient["tradeEvidence"],
    "findMany" | "update"
  > &
    Partial<Pick<PrismaClient["tradeEvidence"], "count">>;
};

const DEFAULT_RETRY_BACKOFF_MS = 1_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A pin check never throws — it resolves with `{ pinned: false, error }` on
 * failure. Retry only errors that look transient (network, timeout, rate
 * limiting, circuit breaker); a permanent misconfiguration will not fix itself.
 */
function isTransientPinError(result: PinVerificationResult): boolean {
  if (result.pinned || !result.error) return false;
  const message = result.error.toLowerCase();
  if (message.includes("not configured")) return false;
  if (message.includes("no verification result")) return false;
  return true;
}

function summarizePerformance(
  batchMetrics: BatchMetrics[],
  processedRecords: number,
  durationMs: number,
): VerificationPerformance {
  const durations = batchMetrics.map((b) => b.durationMs);
  const totalRetries = batchMetrics.reduce((sum, b) => sum + b.retries, 0);
  return {
    batchCount: batchMetrics.length,
    batchesWithRetries: batchMetrics.filter((b) => b.retries > 0).length,
    totalRetries,
    avgBatchMs:
      durations.length > 0
        ? durations.reduce((sum, d) => sum + d, 0) / durations.length
        : 0,
    minBatchMs: durations.length > 0 ? Math.min(...durations) : 0,
    maxBatchMs: durations.length > 0 ? Math.max(...durations) : 0,
    recordsPerSecond:
      durationMs > 0 ? (processedRecords / durationMs) * 1000 : 0,
  };
}

export class EvidenceVerificationService {
  private ipfs: IPFSService;
  private batchSize: number;
  private maxRetries: number;
  private retryBackoffMs: number;

  constructor(
    private readonly prisma: EvidenceDatabase = defaultPrisma as unknown as EvidenceDatabase,
    ipfs?: IPFSService,
    batchSize?: number,
    options?: { maxRetries?: number; retryBackoffMs?: number },
  ) {
    this.ipfs = ipfs ?? new IPFSService();
    this.batchSize =
      batchSize ?? env.EVIDENCE_PIN_VERIFICATION_BATCH_SIZE ?? 50;
    this.maxRetries =
      options?.maxRetries ??
      env.EVIDENCE_PIN_VERIFICATION_MAX_RETRIES ??
      3;
    this.retryBackoffMs =
      options?.retryBackoffMs ??
      env.EVIDENCE_PIN_VERIFICATION_RETRY_BACKOFF_MS ??
      DEFAULT_RETRY_BACKOFF_MS;
  }

  /**
   * Run a full verification pass over all evidence records.
   *
   * Evidence is streamed from the database one page at a time (cursor
   * pagination) so memory stays flat regardless of dataset size. Each page:
   *   - de-duplicates CIDs and checks them against Pinata,
   *   - retries transient pin-check failures with backoff,
   *   - records timing/retry metrics and reports progress.
   */
  async verifyAll(options: VerifyAllOptions = {}): Promise<VerificationReport> {
    const startTime = Date.now();
    const batchSize = Math.max(1, options.batchSize ?? this.batchSize);
    const maxRetries = Math.max(0, options.maxRetries ?? this.maxRetries);
    const sleep = options.sleep ?? defaultSleep;

    const totalRecords = await this.countEvidence();

    appLogger.info(
      { batchSize, maxRetries, totalRecords },
      "[EvidenceVerification] Starting full verification pass",
    );

    const missingPins: EvidenceVerificationRecord[] = [];
    const errors: EvidenceVerificationRecord[] = [];
    const batchMetrics: BatchMetrics[] = [];
    let pinnedCount = 0;
    let processedRecords = 0;
    let cursorId: number | undefined;
    let batchNumber = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = (await this.prisma.tradeEvidence.findMany({
        orderBy: { id: "asc" },
        take: batchSize,
        ...(cursorId !== undefined
          ? { cursor: { id: cursorId }, skip: 1 }
          : {}),
      })) as EvidenceRow[];

      if (page.length === 0) break;

      batchNumber += 1;
      cursorId = page[page.length - 1]!.id;
      const batchStart = Date.now();

      const uniqueCids = [...new Set(page.map((e) => e.cid))];
      const { results: cidResults, retries } = await this.verifyCidBatch(
        uniqueCids,
        maxRetries,
        sleep,
      );

      let failedCidCount = 0;
      for (const record of page) {
        const pinResult = cidResults.get(record.cid) ?? {
          pinned: false,
          cid: record.cid,
          error: "No verification result",
        };

        const enriched: EvidenceVerificationRecord = {
          evidenceId: record.id,
          tradeId: record.tradeId,
          cid: record.cid,
          filename: record.filename,
          mimeType: record.mimeType,
          uploadedBy: record.uploadedBy,
          createdAt: record.createdAt,
          pinResult,
        };

        if (pinResult.error && !pinResult.pinned) {
          errors.push(enriched);
          if (isTransientPinError(pinResult)) failedCidCount += 1;
        } else if (pinResult.pinned) {
          pinnedCount++;
        } else {
          missingPins.push(enriched);
        }
      }

      processedRecords += page.length;
      const batchDurationMs = Date.now() - batchStart;

      const metric: BatchMetrics = {
        batchNumber,
        recordCount: page.length,
        uniqueCidCount: uniqueCids.length,
        durationMs: batchDurationMs,
        retries,
        failedCidCount,
      };
      batchMetrics.push(metric);
      recordEvidenceVerificationBatch(metric);

      appLogger.info(
        {
          batchNumber,
          processedRecords,
          totalRecords,
          batchDurationMs,
          retries,
          failedCidCount,
        },
        "[EvidenceVerification] Batch complete",
      );

      if (options.onProgress) {
        await options.onProgress({
          batchNumber,
          processedRecords,
          totalRecords,
          pinnedCount,
          missingCount: missingPins.length,
          errorCount: errors.length,
          batchDurationMs,
        });
      }

      if (page.length < batchSize) break;
    }

    const durationMs = Date.now() - startTime;

    const report: VerificationReport = {
      totalChecked: processedRecords,
      pinnedCount,
      missingCount: missingPins.length,
      errorCount: errors.length,
      missingPins,
      errors,
      checkedAt: new Date(),
      durationMs,
      batchCount: batchNumber,
      batchMetrics,
      performance: summarizePerformance(batchMetrics, processedRecords, durationMs),
    };

    appLogger.info(
      {
        totalChecked: report.totalChecked,
        pinned: report.pinnedCount,
        missing: report.missingCount,
        errors: report.errorCount,
        batchCount: report.batchCount,
        durationMs,
        performance: report.performance,
      },
      "[EvidenceVerification] Verification pass complete",
    );

    if (missingPins.length > 0) {
      appLogger.warn(
        { missingCids: missingPins.map((r) => r.cid) },
        "[EvidenceVerification] Missing pins detected",
      );
    }

    return report;
  }

  /** Count evidence rows, tolerating datastores/mocks without `count()`. */
  private async countEvidence(): Promise<number | null> {
    const counter = this.prisma.tradeEvidence.count;
    if (typeof counter !== "function") return null;
    try {
      return await counter.call(this.prisma.tradeEvidence);
    } catch (err) {
      appLogger.warn(
        { err },
        "[EvidenceVerification] Failed to count evidence; progress totals disabled",
      );
      return null;
    }
  }

  /**
   * Verify a page's unique CIDs against Pinata, retrying only the CIDs whose
   * result looks transiently failed. Returns the merged results plus the number
   * of retry rounds actually spent.
   */
  private async verifyCidBatch(
    uniqueCids: string[],
    maxRetries: number,
    sleep: (ms: number) => Promise<void>,
  ): Promise<{ results: Map<string, PinVerificationResult>; retries: number }> {
    const results = new Map<string, PinVerificationResult>();
    let pending = uniqueCids;
    let retries = 0;

    for (let attempt = 0; ; attempt += 1) {
      const settled = await Promise.all(
        pending.map((cid) => this.ipfs.verifyPin(cid)),
      );
      for (const result of settled) {
        results.set(result.cid, result);
      }

      const stillFailing = settled
        .filter(isTransientPinError)
        .map((r) => r.cid);

      if (stillFailing.length === 0 || attempt >= maxRetries) {
        break;
      }

      retries += 1;
      const delayMs = this.retryBackoffMs * Math.pow(2, attempt);
      appLogger.warn(
        { retryRound: retries, failingCids: stillFailing.length, delayMs },
        "[EvidenceVerification] Retrying transient pin-check failures",
      );
      await sleep(delayMs);
      pending = stillFailing;
    }

    return { results, retries };
  }

  /**
   * Attempt to re-pin missing evidence by fetching the file from the IPFS
   * gateway and re-uploading it to Pinata. This is a best-effort repair
   * that only works if the content is still available via gateway.
   */
  async repairMissingPins(
    missingRecords: EvidenceVerificationRecord[],
  ): Promise<RepairResult[]> {
    const results: RepairResult[] = [];

    for (const record of missingRecords) {
      try {
        appLogger.info(
          { evidenceId: record.evidenceId, cid: record.cid },
          "[EvidenceVerification] Attempting repair",
        );

        const fileBuffer = await this.fetchFromGateway(record.cid);
        if (!fileBuffer) {
          results.push({
            evidenceId: record.evidenceId,
            cid: record.cid,
            success: false,
            error: "File not available on gateway",
          });
          continue;
        }

        const newCid = await this.ipfs.uploadFile(fileBuffer, record.filename);

        if (newCid !== record.cid) {
          appLogger.warn(
            {
              evidenceId: record.evidenceId,
              originalCid: record.cid,
              newCid,
            },
            "[EvidenceVerification] Re-pinned CID mismatch — updating record",
          );
        }

        await this.prisma.tradeEvidence.update({
          where: { id: record.evidenceId },
          data: { cid: newCid },
        });

        results.push({
          evidenceId: record.evidenceId,
          cid: record.cid,
          success: true,
        });

        appLogger.info(
          { evidenceId: record.evidenceId, cid: newCid },
          "[EvidenceVerification] Repair successful",
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        appLogger.error(
          { err, evidenceId: record.evidenceId, cid: record.cid },
          "[EvidenceVerification] Repair failed",
        );
        results.push({
          evidenceId: record.evidenceId,
          cid: record.cid,
          success: false,
          error: message,
        });
      }
    }

    return results;
  }

  /**
   * Fetch a file from the IPFS gateway by CID. Returns the buffer
   * or null if the file is not available.
   */
  private async fetchFromGateway(cid: string): Promise<Buffer | null> {
    try {
      const url = this.ipfs.getFileUrl(cid);
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 30_000,
        validateStatus: (s) => s < 400,
      });
      return Buffer.from(response.data);
    } catch {
      return null;
    }
  }
}
