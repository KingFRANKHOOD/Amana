/**
 * Regression test for issue #1403:
 * Orphaned duplicate AuditTrailService in repositories/persistance.ts
 * (note typo) with weaker access control/redaction than canonical.
 *
 * Fixed behavior: duplicate file removed; canonical service is single source
 * with mediator/admin access + evidence/manifest redaction + shared signing config.
 */
import fs from "fs";
import path from "path";
import { AuditTrailService } from "../services/auditTrail.service";
import { TradeStatus } from "@prisma/client";

const BUYER = "gcbuyer0000000000000000000000000000000000000000000000000";
const SELLER = "gcseller000000000000000000000000000000000000000000000000";
const STRANGER = "gcstranger00000000000000000000000000000000000000000000000";

function mockPrisma(overrides: any = {}) {
  return {
    trade: { findUnique: jest.fn().mockResolvedValue(null) },
    tradeEvidence: { findMany: jest.fn().mockResolvedValue([]) },
    deliveryManifest: { findUnique: jest.fn().mockResolvedValue(null) },
    dispute: { findUnique: jest.fn().mockResolvedValue(null) },
    ...overrides,
  } as any;
}

describe("auditTrail canonical #1403 — duplicate removed", () => {
  const dupPath = path.join(__dirname, "..", "repositories", "persistance.ts");

  it("orphaned duplicate file no longer exists", () => {
    expect(fs.existsSync(dupPath)).toBe(false);
  });

  it("canonical service exposes mediator/admin/redaction helpers", async () => {
    const prisma = mockPrisma({
      trade: {
        findUnique: jest.fn().mockResolvedValue({
          tradeId: "t-1",
          buyerAddress: BUYER,
          sellerAddress: SELLER,
          amountUsdc: "100",
          status: TradeStatus.DISPUTED,
          createdAt: new Date("2026-03-01T10:00:00Z"),
          updatedAt: new Date("2026-03-02T10:00:00Z"),
          fundedAt: null,
          deliveredAt: null,
          completedAt: null,
        }),
      },
      dispute: {
        findUnique: jest.fn().mockResolvedValue({
          tradeId: "t-1",
          initiator: BUYER,
          reason: "x",
          status: "OPEN",
          resolvedAt: null,
          createdAt: new Date("2026-03-03T10:00:00Z"),
        }),
      },
    });
    const svc = new AuditTrailService(prisma);
    // Canonical has serializeCanonicalPayload (duplicate used raw JSON.stringify)
    expect(typeof (svc as any).serializeCanonicalPayload).toBe("function");
    // Stranger still denied
    await expect(svc.getTradeHistory("t-1", STRANGER)).rejects.toThrow();
  });

  it("canonical service redacts expired evidence (absent in duplicate)", async () => {
    process.env.EVIDENCE_METADATA_RETENTION_DAYS = "1";
    const prisma = mockPrisma({
      trade: {
        findUnique: jest.fn().mockResolvedValue({
          tradeId: "t-1",
          buyerAddress: BUYER,
          sellerAddress: SELLER,
          amountUsdc: "100",
          status: TradeStatus.FUNDED,
          createdAt: new Date("2026-03-01T10:00:00Z"),
          updatedAt: new Date("2026-03-02T10:00:00Z"),
          fundedAt: null,
          deliveredAt: null,
          completedAt: null,
        }),
      },
      tradeEvidence: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            tradeId: "t-1",
            cid: "bafyold",
            filename: "proof.mp4",
            mimeType: "video/mp4",
            uploadedBy: BUYER,
            createdAt: new Date("2024-01-01T00:00:00Z"),
          },
        ]),
      },
    });
    const svc = new AuditTrailService(prisma);
    const events = await svc.getTradeHistory("t-1", BUYER);
    const vid = events.find((e) => e.eventType === "VIDEO_SUBMITTED");
    expect(vid?.metadata).toMatchObject({ cid: "redacted", retentionExpired: true });
    delete process.env.EVIDENCE_METADATA_RETENTION_DAYS;
  });

  it("canonical service masks vehicle registration for non-admins (absent in duplicate)", async () => {
    const prisma = mockPrisma({
      trade: {
        findUnique: jest.fn().mockResolvedValue({
          tradeId: "t-1",
          buyerAddress: BUYER,
          sellerAddress: SELLER,
          amountUsdc: "100",
          status: TradeStatus.FUNDED,
          createdAt: new Date("2026-03-01T10:00:00Z"),
          updatedAt: new Date("2026-03-02T10:00:00Z"),
          fundedAt: null,
          deliveredAt: null,
          completedAt: null,
        }),
      },
      deliveryManifest: {
        findUnique: jest.fn().mockResolvedValue({
          tradeId: "t-1",
          vehicleRegistration: "ABC-123456",
          expectedDeliveryAt: new Date("2026-03-05T00:00:00Z"),
          createdAt: new Date("2026-03-02T00:00:00Z"),
        }),
      },
    });
    const svc = new AuditTrailService(prisma);
    const events = await svc.getTradeHistory("t-1", BUYER);
    const manifest = events.find((e) => e.eventType === "MANIFEST_SUBMITTED");
    // Masked: first 3 chars + ***
    expect(manifest?.metadata.vehicleRegistration).toBe("ABC***");
  });
});
