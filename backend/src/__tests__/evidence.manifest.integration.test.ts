/**
 * Integration round-trip tests for the evidence and manifest subsystems.
 *
 * These tests exercise the service layer end-to-end — from the API call that
 * triggers a service method, through the mock DB and IPFS layers, and back to
 * the response — asserting that:
 *   - Data written on POST is identical to data returned on GET (no field drift).
 *   - Role-based views (buyer / seller / mediator) return the correct shape.
 *   - Unauthorized callers are rejected at every retrieval endpoint.
 *   - Hash values stored in the DB match what the service reports to the caller.
 */

import { PrismaClient, TradeStatus } from "@prisma/client";
import {
  EvidenceService,
  EvidenceAccessDeniedError,
  EvidenceTradeNotFoundError,
} from "../services/evidence.service";
import {
  ManifestService,
  ManifestForbiddenError,
  ManifestNotFoundError,
  ManifestAccessDeniedError,
} from "../services/manifest.service";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUYER = "GCBUYER0000000000000000000000000000000000000000000000000";
const SELLER = "GCSELLER000000000000000000000000000000000000000000000000";
const STRANGER = "GCSTRANGER00000000000000000000000000000000000000000000000";
const MEDIATOR = "GCMEDIATOR0000000000000000000000000000000000000000000000";
const TRADE_ID = "trade-roundtrip-001";

const baseTrade = {
  tradeId: TRADE_ID,
  buyerAddress: BUYER,
  sellerAddress: SELLER,
  status: TradeStatus.FUNDED,
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockPrisma() {
  return {
    trade: { findUnique: jest.fn() },
    tradeEvidence: { findMany: jest.fn(), create: jest.fn() },
    deliveryManifest: { findUnique: jest.fn(), create: jest.fn() },
  } as unknown as PrismaClient;
}

function createMockIpfs(cid = "bafybeicid000") {
  return {
    uploadFile: jest.fn().mockResolvedValue(cid),
    getFileUrl: jest.fn((c: string) => `https://gateway.test/ipfs/${c}`),
  } as any;
}

function makeVideoFile(name = "proof.mp4", mime = "video/mp4", size = 1024): Express.Multer.File {
  return {
    buffer: Buffer.alloc(size),
    originalname: name,
    mimetype: mime,
    size,
  } as unknown as Express.Multer.File;
}

// ---------------------------------------------------------------------------
// Evidence round-trip tests
// ---------------------------------------------------------------------------

describe("Evidence round-trip", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let evidenceService: EvidenceService;

  beforeEach(() => {
    prisma = createMockPrisma();
    evidenceService = new EvidenceService(prisma as any, createMockIpfs());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("POST evidence → GET evidence consistency", () => {
    it("CID written during upload is returned unchanged on retrieval", async () => {
      const uploadedCid = "bafybeicid-roundtrip-001";
      const mockIpfs = createMockIpfs(uploadedCid);
      evidenceService = new EvidenceService(prisma as any, mockIpfs);

      prisma.trade.findUnique = jest.fn().mockResolvedValue(baseTrade);

      const createdRecord = {
        id: 1,
        tradeId: TRADE_ID,
        cid: uploadedCid,
        filename: "proof.mp4",
        mimeType: "video/mp4",
        uploadedBy: BUYER,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      };
      prisma.tradeEvidence.create = jest.fn().mockResolvedValue(createdRecord);

      const uploadResult = await evidenceService.uploadVideoEvidence(
        TRADE_ID,
        BUYER,
        makeVideoFile()
      );

      expect(uploadResult.cid).toBe(uploadedCid);

      // Simulate retrieval returning the same record
      prisma.tradeEvidence.findMany = jest.fn().mockResolvedValue([createdRecord]);
      const evidence = await evidenceService.getEvidenceByTradeId(TRADE_ID, BUYER);

      expect(evidence).toHaveLength(1);
      expect(evidence[0].cid).toBe(uploadedCid);
    });

    it("buyer and seller both receive the same evidence list", async () => {
      const records = [
        {
          id: 1,
          tradeId: TRADE_ID,
          cid: "bafybuyer",
          filename: "buyer.mp4",
          mimeType: "video/mp4",
          uploadedBy: BUYER,
          createdAt: new Date(),
        },
        {
          id: 2,
          tradeId: TRADE_ID,
          cid: "bafyseller",
          filename: "seller.webm",
          mimeType: "video/webm",
          uploadedBy: SELLER,
          createdAt: new Date(),
        },
      ];

      prisma.trade.findUnique = jest.fn().mockResolvedValue(baseTrade);
      prisma.tradeEvidence.findMany = jest.fn().mockResolvedValue(records);

      const buyerView = await evidenceService.getEvidenceByTradeId(TRADE_ID, BUYER);
      const sellerView = await evidenceService.getEvidenceByTradeId(TRADE_ID, SELLER);

      expect(buyerView).toHaveLength(2);
      expect(sellerView).toHaveLength(2);
      expect(buyerView.map((e) => e.cid)).toEqual(sellerView.map((e) => e.cid));
    });

    it("a stranger cannot retrieve evidence and no CID is exposed", async () => {
      prisma.trade.findUnique = jest.fn().mockResolvedValue(baseTrade);

      await expect(
        evidenceService.getEvidenceByTradeId(TRADE_ID, STRANGER)
      ).rejects.toBeInstanceOf(EvidenceAccessDeniedError);

      // findMany must not have been called — no data leaked before the guard
      expect(prisma.tradeEvidence.findMany).not.toHaveBeenCalled();
    });

    it("retrieval returns 404 when the trade does not exist", async () => {
      prisma.trade.findUnique = jest.fn().mockResolvedValue(null);

      await expect(
        evidenceService.getEvidenceByTradeId("nonexistent-trade", BUYER)
      ).rejects.toBeInstanceOf(EvidenceTradeNotFoundError);
    });

    it("upload creates a DB record with the IPFS CID and correct metadata", async () => {
      const cid = "bafybeidbn000001";
      const mockIpfs = createMockIpfs(cid);
      evidenceService = new EvidenceService(prisma as any, mockIpfs);

      prisma.trade.findUnique = jest.fn().mockResolvedValue(baseTrade);
      prisma.tradeEvidence.create = jest.fn().mockResolvedValue({ id: 99 });

      const file = makeVideoFile("evidence.webm", "video/webm", 2048);
      await evidenceService.uploadVideoEvidence(TRADE_ID, SELLER, file);

      expect(prisma.tradeEvidence.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tradeId: TRADE_ID,
            cid,
            filename: "evidence.webm",
            mimeType: "video/webm",
            uploadedBy: SELLER.toLowerCase(),
          }),
        })
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Manifest round-trip tests
// ---------------------------------------------------------------------------

describe("Manifest round-trip", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let manifestService: ManifestService;

  const baseInput = {
    tradeId: TRADE_ID,
    callerAddress: SELLER,
    driverName: "Jane Driver",
    driverIdNumber: "DL-99887766",
    vehicleRegistration: "LG-234-XYZ",
    routeDescription: "Lagos → Ibadan",
    expectedDeliveryAt: new Date(Date.now() + 86400000).toISOString(),
  };

  const storedManifest = {
    id: 7,
    tradeId: TRADE_ID,
    driverName: "Jane Driver",
    driverIdNumber: "DL-99887766",
    driverNameHash: "a".repeat(64),
    driverIdHash: "b".repeat(64),
    vehicleRegistration: "LG-234-XYZ",
    routeDescription: "Lagos → Ibadan",
    expectedDeliveryAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
  };

  beforeEach(() => {
    prisma = createMockPrisma();
    manifestService = new ManifestService(prisma as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.ADMIN_STELLAR_PUBKEYS;
  });

  describe("POST manifest → GET manifest consistency", () => {
    it("hashes produced on submit are identical across two independent calls with the same input", async () => {
      prisma.trade.findUnique = jest.fn().mockResolvedValue(baseTrade);
      prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue(null);
      prisma.deliveryManifest.create = jest
        .fn()
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce({ id: 2 });

      const first = await manifestService.submitManifest({ ...baseInput, tradeId: "t-a" });
      const second = await manifestService.submitManifest({ ...baseInput, tradeId: "t-b" });

      expect(first.driverNameHash).toBe(second.driverNameHash);
      expect(first.driverIdHash).toBe(second.driverIdHash);
      expect(first.driverNameHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("hashes from submit match hashes stored in the DB record", async () => {
      prisma.trade.findUnique = jest.fn().mockResolvedValue(baseTrade);
      prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue(null);

      let capturedData: any;
      prisma.deliveryManifest.create = jest.fn().mockImplementation(({ data }: any) => {
        capturedData = data;
        return Promise.resolve({ id: 5 });
      });

      const result = await manifestService.submitManifest(baseInput);

      expect(result.driverNameHash).toBe(capturedData.driverNameHash);
      expect(result.driverIdHash).toBe(capturedData.driverIdHash);
    });

    it("buyer GET returns masked driver name and ID", async () => {
      prisma.trade.findUnique = jest.fn().mockResolvedValue(baseTrade);
      prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue(storedManifest);

      const view = await manifestService.getManifestByTradeId(TRADE_ID, BUYER);

      expect(view.roleView).toBe("buyer");
      // maskDriverName uses the first letter of the actual name ("Jane Driver" → "J****")
      expect((view as any).driverName).toBe("J****");
      expect((view as any).driverIdNumber).toBe("ID-****");
      expect((view as any).driverNameHash).toBeUndefined();
    });

    it("seller GET returns full driver details and both hashes", async () => {
      prisma.trade.findUnique = jest.fn().mockResolvedValue(baseTrade);
      prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue(storedManifest);

      const view = await manifestService.getManifestByTradeId(TRADE_ID, SELLER);

      expect(view.roleView).toBe("seller");
      expect((view as any).driverName).toBe(storedManifest.driverName);
      expect((view as any).driverIdNumber).toBe(storedManifest.driverIdNumber);
      expect((view as any).driverNameHash).toBe(storedManifest.driverNameHash);
      expect((view as any).driverIdHash).toBe(storedManifest.driverIdHash);
    });

    it("mediator GET returns only hashes — no raw driver fields", async () => {
      process.env.ADMIN_STELLAR_PUBKEYS = MEDIATOR;
      prisma.trade.findUnique = jest.fn().mockResolvedValue(baseTrade);
      prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue(storedManifest);

      const view = await manifestService.getManifestByTradeId(TRADE_ID, MEDIATOR);

      expect(view.roleView).toBe("mediator");
      expect((view as any).driverNameHash).toBe(storedManifest.driverNameHash);
      expect((view as any).driverIdHash).toBe(storedManifest.driverIdHash);
      expect((view as any).driverName).toBeUndefined();
      expect((view as any).driverIdNumber).toBeUndefined();
    });

    it("stranger GET is denied before the manifest is retrieved", async () => {
      prisma.trade.findUnique = jest.fn().mockResolvedValue(baseTrade);

      await expect(
        manifestService.getManifestByTradeId(TRADE_ID, STRANGER)
      ).rejects.toBeInstanceOf(ManifestAccessDeniedError);

      expect(prisma.deliveryManifest.findUnique).not.toHaveBeenCalled();
    });

    it("GET returns 404 when no manifest has been submitted yet", async () => {
      prisma.trade.findUnique = jest.fn().mockResolvedValue(baseTrade);
      prisma.deliveryManifest.findUnique = jest.fn().mockResolvedValue(null);

      await expect(
        manifestService.getManifestByTradeId(TRADE_ID, SELLER)
      ).rejects.toBeInstanceOf(ManifestNotFoundError);
    });

    it("only the seller can submit — buyer attempt is forbidden", async () => {
      prisma.trade.findUnique = jest.fn().mockResolvedValue(baseTrade);

      await expect(
        manifestService.submitManifest({ ...baseInput, callerAddress: BUYER })
      ).rejects.toBeInstanceOf(ManifestForbiddenError);

      expect(prisma.deliveryManifest.create).not.toHaveBeenCalled();
    });
  });
});
