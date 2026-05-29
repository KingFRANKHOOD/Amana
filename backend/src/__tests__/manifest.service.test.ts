import { PrismaClient, TradeStatus } from "@prisma/client";
import {
    ManifestService,
    ManifestForbiddenError,
    ManifestConflictError,
    ManifestTradeStatusError,
    ManifestTradeNotFoundError,
    ManifestAccessDeniedError,
    ManifestNotFoundError,
} from "../services/manifest.service";

function createMockPrisma() {
    return {
        trade: { findUnique: jest.fn() },
        deliveryManifest: { findUnique: jest.fn(), create: jest.fn() },
    } as unknown as PrismaClient;
}

const SELLER = "GCSELLER000000000000000000000000000000000000000000000000";
const BUYER = "GCBUYER0000000000000000000000000000000000000000000000000";
const TRADE_ID = "trade-001";

const baseInput = {
    tradeId: TRADE_ID,
    callerAddress: SELLER,
    driverName: "John Doe",
    driverIdNumber: "ID-12345",
    vehicleRegistration: "ABC-123",
    routeDescription: "Lagos to Abuja",
    expectedDeliveryAt: new Date(Date.now() + 86400000).toISOString(),
};

describe("ManifestService", () => {
    let prisma: ReturnType<typeof createMockPrisma>;
    let service: ManifestService;

    beforeEach(() => {
        prisma = createMockPrisma();
        service = new ManifestService(prisma);
        delete process.env.MANIFEST_PII_RETENTION_DAYS;
        delete process.env.ADMIN_STELLAR_PUBKEYS;
    });

    it("stores hashed driver details and returns manifestId", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            sellerAddress: SELLER,
            buyerAddress: BUYER,
            status: TradeStatus.FUNDED,
        });
        prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue(null);
        prisma.deliveryManifest.create = jest.fn().mockResolvedValue({ id: 42 });

        const result = await service.submitManifest(baseInput);

        expect(result.manifestId).toBe(42);
        expect(result.driverNameHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.driverIdHash).toMatch(/^[a-f0-9]{64}$/);

        expect(prisma.deliveryManifest.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    driverName: "John Doe",
                    driverIdNumber: "ID-12345",
                    driverNameHash: expect.stringMatching(/^[a-f0-9]{64}$/),
                    driverIdHash: expect.stringMatching(/^[a-f0-9]{64}$/),
                }),
            })
        );
    });

    it("produces deterministic SHA256 hashes for same input", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            sellerAddress: SELLER,
            buyerAddress: BUYER,
            status: TradeStatus.FUNDED,
        });
        prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue(null);
        prisma.deliveryManifest.create = jest
            .fn()
            .mockResolvedValueOnce({ id: 41 })
            .mockResolvedValueOnce({ id: 42 });

        const first = await service.submitManifest({ ...baseInput, tradeId: "trade-001-A" });
        const second = await service.submitManifest({ ...baseInput, tradeId: "trade-001-B" });

        expect(first.driverNameHash).toBe(second.driverNameHash);
        expect(first.driverIdHash).toBe(second.driverIdHash);
    });

    it("throws ManifestForbiddenError when caller is the buyer", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            sellerAddress: SELLER,
            buyerAddress: BUYER,
            status: TradeStatus.FUNDED,
        });

        await expect(
            service.submitManifest({ ...baseInput, callerAddress: BUYER })
        ).rejects.toBeInstanceOf(ManifestForbiddenError);
    });

    it("throws ManifestConflictError if manifest already exists", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            sellerAddress: SELLER,
            buyerAddress: BUYER,
            status: TradeStatus.FUNDED,
        });
        prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue({ id: 1 });

        await expect(service.submitManifest(baseInput)).rejects.toBeInstanceOf(
            ManifestConflictError
        );
    });

    it("maps unique-constraint race on create to ManifestConflictError", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            sellerAddress: SELLER,
            buyerAddress: BUYER,
            status: TradeStatus.FUNDED,
        });
        prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue(null);
        prisma.deliveryManifest.create = jest.fn().mockRejectedValue({ code: "P2002" });

        await expect(service.submitManifest(baseInput)).rejects.toBeInstanceOf(
            ManifestConflictError,
        );
    });

    it("allows one of two concurrent submissions and rejects the other with conflict", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            sellerAddress: SELLER,
            buyerAddress: BUYER,
            status: TradeStatus.FUNDED,
        });
        prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue(null);
        prisma.deliveryManifest.create = jest
            .fn()
            .mockResolvedValueOnce({ id: 100 })
            .mockRejectedValueOnce({ code: "P2002" });

        const [first, second] = await Promise.allSettled([
            service.submitManifest(baseInput),
            service.submitManifest(baseInput),
        ]);

        const statuses = [first.status, second.status].sort();
        expect(statuses).toEqual(["fulfilled", "rejected"]);

        const rejected = [first, second].find(
            (entry): entry is PromiseRejectedResult => entry.status === "rejected",
        );
        expect(rejected?.reason).toBeInstanceOf(ManifestConflictError);
    });

    it("throws ManifestTradeStatusError when trade is not FUNDED", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            sellerAddress: SELLER,
            buyerAddress: BUYER,
            status: TradeStatus.CREATED,
        });

        await expect(service.submitManifest(baseInput)).rejects.toBeInstanceOf(
            ManifestTradeStatusError
        );
    });

    it("throws ManifestTradeNotFoundError when trade does not exist", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(null);

        await expect(service.submitManifest(baseInput)).rejects.toBeInstanceOf(
            ManifestTradeNotFoundError
        );
    });

    it("returns masked manifest for buyer retrieval", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            sellerAddress: SELLER,
            buyerAddress: BUYER,
            status: TradeStatus.FUNDED,
        });
        prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            driverName: "Driver Name",
            driverIdNumber: "ID-12345",
            vehicleRegistration: "ABC-123",
            routeDescription: "Lagos to Abuja",
            expectedDeliveryAt: new Date("2026-03-30T12:00:00.000Z"),
            driverNameHash: "a".repeat(64),
            driverIdHash: "b".repeat(64),
            createdAt: new Date("2026-03-30T10:00:00.000Z"),
        });

        const result = await service.getManifestByTradeId(TRADE_ID, BUYER);
        expect(result.roleView).toBe("buyer");
        expect((result as any).driverName).toBe("D****");
        expect((result as any).driverIdNumber).toBe("ID-****");
        expect((result as any).driverNameHash).toBeUndefined();
    });

    it("returns hash-only manifest for mediator retrieval", async () => {
        const MEDIATOR = "GCMEDIATOR000000000000000000000000000000000000000000000";
        process.env.ADMIN_STELLAR_PUBKEYS = MEDIATOR;

        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            sellerAddress: SELLER,
            buyerAddress: BUYER,
            status: TradeStatus.FUNDED,
        });
        prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            driverName: "Driver Name",
            driverIdNumber: "ID-12345",
            vehicleRegistration: "ABC-123",
            routeDescription: "Lagos to Abuja",
            expectedDeliveryAt: new Date("2026-03-30T12:00:00.000Z"),
            driverNameHash: "a".repeat(64),
            driverIdHash: "b".repeat(64),
            createdAt: new Date("2026-03-30T10:00:00.000Z"),
        });

        const result = await service.getManifestByTradeId(TRADE_ID, MEDIATOR);
        expect(result.roleView).toBe("mediator");
        expect((result as any).driverNameHash).toBe("a".repeat(64));
        expect((result as any).driverIdHash).toBe("b".repeat(64));
        expect((result as any).driverName).toBeUndefined();
        expect((result as any).driverIdNumber).toBeUndefined();
    });

    it("redacts seller PII when manifest is outside retention window", async () => {
        process.env.MANIFEST_PII_RETENTION_DAYS = "1";
        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            sellerAddress: SELLER,
            buyerAddress: BUYER,
            status: TradeStatus.FUNDED,
        });
        prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            driverName: "Driver Name",
            driverIdNumber: "ID-12345",
            vehicleRegistration: "ABC-123",
            routeDescription: "Lagos to Abuja",
            expectedDeliveryAt: new Date("2026-03-30T12:00:00.000Z"),
            driverNameHash: "a".repeat(64),
            driverIdHash: "b".repeat(64),
            createdAt: new Date("2024-03-30T10:00:00.000Z"),
        });

        const result = await service.getManifestByTradeId(TRADE_ID, SELLER);
        expect((result as any).driverName).toBe("REDACTED");
        expect((result as any).driverIdNumber).toBe("REDACTED");
        expect((result as any).retentionExpired).toBe(true);
    });

    it("throws ManifestAccessDeniedError for unrelated manifest retrieval caller", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            sellerAddress: SELLER,
            buyerAddress: BUYER,
            status: TradeStatus.FUNDED,
        });

        await expect(
            service.getManifestByTradeId(TRADE_ID, "GCSTRANGER000000000000000000000000000000000000000000000"),
        ).rejects.toBeInstanceOf(ManifestAccessDeniedError);
    });

    it("throws ManifestNotFoundError when manifest retrieval finds no row", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue({
            tradeId: TRADE_ID,
            sellerAddress: SELLER,
            buyerAddress: BUYER,
            status: TradeStatus.FUNDED,
        });
        prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue(null);

        await expect(service.getManifestByTradeId(TRADE_ID, BUYER)).rejects.toBeInstanceOf(
            ManifestNotFoundError,
        );
    });
});
