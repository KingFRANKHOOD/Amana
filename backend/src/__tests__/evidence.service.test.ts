import { PrismaClient } from "@prisma/client";
import {
    EvidenceService,
    EvidenceAccessDeniedError,
    EvidenceTradeNotFoundError,
} from "../services/evidence.service";
import { EvidenceValidationError } from "../services/evidence.service";

const BUYER = "GCBUYER0000000000000000000000000000000000000000000000000";
const SELLER = "GCSELLER000000000000000000000000000000000000000000000000";
const STRANGER = "GCSTRANGER00000000000000000000000000000000000000000000000";
const TRADE_ID = "trade-001";

function createMockPrisma() {
    return {
        trade: { findUnique: jest.fn() },
        tradeEvidence: { findMany: jest.fn(), create: jest.fn() },
    } as unknown as PrismaClient;
}

const mockTrade = {
    tradeId: TRADE_ID,
    buyerAddress: BUYER,
    sellerAddress: SELLER,
};

const mockEvidence = [
    {
        id: 1,
        tradeId: TRADE_ID,
        cid: "bafybeiabc123",
        filename: "video.mp4",
        mimeType: "video/mp4",
        uploadedBy: BUYER,
        createdAt: new Date("2026-03-01T00:00:00Z"),
    },
];

describe("EvidenceService", () => {
    let prisma: ReturnType<typeof createMockPrisma>;
    let service: EvidenceService;

    beforeEach(() => {
        prisma = createMockPrisma();
        service = new EvidenceService(prisma, {
            uploadFile: jest.fn(),
            getFileUrl: jest.fn((cid: string) => `https://ipfs.example/${cid}`),
        } as any);
    });

    describe("uploadVideoEvidence validation and access", () => {
        it("accepts mp4 and creates record", async () => {
            prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
            const created = { id: 42 } as any;
            prisma.tradeEvidence.create = jest.fn().mockResolvedValue(created);

            const mockIpfs = {
                uploadFile: jest.fn().mockResolvedValue("bafycid"),
                getFileUrl: (cid: string) => `https://gateway.test/ipfs/${cid}`,
            } as any;
            service = new EvidenceService(prisma, mockIpfs);

            const file = {
                buffer: Buffer.from("x"),
                originalname: "video.mp4",
                mimetype: "video/mp4",
                size: 10,
            } as unknown as Express.Multer.File;

            const res = await service.uploadVideoEvidence("trade-001", BUYER, file);
            expect(res.cid).toBe("bafycid");
            expect(prisma.tradeEvidence.create).toHaveBeenCalled();
        });

        it("rejects unsupported file types", async () => {
            prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
            const file = {
                buffer: Buffer.from("x"),
                originalname: "malware.exe",
                mimetype: "application/octet-stream",
                size: 10,
            } as unknown as Express.Multer.File;

            await expect(
                service.uploadVideoEvidence("trade-001", BUYER, file)
            ).rejects.toBeInstanceOf(EvidenceValidationError);
        });

        it("rejects files larger than 50MB", async () => {
            prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
            const file = {
                buffer: Buffer.alloc(51 * 1024 * 1024),
                originalname: "big.mp4",
                mimetype: "video/mp4",
                size: 51 * 1024 * 1024,
            } as unknown as Express.Multer.File;

            await expect(
                service.uploadVideoEvidence("trade-001", BUYER, file)
            ).rejects.toBeInstanceOf(EvidenceValidationError);
        });

        it("blocks unauthorized uploader", async () => {
            prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
            const file = {
                buffer: Buffer.from("x"),
                originalname: "video.mp4",
                mimetype: "video/mp4",
                size: 10,
            } as unknown as Express.Multer.File;

            await expect(
                service.uploadVideoEvidence("trade-001", STRANGER, file)
            ).rejects.toBeInstanceOf(EvidenceAccessDeniedError);
        });
    });

    it("returns all evidence records for an authorized buyer", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
        prisma.tradeEvidence.findMany = jest.fn().mockResolvedValue(mockEvidence);

        const result = await service.getEvidenceByTradeId(TRADE_ID, BUYER);

        expect(result).toHaveLength(1);
        expect(result[0].cid).toBe("bafybeiabc123");
        expect(result[0].url).toContain("bafybeiabc123");
    });

    it("returns all evidence records for an authorized seller", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
        prisma.tradeEvidence.findMany = jest.fn().mockResolvedValue(mockEvidence);

        const result = await service.getEvidenceByTradeId(TRADE_ID, SELLER);
        expect(result).toHaveLength(1);
    });

    it("throws EvidenceAccessDeniedError for unrelated user", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);

        await expect(
            service.getEvidenceByTradeId(TRADE_ID, STRANGER)
        ).rejects.toBeInstanceOf(EvidenceAccessDeniedError);
    });

    it("throws EvidenceTradeNotFoundError when trade does not exist", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(null);

        await expect(
            service.getEvidenceByTradeId(TRADE_ID, BUYER)
        ).rejects.toBeInstanceOf(EvidenceTradeNotFoundError);
    });

    it("allows two concurrent evidence uploads and both are visible in list", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
        (service as any).ipfs.uploadFile = jest
            .fn()
            .mockResolvedValueOnce("bafybeicid-1")
            .mockResolvedValueOnce("bafybeicid-2");
        prisma.tradeEvidence.create = jest
            .fn()
            .mockResolvedValueOnce({
                id: 11,
                tradeId: TRADE_ID,
                cid: "bafybeicid-1",
                filename: "proof-1.mp4",
                mimeType: "video/mp4",
                uploadedBy: BUYER.toLowerCase(),
                createdAt: new Date("2026-03-01T00:00:00Z"),
            })
            .mockResolvedValueOnce({
                id: 12,
                tradeId: TRADE_ID,
                cid: "bafybeicid-2",
                filename: "proof-2.mp4",
                mimeType: "video/mp4",
                uploadedBy: SELLER.toLowerCase(),
                createdAt: new Date("2026-03-01T00:00:01Z"),
            });
        prisma.tradeEvidence.findMany = jest.fn().mockResolvedValue([
            {
                id: 11,
                tradeId: TRADE_ID,
                cid: "bafybeicid-1",
                filename: "proof-1.mp4",
                mimeType: "video/mp4",
                uploadedBy: BUYER.toLowerCase(),
                createdAt: new Date("2026-03-01T00:00:00Z"),
            },
            {
                id: 12,
                tradeId: TRADE_ID,
                cid: "bafybeicid-2",
                filename: "proof-2.mp4",
                mimeType: "video/mp4",
                uploadedBy: SELLER.toLowerCase(),
                createdAt: new Date("2026-03-01T00:00:01Z"),
            },
        ]);

        const makeFile = (name: string) => ({
            originalname: name,
            mimetype: "video/mp4",
            buffer: Buffer.from("file"),
        }) as Express.Multer.File;

        const [first, second] = await Promise.all([
            service.uploadVideoEvidence(TRADE_ID, BUYER, makeFile("proof-1.mp4")),
            service.uploadVideoEvidence(TRADE_ID, SELLER, makeFile("proof-2.mp4")),
        ]);

        expect(first.evidenceId).toBe(11);
        expect(second.evidenceId).toBe(12);

        const listed = await service.getEvidenceByTradeId(TRADE_ID, BUYER);
        expect(listed).toHaveLength(2);
        expect(listed.map((item) => item.cid)).toEqual([
            "bafybeicid-1",
            "bafybeicid-2",
        ]);
    });
});
