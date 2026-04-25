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

export class AuditTrailService {
    constructor(private readonly prisma: AuditDatabase = defaultPrisma as unknown as AuditDatabase) { }

    async getTradeHistory(tradeId: string, callerAddress: string): Promise<TradeEvent[]> {
        const trade = await this.prisma.trade.findUnique({
            where: { tradeId },
        });

        if (!trade) throw new AuditTrailTradeNotFoundError();

        const caller = callerAddress.toLowerCase();
        if (
            trade.buyerAddress.toLowerCase() !== caller &&
            trade.sellerAddress.toLowerCase() !== caller
        ) {
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

        // FUNDED — infer from status history; use updatedAt when status is FUNDED
        if (
            ["FUNDED", "DELIVERED", "COMPLETED", "DISPUTED", "CANCELLED"].includes(trade.status)
        ) {
            events.push({
                eventType: "FUNDED",
                timestamp: trade.updatedAt,
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
                    vehicleRegistration: manifest.vehicleRegistration,
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
            events.push({
                eventType: isVideo ? "VIDEO_SUBMITTED" : "EVIDENCE_SUBMITTED",
                timestamp: ev.createdAt,
                actor: ev.uploadedBy,
                metadata: { cid: ev.cid, filename: ev.filename, mimeType: ev.mimeType },
            });
        }

        // DELIVERY_CONFIRMED
        if (["DELIVERED", "COMPLETED"].includes(trade.status)) {
            events.push({
                eventType: "DELIVERY_CONFIRMED",
                timestamp: trade.updatedAt,
                actor: trade.buyerAddress,
                metadata: {},
            });
        }

        // DISPUTE_INITIATED / RESOLVED
        const dispute = await this.prisma.dispute.findUnique({ where: { tradeId } });
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

        // COMPLETED
        if (trade.status === "COMPLETED") {
            events.push({
                eventType: "COMPLETED",
                timestamp: trade.updatedAt,
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
