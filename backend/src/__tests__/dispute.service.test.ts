import { PrismaClient, TradeStatus, DisputeStatus } from "@prisma/client";
import { TradeService, DisputeTradeStatusError, TradeAccessDeniedError } from "../services/trade.service";
import { ContractService } from "../services/contract.service";

function createMockPrisma() {
    return {
        trade: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
        },
        dispute: {
            create: jest.fn(),
        },
        disputeCategory: {
            findFirst: jest.fn(),
        },
    } as unknown as PrismaClient;
}

function createMockContractService() {
    return {
        buildInitiateDisputeTx: jest.fn(),
    } as unknown as ContractService;
}

describe("TradeService - initiateDispute", () => {
    let prisma: ReturnType<typeof createMockPrisma>;
    let contractService: ReturnType<typeof createMockContractService>;
    let service: TradeService;

    beforeEach(() => {
        prisma = createMockPrisma();
        contractService = createMockContractService();
        service = new TradeService(prisma as any, contractService as any);
    });

    const mockTrade = {
        id: 1,
        tradeId: "T123",
        buyerAddress: "GA_BUYER",
        sellerAddress: "GA_SELLER",
        status: TradeStatus.FUNDED,
        amountUsdc: "100",
    };

    it("successfully initiates a dispute for a FUNDED trade", async () => {
        prisma.trade.findFirst = jest.fn().mockResolvedValue(mockTrade);
        (prisma as any).disputeCategory.findFirst = jest.fn().mockResolvedValue({ id: 7 });
        contractService.buildInitiateDisputeTx = jest.fn().mockResolvedValue({ unsignedXdr: "mock-xdr" });
        prisma.dispute.create = jest.fn().mockResolvedValue({});

        const result = await service.initiateDispute("T123", "GA_BUYER", "Reason string", "Category string");

        expect(result.unsignedXdr).toBe("mock-xdr");
        expect(contractService.buildInitiateDisputeTx).toHaveBeenCalledWith({
            tradeId: "T123",
            initiatorAddress: "GA_BUYER",
            reasonHash: expect.any(String),
        });
        expect(prisma.dispute.create).toHaveBeenCalledWith({
            data: {
                tradeId: "T123",
                initiator: "GA_BUYER",
                reason: "Reason string",
                status: DisputeStatus.OPEN,
                categoryId: 7,
            },
        });
    });

    it("successfully initiates a dispute for a DELIVERED trade", async () => {
        prisma.trade.findFirst = jest.fn().mockResolvedValue({
            ...mockTrade,
            status: TradeStatus.DELIVERED,
        });
        (prisma as any).disputeCategory.findFirst = jest.fn().mockResolvedValue({ id: 7 });
        contractService.buildInitiateDisputeTx = jest.fn().mockResolvedValue({ unsignedXdr: "mock-xdr" });

        await service.initiateDispute("T123", "GA_SELLER", "Reason string", "Category string");

        expect(contractService.buildInitiateDisputeTx).toHaveBeenCalled();
    });

    it("stores a validated category id when categoryId is provided", async () => {
        prisma.trade.findFirst = jest.fn().mockResolvedValue(mockTrade);
        (prisma as any).disputeCategory.findFirst = jest.fn().mockResolvedValue({ id: 12 });
        contractService.buildInitiateDisputeTx = jest.fn().mockResolvedValue({ unsignedXdr: "mock-xdr" });
        prisma.dispute.create = jest.fn().mockResolvedValue({});

        await service.initiateDispute("T123", "GA_BUYER", "Reason string", "", 12);

        expect((prisma as any).disputeCategory.findFirst).toHaveBeenCalledWith({
            where: { id: 12, isActive: true },
            select: { id: true },
        });
        expect(prisma.dispute.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ categoryId: 12 }),
        });
    });

    it("rejects an unknown or inactive dispute category before building the contract transaction", async () => {
        prisma.trade.findFirst = jest.fn().mockResolvedValue(mockTrade);
        (prisma as any).disputeCategory.findFirst = jest.fn().mockResolvedValue(null);

        await expect(
            service.initiateDispute("T123", "GA_BUYER", "Reason string", "unknown")
        ).rejects.toThrow("Invalid dispute category: unknown");

        expect(contractService.buildInitiateDisputeTx).not.toHaveBeenCalled();
        expect(prisma.dispute.create).not.toHaveBeenCalled();
    });

    it("throws DisputeTradeStatusError if trade is in CREATED status", async () => {
        prisma.trade.findFirst = jest.fn().mockResolvedValue({
            ...mockTrade,
            status: TradeStatus.CREATED,
        });

        await expect(
            service.initiateDispute("T123", "GA_BUYER", "Reason", "Category")
        ).rejects.toThrow(DisputeTradeStatusError);
    });

    it("throws TradeAccessDeniedError if caller is not buyer or seller", async () => {
        prisma.trade.findFirst = jest.fn().mockResolvedValue(mockTrade);

        await expect(
            service.initiateDispute("T123", "GA_OTHER", "Reason", "Category")
        ).rejects.toThrow(TradeAccessDeniedError);
    });

    it("throws error if trade is not found", async () => {
        prisma.trade.findFirst = jest.fn().mockResolvedValue(null);

        await expect(
            service.initiateDispute("T999", "GA_BUYER", "Reason", "Category")
        ).rejects.toThrow("Trade not found");
    });
});
