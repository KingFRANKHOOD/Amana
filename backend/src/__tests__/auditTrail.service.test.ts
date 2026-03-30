import { PrismaClient, TradeStatus } from "@prisma/client";
import {
    AuditTrailService,
    AuditTrailAccessDeniedError,
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
});
