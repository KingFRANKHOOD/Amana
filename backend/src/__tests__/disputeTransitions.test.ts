import { jest } from "@jest/globals";
import { DisputeStatus } from "@prisma/client";
import {
  applyDisputeStatusTransition,
  syncDisputeInitiatedFromChain,
  syncDisputeResolvedFromChain,
} from "../services/disputeTransitions";

function createMockTx() {
  return {
    dispute: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  } as any;
}

describe("disputeTransitions", () => {
  let mockTx: ReturnType<typeof createMockTx>;

  beforeEach(() => {
    mockTx = createMockTx();
  });

  describe("applyDisputeStatusTransition", () => {
    it("returns true when CAS update succeeds", async () => {
      (mockTx.dispute.updateMany as any).mockResolvedValue({ count: 1 });

      const applied = await applyDisputeStatusTransition(
        mockTx,
        { id: 1, status: DisputeStatus.OPEN, version: 2 },
        DisputeStatus.UNDER_REVIEW,
      );

      expect(applied).toBe(true);
      expect(mockTx.dispute.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: DisputeStatus.OPEN, version: 2 },
        data: {
          status: DisputeStatus.UNDER_REVIEW,
          version: { increment: 1 },
        },
      });
    });

    it("returns false when another writer wins the race", async () => {
      (mockTx.dispute.updateMany as any).mockResolvedValue({ count: 0 });

      const applied = await applyDisputeStatusTransition(
        mockTx,
        { id: 1, status: DisputeStatus.OPEN, version: 2 },
        DisputeStatus.UNDER_REVIEW,
      );

      expect(applied).toBe(false);
    });
  });

  describe("syncDisputeInitiatedFromChain", () => {
    it("creates an OPEN dispute when none exists", async () => {
      (mockTx.dispute.findUnique as any).mockResolvedValue(null);

      await syncDisputeInitiatedFromChain(mockTx, "T-001", "GA_BUYER");

      expect(mockTx.dispute.create).toHaveBeenCalledWith({
        data: {
          tradeId: "T-001",
          initiator: "GA_BUYER",
          reason: "On-chain dispute initiation",
          status: DisputeStatus.OPEN,
          version: 0,
        },
      });
    });

    it("is idempotent when a dispute row already exists", async () => {
      (mockTx.dispute.findUnique as any).mockResolvedValue({
        id: 1,
        tradeId: "T-001",
        status: DisputeStatus.OPEN,
      });

      await syncDisputeInitiatedFromChain(mockTx, "T-001", "GA_BUYER");

      expect(mockTx.dispute.create).not.toHaveBeenCalled();
    });
  });

  describe("syncDisputeResolvedFromChain", () => {
    it("marks active disputes RESOLVED with a version guard", async () => {
      (mockTx.dispute.findUnique as any).mockResolvedValue({
        id: 9,
        tradeId: "T-001",
        status: DisputeStatus.OPEN,
        version: 4,
      });
      (mockTx.dispute.updateMany as any).mockResolvedValue({ count: 1 });

      await syncDisputeResolvedFromChain(mockTx, "T-001");

      expect(mockTx.dispute.updateMany).toHaveBeenCalledWith({
        where: {
          id: 9,
          status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
          version: 4,
        },
        data: {
          status: DisputeStatus.RESOLVED,
          resolvedAt: expect.any(Date),
          version: { increment: 1 },
        },
      });
    });

    it("no-ops when the dispute is already terminal", async () => {
      (mockTx.dispute.findUnique as any).mockResolvedValue({
        id: 9,
        tradeId: "T-001",
        status: DisputeStatus.RESOLVED,
        version: 5,
      });

      await syncDisputeResolvedFromChain(mockTx, "T-001");

      expect(mockTx.dispute.updateMany).not.toHaveBeenCalled();
    });

    it("throws when the CAS update loses a concurrent race", async () => {
      (mockTx.dispute.findUnique as any).mockResolvedValue({
        id: 9,
        tradeId: "T-001",
        status: DisputeStatus.UNDER_REVIEW,
        version: 1,
      });
      (mockTx.dispute.updateMany as any).mockResolvedValue({ count: 0 });

      await expect(syncDisputeResolvedFromChain(mockTx, "T-001")).rejects.toThrow(
        "Dispute concurrency conflict during chain sync",
      );
    });
  });
});
