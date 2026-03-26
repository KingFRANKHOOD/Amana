import { PrismaClient, TradeStatus } from "@prisma/client";
import {
    ManifestService,
    ManifestForbiddenError,
    ManifestConflictError,
    ManifestTradeStatusError,
    ManifestTradeNotFoundError,
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
});
