import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { IPFSService, PinVerificationResult } from "./ipfs.service";
import { appLogger } from "../middleware/logger";

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

export interface VerificationReport {
  totalChecked: number;
  pinnedCount: number;
  missingCount: number;
  errorCount: number;
  missingPins: EvidenceVerificationRecord[];
  errors: EvidenceVerificationRecord[];
  checkedAt: Date;
  durationMs: number;
}

export interface RepairResult {
  evidenceId: number;
  cid: string;
  success: boolean;
  error?: string;
}

type EvidenceDatabase = {
  tradeEvidence: Pick<
    PrismaClient["tradeEvidence"],
    "findMany" | "update"
  >;
};

export class EvidenceVerificationService {
  private ipfs: IPFSService;
  private batchSize: number;

  constructor(
    private readonly prisma: EvidenceDatabase = defaultPrisma as unknown as EvidenceDatabase,
    ipfs?: IPFSService,
    batchSize?: number,
  ) {
    this.ipfs = ipfs ?? new IPFSService();
    this.batchSize = batchSize ?? 50;
  }

  /**
   * Run a full verification pass over all evidence records.
   * Checks each CID against Pinata and returns a structured report.
   */
  async verifyAll(): Promise<VerificationReport> {
    const startTime = Date.now();
    appLogger.info("[EvidenceVerification] Starting full verification pass");

    const allEvidence = await this.prisma.tradeEvidence.findMany({
      orderBy: { createdAt: "asc" },
    });

    const missingPins: EvidenceVerificationRecord[] = [];
    const errors: EvidenceVerificationRecord[] = [];
    let pinnedCount = 0;

    const uniqueCids = [...new Set(allEvidence.map((e: { cid: string }) => e.cid))];
    appLogger.info(
      { totalRecords: allEvidence.length, uniqueCids: uniqueCids.length },
      "[EvidenceVerification] Checking CIDs against Pinata",
    );

    const cidResults = new Map<string, PinVerificationResult>();
    for (let i = 0; i < uniqueCids.length; i += this.batchSize) {
      const batch = uniqueCids.slice(i, i + this.batchSize);
      const results = await Promise.all(
        batch.map((cid: string) => this.ipfs.verifyPin(cid)),
      );
      for (const result of results) {
        cidResults.set(result.cid, result);
      }
    }

    for (const record of allEvidence) {
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
      } else if (pinResult.pinned) {
        pinnedCount++;
      } else {
        missingPins.push(enriched);
      }
    }

    const durationMs = Date.now() - startTime;

    const report: VerificationReport = {
      totalChecked: allEvidence.length,
      pinnedCount,
      missingCount: missingPins.length,
      errorCount: errors.length,
      missingPins,
      errors,
      checkedAt: new Date(),
      durationMs,
    };

    appLogger.info(
      {
        totalChecked: report.totalChecked,
        pinned: report.pinnedCount,
        missing: report.missingCount,
        errors: report.errorCount,
        durationMs,
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
