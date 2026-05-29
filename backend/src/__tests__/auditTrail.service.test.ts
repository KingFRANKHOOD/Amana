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
    fundedAt: null,
    deliveredAt: null,
    completedAt: null,
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
        delete process.env.ADMIN_STELLAR_PUBKEYS;
        delete process.env.EVIDENCE_METADATA_RETENTION_DAYS;
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

    it("allows admin user to access trade history", async () => {
        const ADMIN = "GCADMIN0000000000000000000000000000000000000000000000000";
        process.env.ADMIN_STELLAR_PUBKEYS = ADMIN;
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);

        await expect(service.getTradeHistory(TRADE_ID, ADMIN)).resolves.toBeInstanceOf(Array);
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

    it("redacts stale evidence metadata outside retention window", async () => {
        process.env.EVIDENCE_METADATA_RETENTION_DAYS = "1";
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
        prisma.tradeEvidence.findMany = jest.fn().mockResolvedValue([
            {
                id: 1,
                tradeId: TRADE_ID,
                cid: "bafyold",
                filename: "proof.mp4",
                mimeType: "video/mp4",
                uploadedBy: BUYER,
                createdAt: new Date("2024-01-01T00:00:00Z"),
            },
        ]);

        const events = await service.getTradeHistory(TRADE_ID, BUYER);
        const evidence = events.find((event) => event.eventType === "VIDEO_SUBMITTED");
        expect(evidence?.metadata).toEqual(
            expect.objectContaining({
                cid: "redacted",
                filename: "redacted",
                retentionExpired: true,
            }),
        );
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

    // ── AUDIT-001: canonical timestamp tests ──────────────────────────────────

    it("FUNDED event uses canonical fundedAt when present", async () => {
        const fundedAt = new Date("2026-03-01T12:00:00Z");
        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            ...mockTrade,
            status: TradeStatus.FUNDED,
            fundedAt,
        });

        const events = await service.getTradeHistory(TRADE_ID, BUYER);
        const funded = events.find((e) => e.eventType === "FUNDED");
        expect(funded?.timestamp).toEqual(fundedAt);
    });

    it("FUNDED event falls back to updatedAt when fundedAt is null (legacy row)", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            ...mockTrade,
            status: TradeStatus.FUNDED,
            fundedAt: null,
        });

        const events = await service.getTradeHistory(TRADE_ID, BUYER);
        const funded = events.find((e) => e.eventType === "FUNDED");
        expect(funded?.timestamp).toEqual(mockTrade.updatedAt);
    });

    it("DELIVERY_CONFIRMED event uses canonical deliveredAt when present", async () => {
        const deliveredAt = new Date("2026-03-03T08:00:00Z");
        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            ...mockTrade,
            status: TradeStatus.DELIVERED,
            deliveredAt,
        });

        const events = await service.getTradeHistory(TRADE_ID, BUYER);
        const confirmed = events.find((e) => e.eventType === "DELIVERY_CONFIRMED");
        expect(confirmed?.timestamp).toEqual(deliveredAt);
    });

    it("COMPLETED event uses canonical completedAt when present", async () => {
        const completedAt = new Date("2026-03-04T09:00:00Z");
        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            ...mockTrade,
            status: TradeStatus.COMPLETED,
            fundedAt: new Date("2026-03-01T12:00:00Z"),
            deliveredAt: new Date("2026-03-03T08:00:00Z"),
            completedAt,
        });

        const events = await service.getTradeHistory(TRADE_ID, BUYER);
        const completed = events.find((e) => e.eventType === "COMPLETED");
        expect(completed?.timestamp).toEqual(completedAt);
    });

    it("multi-transition chronology is deterministic across repeated reads", async () => {
        const fundedAt    = new Date("2026-03-01T12:00:00Z");
        const deliveredAt = new Date("2026-03-03T08:00:00Z");
        const completedAt = new Date("2026-03-04T09:00:00Z");
        const tradeRow = {
            ...mockTrade,
            status: TradeStatus.COMPLETED,
            fundedAt,
            deliveredAt,
            completedAt,
        };
        prisma.trade.findUnique = jest.fn().mockResolvedValue(tradeRow);

        const eventsA = await service.getTradeHistory(TRADE_ID, BUYER);
        const eventsB = await service.getTradeHistory(TRADE_ID, BUYER);

        const tsA = eventsA.map((e) => e.timestamp.getTime());
        const tsB = eventsB.map((e) => e.timestamp.getTime());

        // Chronological order is stable
        expect(tsA).toEqual([...tsA].sort((a, b) => a - b));
        // Repeated reads produce identical ordering
        expect(tsA).toEqual(tsB);

        // Canonical timestamps appear at the correct positions
        const funded    = eventsA.find((e) => e.eventType === "FUNDED");
        const confirmed = eventsA.find((e) => e.eventType === "DELIVERY_CONFIRMED");
        const completed = eventsA.find((e) => e.eventType === "COMPLETED");
        expect(funded?.timestamp).toEqual(fundedAt);
        expect(confirmed?.timestamp).toEqual(deliveredAt);
        expect(completed?.timestamp).toEqual(completedAt);
    });
});
