import { PrismaClient, TradeStatus } from "@prisma/client";
import crypto from "crypto";
import {
    AuditTrailService,
    AuditTrailAccessDeniedError,
    AuditSigningConfigError,
    AuditTrailTradeNotFoundError,
} from "../services/auditTrail.service";

const BUYER = "GCBUYER0000000000000000000000000000000000000000000000000";
const SELLER = "GCSELLER000000000000000000000000000000000000000000000000";
const STRANGER = "GCSTRANGER00000000000000000000000000000000000000000000000";
const TRADE_ID = "trade-001";

function createMockPrisma() {
    return {
        trade: { findUnique: jest.fn() },
        tradeEvidence: { findMany: jest.fn() },
        deliveryManifest: { findUnique: jest.fn() },
        dispute: { findUnique: jest.fn() },
    } as unknown as PrismaClient;
}

const t1 = new Date("2026-03-01T10:00:00Z");
const t2 = new Date("2026-03-02T10:00:00Z");
const t3 = new Date("2026-03-03T10:00:00Z");

const mockTrade = {
    tradeId: TRADE_ID,
    buyerAddress: BUYER,
    sellerAddress: SELLER,
    amountUsdc: "100",
    status: TradeStatus.FUNDED,
    createdAt: t1,
    updatedAt: t2,
};

describe("AuditTrailService", () => {
    let prisma: ReturnType<typeof createMockPrisma>;
    let service: AuditTrailService;

    beforeEach(() => {
        prisma = createMockPrisma();
        service = new AuditTrailService(prisma);
        prisma.tradeEvidence.findMany = jest.fn().mockResolvedValue([]);
        prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue(null);
        prisma.dispute.findUnique = jest.fn().mockResolvedValue(null);
    });

    afterEach(() => {
        delete process.env.AUDIT_SIGNING_KEY_ID;
        delete process.env.AUDIT_SIGNING_PRIVATE_KEY_PEM;
        delete process.env.AUDIT_SIGNING_PUBLIC_KEY_PEM;
    });

    it("returns events in chronological order", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
        prisma.tradeEvidence.findMany = jest.fn().mockResolvedValue([
            {
                id: 1,
                tradeId: TRADE_ID,
                cid: "bafybeiabc",
                filename: "photo.jpg",
                mimeType: "image/jpeg",
                uploadedBy: BUYER,
                createdAt: t3,
            },
        ]);

        const events = await service.getTradeHistory(TRADE_ID, BUYER);

        const timestamps = events.map((e) => e.timestamp.getTime());
        const sorted = [...timestamps].sort((a, b) => a - b);
        expect(timestamps).toEqual(sorted);
    });

    it("returns 403 for unauthorized user", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);

        await expect(
            service.getTradeHistory(TRADE_ID, STRANGER)
        ).rejects.toBeInstanceOf(AuditTrailAccessDeniedError);
    });

    it("returns 404 when trade does not exist", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(null);

        await expect(
            service.getTradeHistory(TRADE_ID, BUYER)
        ).rejects.toBeInstanceOf(AuditTrailTradeNotFoundError);
    });

    it("includes MANIFEST_SUBMITTED event when manifest exists", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
        prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            vehicleRegistration: "ABC-123",
            expectedDeliveryAt: t3,
            createdAt: t3,
        });

        const events = await service.getTradeHistory(TRADE_ID, SELLER);
        const types = events.map((e) => e.eventType);
        expect(types).toContain("MANIFEST_SUBMITTED");
    });

    it("includes DISPUTE_INITIATED event when dispute exists", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            ...mockTrade,
            status: TradeStatus.DISPUTED,
        });
        prisma.dispute.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            initiator: BUYER,
            reason: "Goods not delivered",
            status: "OPEN",
            resolvedAt: null,
            createdAt: t3,
        });

        const events = await service.getTradeHistory(TRADE_ID, BUYER);
        const types = events.map((e) => e.eventType);
        expect(types).toContain("DISPUTE_INITIATED");
    });

    it("builds deterministic payload hash/signature for the same payload", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
        const events = await service.getTradeHistory(TRADE_ID, BUYER);
        const payload = {
            tradeId: TRADE_ID,
            generatedAt: "2026-01-01T00:00:00.000Z",
            events: events.map((event) => ({
                eventType: event.eventType,
                timestamp: event.timestamp.toISOString(),
                actor: event.actor,
                metadata: event.metadata,
            })),
        };

        const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
        process.env.AUDIT_SIGNING_KEY_ID = "test-key-v1";
        process.env.AUDIT_SIGNING_PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
        process.env.AUDIT_SIGNING_PUBLIC_KEY_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

        const signedA = service.signPayload(payload);
        const signedB = service.signPayload(payload);

        expect(signedA.payloadHash).toBe(signedB.payloadHash);
        expect(signedA.signature).toBe(signedB.signature);
        expect(signedA.keyId).toBe("test-key-v1");
    });

    it("detects payload tampering during verification", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
        const events = await service.getTradeHistory(TRADE_ID, BUYER);
        const payload = {
            tradeId: TRADE_ID,
            generatedAt: "2026-01-01T00:00:00.000Z",
            events: events.map((event) => ({
                eventType: event.eventType,
                timestamp: event.timestamp.toISOString(),
                actor: event.actor,
                metadata: event.metadata,
            })),
        };

        const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
        process.env.AUDIT_SIGNING_KEY_ID = "test-key-v1";
        process.env.AUDIT_SIGNING_PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
        process.env.AUDIT_SIGNING_PUBLIC_KEY_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

        const signed = service.signPayload(payload);
        const tamperedPayload = {
            ...payload,
            events: payload.events.map((item, idx) =>
                idx === 0 ? { ...item, actor: "GC_FAKE_ACTOR" } : item
            ),
        };

        expect(service.verifyPayload(payload, signed.signature)).toBe(true);
        expect(service.verifyPayload(tamperedPayload, signed.signature)).toBe(false);
    });

    it("throws when signing config is missing", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
        const events = await service.getTradeHistory(TRADE_ID, BUYER);
        const payload = service.getCanonicalPayload(TRADE_ID, events);

        expect(() => service.signPayload(payload)).toThrow(AuditSigningConfigError);
    });
});
