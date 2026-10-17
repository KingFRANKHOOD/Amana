import { HttpError } from "../errors/httpError";
import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { IPFSService, ServiceUnavailableError } from "./ipfs.service";
import { getAdminAllowlistLowercase } from "../lib/accessControl";
import { env } from "../config/env";

export class EvidenceAccessDeniedError extends HttpError {
  status = 403;
  constructor() {
    super("Access denied: you are not a party to this trade");
    this.name = "EvidenceAccessDeniedError";
  }
}

export class EvidenceTradeNotFoundError extends HttpError {
  status = 404;
  constructor() {
    super("Trade not found");
    this.name = "EvidenceTradeNotFoundError";
  }
}

export class EvidenceValidationError extends HttpError {
  status = 400;
  constructor(message = "Invalid evidence file") {
    super(message);
    this.name = "EvidenceValidationError";
  }
}

export class EvidenceScanError extends HttpError {
  status = 503;
  constructor(message = "Evidence scan service unavailable") {
    super(message);
    this.name = "EvidenceScanError";
  }
}

export interface EvidenceScanResult {
  clean: boolean;
  reason?: string;
}

export interface EvidenceScanner {
  scan(file: Express.Multer.File): Promise<EvidenceScanResult>;
}

class NoopEvidenceScanner implements EvidenceScanner {
  async scan(): Promise<EvidenceScanResult> {
    return { clean: true };
  }
}

/**
 * FailClosedEvidenceScanner is used in production/staging when
 * EVIDENCE_SCAN_REQUIRED is true but no real scanner is injected.
 * It rejects every file rather than silently passing them through.
 */
class FailClosedEvidenceScanner implements EvidenceScanner {
  async scan(): Promise<EvidenceScanResult> {
    throw new EvidenceScanError(
      "Evidence scanning is required but no scanner is configured. " +
        "Inject a real EvidenceScanner or set EVIDENCE_SCAN_REQUIRED=false for development.",
    );
  }
}

function buildDefaultScanner(): EvidenceScanner {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const required =
    process.env.EVIDENCE_SCAN_REQUIRED !== undefined
      ? process.env.EVIDENCE_SCAN_REQUIRED.toLowerCase() === "true"
      : env.EVIDENCE_SCAN_REQUIRED;
  // In production/staging the noop scanner is not safe — use fail-closed
  // so an operator misconfiguration surfaces immediately rather than
  // silently allowing unscanned files.
  if (required && nodeEnv !== "development" && nodeEnv !== "test") {
    return new FailClosedEvidenceScanner();
  }
  return new NoopEvidenceScanner();
}

function getEvidenceMetadataRetentionDays(): number {
  return env.EVIDENCE_METADATA_RETENTION_DAYS;
}

function isEvidenceMetadataExpired(createdAt: Date): boolean {
  const retentionMs = getEvidenceMetadataRetentionDays() * 24 * 60 * 60 * 1000;
  return Date.now() - createdAt.getTime() > retentionMs;
}

/**
 * Strict CID (v0/v1) format validation. Rejects anything that is not a
 * well-formed IPFS CID so malformed input cannot be used to probe the
 * gateway or bypass record resolution.
 */
export function isValidCid(cid: string): boolean {
  if (typeof cid !== "string") return false;
  // CIDv0: base58btc, always starts with "Qm", 46 chars total.
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid)) return true;
  // CIDv1: multibase prefix (b/B/z/f) followed by base-encoded multihash.
  if (/^[bBzZfF][1-9A-HJ-NP-Za-km-z]{20,}$/.test(cid)) return true;
  return false;
}

type EvidenceDatabase = {
  trade: Pick<PrismaClient["trade"], "findUnique">;
  tradeEvidence: Pick<
    PrismaClient["tradeEvidence"],
    "findMany" | "create" | "findFirst"
  >;
};

export class EvidenceService {
  private ipfs: IPFSService;
  private scanner: EvidenceScanner;
  /** In-process cache: CID → resolved gateway URL */
  private readonly urlCache = new Map<string, string>();
  /** In-process gateway circuit state. */
  private readonly gatewayCircuit = new Map<
    string,
    { failures: number; openUntil: number }
  >();

  constructor(
    private readonly prisma: EvidenceDatabase = defaultPrisma as unknown as EvidenceDatabase,
    ipfs?: IPFSService,
    scanner?: EvidenceScanner,
  ) {
    this.ipfs = ipfs ?? new IPFSService();
    this.scanner = scanner ?? buildDefaultScanner();
  }

  /** Return all evidence records for a trade. Caller must be buyer or seller. */
  async getEvidenceByTradeId(tradeId: string, callerAddress: string) {
    const trade = await this.prisma.trade.findUnique({
      where: { tradeId },
    });

    if (!trade) throw new EvidenceTradeNotFoundError();

    const caller = callerAddress.toLowerCase();
    const isAdmin = getAdminAllowlistLowercase().has(caller);
    if (
      trade.buyerAddress.toLowerCase() !== caller &&
      trade.sellerAddress.toLowerCase() !== caller &&
      !isAdmin
    ) {
      throw new EvidenceAccessDeniedError();
    }

    const records = await this.prisma.tradeEvidence.findMany({
      where: { tradeId },
      orderBy: { createdAt: "asc" },
    });

    return records.map((r) => {
      const retentionExpired = isEvidenceMetadataExpired(r.createdAt);
      return {
        id: r.id,
        cid: retentionExpired ? "redacted" : r.cid,
        filename: retentionExpired ? "redacted" : r.filename,
        mimeType: r.mimeType,
        uploadedBy: retentionExpired && !isAdmin ? "redacted" : r.uploadedBy,
        url: retentionExpired ? null : this.resolveGatewayUrl(r.cid),
        createdAt: r.createdAt,
        retentionExpired,
      };
    });
  }

  /**
   * Resolve a CID to its TradeEvidence record and enforce that the caller is
   * a party (buyer/seller) to the associated trade or an allowlisted admin.
   * Mirrors the authorization performed by getEvidenceByTradeId so the stream
   * route cannot be used as an IDOR to read another trade's evidence.
   */
  async authorizeEvidenceAccess(cid: string, callerAddress: string) {
    if (!isValidCid(cid)) {
      throw new EvidenceValidationError("Invalid CID format");
    }

    const record = await this.prisma.tradeEvidence.findFirst({
      where: { cid },
    });
    if (!record) throw new EvidenceTradeNotFoundError();

    const trade = await this.prisma.trade.findUnique({
      where: { tradeId: record.tradeId },
    });
    if (!trade) throw new EvidenceTradeNotFoundError();

    const caller = callerAddress.toLowerCase();
    const isAdmin = getAdminAllowlistLowercase().has(caller);
    if (
      trade.buyerAddress.toLowerCase() !== caller &&
      trade.sellerAddress.toLowerCase() !== caller &&
      !isAdmin
    ) {
      throw new EvidenceAccessDeniedError();
    }

    return record;
  }

  /**
   * Upload a video file to IPFS and persist the evidence record.
   * Caller must be buyer or seller of the referenced trade.
   */
  async uploadVideoEvidence(
    tradeId: string,
    callerAddress: string,
    file: Express.Multer.File,
  ) {
    const trade = await this.prisma.trade.findUnique({ where: { tradeId } });
    if (!trade) throw new EvidenceTradeNotFoundError();

    const caller = callerAddress.toLowerCase();
    if (
      trade.buyerAddress.toLowerCase() !== caller &&
      trade.sellerAddress.toLowerCase() !== caller
    ) {
      throw new EvidenceAccessDeniedError();
    }

    // Validate declared mime type
    const allowed = ["video/mp4", "video/webm"];
    if (!allowed.includes(file.mimetype)) {
      throw new EvidenceValidationError("Unsupported file type");
    }

    // Validate mime by magic bytes to prevent spoofed content-type uploads.
    const sniffed = this.sniffMimeType(file.buffer);
    if (!sniffed || sniffed !== file.mimetype) {
      throw new EvidenceValidationError(
        "File content does not match declared MIME type",
      );
    }

    // Enforce configurable size limit (default 50MB)
    const size = (file as any).size ?? file.buffer.length;
    const MAX = env.EVIDENCE_MAX_BYTES;
    if (size > MAX) {
      throw new EvidenceValidationError("File too large");
    }

    const scan = await this.runEvidenceScan(file);
    if (!scan.clean) {
      throw new EvidenceValidationError(
        scan.reason || "Evidence blocked by malware scanner",
      );
    }

    const cid = await this.ipfs.uploadFile(file.buffer, file.originalname);

    const record = await this.prisma.tradeEvidence.create({
      data: {
        tradeId,
        cid,
        filename: file.originalname,
        mimeType: file.mimetype,
        uploadedBy: caller,
      },
    });

    return {
      evidenceId: record.id,
      cid,
      ipfsUrl: this.resolveGatewayUrl(cid),
    };
  }

  /**
   * Proxy-stream a file from the IPFS gateway with optional Range support.
   * Returns an axios response stream so the route can pipe it.
   *
   * When a callerAddress is supplied, the CID is resolved to its
   * TradeEvidence record and the caller must be a party to the trade (or an
   * allowlisted admin) before any bytes are fetched from the gateway.
   */
  async streamFromIPFS(cid: string, range?: string, callerAddress?: string) {
    if (callerAddress !== undefined) {
      await this.authorizeEvidenceAccess(cid, callerAddress);
    }

    // Build list of gateway base URLs to try. Prefer explicit env var list.
    const urls = this.resolveGatewayUrls(cid);

    const headers: Record<string, string> = {};
    if (range) headers["Range"] = range;

    const timeoutMs = env.IPFS_STREAM_TIMEOUT_MS;

    let lastError: any = null;
    for (const url of urls) {
      if (this.isGatewayCircuitOpen(url)) {
        continue;
      }

      try {
        const response = await axios.get(url, {
          responseType: "stream",
          headers,
          timeout: timeoutMs,
          validateStatus: (s) => s < 500,
        });
        this.onGatewaySuccess(url);
        return response;
      } catch (err) {
        lastError = err;
        this.onGatewayFailure(url);
      }
    }

    if (lastError) {
      throw new ServiceUnavailableError();
    }
    throw new ServiceUnavailableError();
  }

  /** Resolve and cache the public gateway URL for

/* … truncated 3704 chars — edit only what you need near the top … */
