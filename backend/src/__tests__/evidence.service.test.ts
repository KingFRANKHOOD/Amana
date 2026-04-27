import { PrismaClient } from "@prisma/client";
import {
    EvidenceService,
    EvidenceAccessDeniedError,
    EvidenceTradeNotFoundError,
    EvidenceScanError,
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
        } as any, {
            scan: jest.fn().mockResolvedValue({ clean: true }),
        } as any);
    });

    afterEach(() => {
        delete process.env.ADMIN_STELLAR_PUBKEYS;
        delete process.env.EVIDENCE_METADATA_RETENTION_DAYS;
        delete process.env.EVIDENCE_SCAN_REQUIRED;
    });

    const makeMp4Buffer = () =>
        Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

    const makeWebmBuffer = () =>
        Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01]);

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
                buffer: makeMp4Buffer(),
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
                buffer: makeMp4Buffer(),
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

    it("allows admin caller to list trade evidence", async () => {
        const ADMIN = "GCADMIN0000000000000000000000000000000000000000000000000";
        process.env.ADMIN_STELLAR_PUBKEYS = ADMIN;
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
        prisma.tradeEvidence.findMany = jest.fn().mockResolvedValue(mockEvidence);

        const result = await service.getEvidenceByTradeId(TRADE_ID, ADMIN);
        expect(result).toHaveLength(1);
        delete process.env.ADMIN_STELLAR_PUBKEYS;
    });

    it("redacts stale evidence metadata outside retention window", async () => {
        process.env.EVIDENCE_METADATA_RETENTION_DAYS = "1";
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
        prisma.tradeEvidence.findMany = jest.fn().mockResolvedValue([
            {
                id: 99,
                tradeId: TRADE_ID,
                cid: "bafyold",
                filename: "old-proof.mp4",
                mimeType: "video/mp4",
                uploadedBy: BUYER,
                createdAt: new Date("2024-01-01T00:00:00.000Z"),
            },
        ]);

        const listed = await service.getEvidenceByTradeId(TRADE_ID, BUYER);
        expect(listed[0].cid).toBe("redacted");
        expect(listed[0].filename).toBe("redacted");
        expect(listed[0].uploadedBy).toBe("redacted");
        expect(listed[0].retentionExpired).toBe(true);
        delete process.env.EVIDENCE_METADATA_RETENTION_DAYS;
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
            buffer: makeMp4Buffer(),
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

    it("rejects spoofed mime type when file bytes do not match", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
        const file = {
            buffer: makeWebmBuffer(),
            originalname: "video.mp4",
            mimetype: "video/mp4",
            size: 16,
        } as unknown as Express.Multer.File;

        await expect(
            service.uploadVideoEvidence("trade-001", BUYER, file)
        ).rejects.toBeInstanceOf(EvidenceValidationError);
    });

    it("rejects upload when malware scanner flags file", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
        service = new EvidenceService(prisma, {
            uploadFile: jest.fn().mockResolvedValue("bafycid"),
            getFileUrl: jest.fn((cid: string) => `https://ipfs.example/${cid}`),
        } as any, {
            scan: jest.fn().mockResolvedValue({ clean: false, reason: "malware signature detected" }),
        } as any);

        const file = {
            buffer: makeMp4Buffer(),
            originalname: "video.mp4",
            mimetype: "video/mp4",
            size: 10,
        } as unknown as Express.Multer.File;

        await expect(
            service.uploadVideoEvidence("trade-001", BUYER, file)
        ).rejects.toBeInstanceOf(EvidenceValidationError);
    });

    it("fails closed when scanner is required and unavailable", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
        process.env.EVIDENCE_SCAN_REQUIRED = "true";
        service = new EvidenceService(prisma, {
            uploadFile: jest.fn().mockResolvedValue("bafycid"),
            getFileUrl: jest.fn((cid: string) => `https://ipfs.example/${cid}`),
        } as any, {
            scan: jest.fn().mockRejectedValue(new Error("scanner timeout")),
        } as any);

        const file = {
            buffer: makeMp4Buffer(),
            originalname: "video.mp4",
            mimetype: "video/mp4",
            size: 10,
        } as unknown as Express.Multer.File;

        await expect(
            service.uploadVideoEvidence("trade-001", BUYER, file)
        ).rejects.toBeInstanceOf(EvidenceScanError);
        delete process.env.EVIDENCE_SCAN_REQUIRED;
    });

    it("fails open when scanner is optional and unavailable", async () => {
        prisma.trade.findUnique = jest.fn().mockResolvedValue(mockTrade);
        process.env.EVIDENCE_SCAN_REQUIRED = "false";
        prisma.tradeEvidence.create = jest.fn().mockResolvedValue({ id: 55 });
        service = new EvidenceService(prisma, {
            uploadFile: jest.fn().mockResolvedValue("bafycid"),
            getFileUrl: jest.fn((cid: string) => `https://ipfs.example/${cid}`),
        } as any, {
            scan: jest.fn().mockRejectedValue(new Error("scanner timeout")),
        } as any);

        const file = {
            buffer: makeMp4Buffer(),
            originalname: "video.mp4",
            mimetype: "video/mp4",
            size: 10,
        } as unknown as Express.Multer.File;

        await expect(service.uploadVideoEvidence("trade-001", BUYER, file)).resolves.toEqual(
            expect.objectContaining({
                cid: "bafycid",
            }),
        );
        delete process.env.EVIDENCE_SCAN_REQUIRED;
    });
});
