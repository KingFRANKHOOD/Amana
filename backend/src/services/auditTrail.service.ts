import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { prisma as defaultPrisma } from "../lib/db";
import { TOKEN_CONFIG } from "../config/token";

export type TradeEventType =
    | "CREATED"
    | "FUNDED"
    | "MANIFEST_SUBMITTED"
    | "VIDEO_SUBMITTED"
    | "DELIVERY_CONFIRMED"
    | "DISPUTE_INITIATED"
    | "EVIDENCE_SUBMITTED"
    | "RESOLVED"
    | "COMPLETED";

export interface TradeEvent {
    eventType: TradeEventType;
    timestamp: Date;
    actor: string;
    metadata: Record<string, unknown>;
}

export interface AuditIntegrityMetadata {
    algorithm: "ed25519";
    keyId: string;
    payloadHash: string;
    signature: string;
}

export interface CanonicalAuditPayload {
    tradeId: string;
    generatedAt: string;
    events: Array<{
        eventType: TradeEventType;
        timestamp: string;
        actor: string;
        metadata: Record<string, unknown>;
    }>;
}

export class AuditTrailAccessDeniedError extends Error {
    status = 403;
    constructor() {
        super("Access denied: you are not a party to this trade");
        this.name = "AuditTrailAccessDeniedError";
    }
}

export class AuditTrailTradeNotFoundError extends Error {
    status = 404;
    constructor() {
        super("Trade not found");
        this.name = "AuditTrailTradeNotFoundError";
    }
}

export class AuditSigningConfigError extends Error {
    status = 500;
    constructor(message = "Audit signing configuration is invalid") {
        super(message);
        this.name = "AuditSigningConfigError";
    }
}

type AuditDatabase = {
    trade: Pick<PrismaClient["trade"], "findUnique">;
    tradeEvidence: Pick<PrismaClient["tradeEvidence"], "findMany">;
    deliveryManifest: Pick<PrismaClient["deliveryManifest"], "findUnique">;
    dispute: Pick<PrismaClient["dispute"], "findUnique">;
};

/** Shape of a Trade row as used by the audit service. */
interface AuditTrade {
    tradeId: string;
    buyerAddress: string;
    sellerAddress: string;
    amountUsdc: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    /** Canonical timestamp written once when the trade transitions to FUNDED. */
    fundedAt: Date | null;
    /** Canonical timestamp written once when the trade transitions to DELIVERED. */
    deliveredAt: Date | null;
    /** Canonical timestamp written once when the trade transitions to COMPLETED. */
    completedAt: Date | null;
}

function parseAdminPubkeys(): Set<string> {
    const raw = process.env.ADMIN_STELLAR_PUBKEYS ?? "";
    return new Set(
        raw
            .split(",")
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean),
    );
}

function getEvidenceMetadataRetentionDays(): number {
    const parsed = parseInt(process.env.EVIDENCE_METADATA_RETENTION_DAYS || "90", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 90;
}

function isEvidenceMetadataExpired(createdAt: Date): boolean {
    const retentionMs = getEvidenceMetadataRetentionDays() * 24 * 60 * 60 * 1000;
    return Date.now() - createdAt.getTime() > retentionMs;
}

function maskVehicleRegistration(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length <= 3) return "***";
    return `${trimmed.slice(0, 3)}***`;
}

export class AuditTrailService {
    constructor(private readonly prisma: AuditDatabase = defaultPrisma as unknown as AuditDatabase) { }

    async getTradeHistory(tradeId: string, callerAddress: string): Promise<TradeEvent[]> {
        const trade = await this.prisma.trade.findUnique({
            where: { tradeId },
        }) as AuditTrade | null;

        if (!trade) throw new AuditTrailTradeNotFoundError();

        const caller = callerAddress.toLowerCase();
        const isBuyer = trade.buyerAddress.toLowerCase() === caller;
        const isSeller = trade.sellerAddress.toLowerCase() === caller;
        const isAdmin = parseAdminPubkeys().has(caller);

        // Fetch dispute early — needed for both mediator access check and event assembly
        const dispute = await this.prisma.dispute.findUnique({ where: { tradeId } });

        // Check mediator access: any caller who is neither buyer nor seller is allowed
        // only when a dispute exists (mediator context). A stricter implementation would
        // query a dedicated mediator registry; this matches the current schema.
        const isMediator = !isBuyer && !isSeller && dispute !== null;

        if (!isBuyer && !isSeller && !isMediator && !isAdmin) {
            throw new AuditTrailAccessDeniedError();
        }

        const events: TradeEvent[] = [];

        // CREATED event — from trade.createdAt
        events.push({
            eventType: "CREATED",
            timestamp: trade.createdAt,
            actor: trade.buyerAddress,
            metadata: { 
                amount: trade.amountUsdc, 
                symbol: TOKEN_CONFIG.symbol,
                amountUsdc: trade.amountUsdc // Legacy
            },
        });

        // FUNDED — use canonical fundedAt; fall back to updatedAt for rows that
        // pre-date the AUDIT-001 migration (fundedAt will be null on those rows).
        if (
            ["FUNDED", "DELIVERED", "COMPLETED", "DISPUTED", "CANCELLED"].includes(trade.status)
        ) {
            events.push({
                eventType: "FUNDED",
                timestamp: trade.fundedAt ?? trade.updatedAt,
                actor: trade.buyerAddress,
                metadata: {},
            });
        }

        // MANIFEST_SUBMITTED
        const manifest = await this.prisma.deliveryManifest.findUnique({
            where: { tradeId },
        });
        if (manifest) {
            events.push({
                eventType: "MANIFEST_SUBMITTED",
                timestamp: manifest.createdAt,
                actor: trade.sellerAddress,
                metadata: {
                    vehicleRegistration: isAdmin
                        ? manifest.vehicleRegistration
                        : maskVehicleRegistration(manifest.vehicleRegistration),
                    expectedDeliveryAt: manifest.expectedDeliveryAt,
                },
            });
        }

        // EVIDENCE_SUBMITTED — one event per evidence record
        const evidenceRecords = await this.prisma.tradeEvidence.findMany({
            where: { tradeId },
            orderBy: { createdAt: "asc" },
        });
        for (const ev of evidenceRecords) {
            const isVideo = ev.mimeType.startsWith("video/");
            const expired = isEvidenceMetadataExpired(ev.createdAt);
            events.push({
                eventType: isVideo ? "VIDEO_SUBMITTED" : "EVIDENCE_SUBMITTED",
                timestamp: ev.createdAt,
                actor: expired && !isAdmin ? "redacted" : ev.uploadedBy,
                metadata: {
                    mimeType: ev.mimeType,
                    cid: expired ? "redacted" : ev.cid,
                    filename: expired ? "redacted" : ev.filename,
                    retentionExpired: expired,
                },
            });
        }

        // DELIVERY_CONFIRMED — use canonical deliveredAt; fall back to updatedAt for legacy rows.
        if (["DELIVERED", "COMPLETED"].includes(trade.status)) {
            events.push({
                eventType: "DELIVERY_CONFIRMED",
                timestamp: trade.deliveredAt ?? trade.updatedAt,
                actor: trade.buyerAddress,
                metadata: {},
            });
        }

        // DISPUTE_INITIATED / RESOLVED
        if (dispute) {
            events.push({
                eventType: "DISPUTE_INITIATED",
                timestamp: dispute.createdAt,
                actor: dispute.initiator,
                metadata: { reason: dispute.reason },
            });

            if (dispute.resolvedAt) {
                events.push({
                    eventType: "RESOLVED",
                    timestamp: dispute.resolvedAt,
                    actor: dispute.initiator,
                    metadata: { disputeStatus: dispute.status },
                });
            }
        }

        // COMPLETED — use canonical completedAt; fall back to updatedAt for legacy rows.
        if (trade.status === "COMPLETED") {
            events.push({
                eventType: "COMPLETED",
                timestamp: trade.completedAt ?? trade.updatedAt,
                actor: trade.sellerAddress,
                metadata: {},
            });
        }

        // Sort chronologically
        events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        return events;
    }

    getCanonicalPayload(tradeId: string, events: TradeEvent[]): CanonicalAuditPayload {
        return {
            tradeId,
            generatedAt: new Date().toISOString(),
            events: events.map((event) => ({
                eventType: event.eventType,
                timestamp: event.timestamp.toISOString(),
                actor: event.actor,
                metadata: event.metadata,
            })),
        };
    }

    signPayload(payload: CanonicalAuditPayload): AuditIntegrityMetadata {
        const keyId = process.env.AUDIT_SIGNING_KEY_ID;
        const privateKeyPem = process.env.AUDIT_SIGNING_PRIVATE_KEY_PEM;

        if (!keyId || !privateKeyPem) {
            throw new AuditSigningConfigError("AUDIT_SIGNING_KEY_ID and AUDIT_SIGNING_PRIVATE_KEY_PEM are required");
        }

        const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
        const payloadHash = crypto.createHash("sha256").update(payloadBytes).digest("hex");
        const privateKey = crypto.createPrivateKey(privateKeyPem);
        const signature = crypto.sign(null, payloadBytes, privateKey).toString("base64");

        return {
            algorithm: "ed25519",
            keyId,
            payloadHash,
            signature,
        };
    }

    verifyPayload(payload: CanonicalAuditPayload, signatureBase64: string): boolean {
        const publicKeyPem = process.env.AUDIT_SIGNING_PUBLIC_KEY_PEM;
        if (!publicKeyPem) {
            throw new AuditSigningConfigError("AUDIT_SIGNING_PUBLIC_KEY_PEM is required");
        }

        const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
        const signature = Buffer.from(signatureBase64, "base64");
        const publicKey = crypto.createPublicKey(publicKeyPem);
        return crypto.verify(null, payloadBytes, publicKey, signature);
    }
}
