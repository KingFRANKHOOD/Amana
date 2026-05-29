/**
 * Tests for DisputeService.purgeCompletedDisputeData (Issue #524)
 *
 * Validates the data-cleanup contract:
 *  - Only mediators can trigger the purge
 *  - Only RESOLVED/CLOSED disputes older than the cutoff are affected
 *  - Active/open disputes are never touched
 *  - Returns correct metadata (purgedCount, tradeIds)
 */
import { PrismaClient, DisputeStatus } from "@prisma/client";
import { DisputeService, COMPLETED_DISPUTE_STATUSES } from "../services/dispute.service";
import { ErrorCode } from "../errors/errorCodes";

const MEDIATOR = "GA_MEDIATOR_ADDR_VALID";
const NOW = new Date("2025-06-01T00:00:00.000Z");
const OLD_DATE = new Date("2024-12-01T00:00:00.000Z"); // > 90 days ago
const RECENT_DATE = new Date("2025-05-25T00:00:00.000Z"); // < 90 days ago

function createMockPrisma() {
  return {
    dispute: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  } as unknown as PrismaClient;
}

describe("DisputeService – purgeCompletedDisputeData", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: DisputeService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new DisputeService(prisma as any);
    process.env.ADMIN_STELLAR_PUBKEYS = MEDIATOR;
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    delete process.env.ADMIN_STELLAR_PUBKEYS;
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("throws AUTH_ERROR when caller is not a mediator", async () => {
    await expect(
      service.purgeCompletedDisputeData("GA_ATTACKER")
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_ERROR });
    expect(prisma.dispute.findMany).not.toHaveBeenCalled();
    expect(prisma.dispute.updateMany).not.toHaveBeenCalled();
  });

  it("returns zero purgedCount when no completed disputes qualify", async () => {
    (prisma.dispute.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.purgeCompletedDisputeData(MEDIATOR);

    expect(result.purgedCount).toBe(0);
    expect(result.tradeIds).toEqual([]);
    expect(prisma.dispute.updateMany).not.toHaveBeenCalled();
  });

  it("purges reason field for qualifying completed disputes", async () => {
    const rows = [
      { id: 1, tradeId: "T-001" },
      { id: 2, tradeId: "T-002" },
    ];
    (prisma.dispute.findMany as jest.Mock).mockResolvedValue(rows);
    (prisma.dispute.updateMany as jest.Mock).mockResolvedValue({ count: 2 });

    const result = await service.purgeCompletedDisputeData(MEDIATOR);

    expect(result.purgedCount).toBe(2);
    expect(result.tradeIds).toEqual(["T-001", "T-002"]);
    expect(prisma.dispute.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] } },
      data: { reason: "" },
    });
  });

  it("queries with status filter limited to completed statuses", async () => {
    (prisma.dispute.findMany as jest.Mock).mockResolvedValue([]);

    await service.purgeCompletedDisputeData(MEDIATOR);

    expect(prisma.dispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: COMPLETED_DISPUTE_STATUSES },
        }),
      })
    );
  });

  it("queries with a cutoff date based on olderThanDays", async () => {
    (prisma.dispute.findMany as jest.Mock).mockResolvedValue([]);

    await service.purgeCompletedDisputeData(MEDIATOR, 90);

    const call = (prisma.dispute.findMany as jest.Mock).mock.calls[0][0];
    const cutoff: Date = call.where.resolvedAt.lte;
    const expectedCutoff = new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000);
    expect(cutoff.getTime()).toBe(expectedCutoff.getTime());
  });

  it("respects custom olderThanDays parameter", async () => {
    (prisma.dispute.findMany as jest.Mock).mockResolvedValue([]);

    await service.purgeCompletedDisputeData(MEDIATOR, 30);

    const call = (prisma.dispute.findMany as jest.Mock).mock.calls[0][0];
    const cutoff: Date = call.where.resolvedAt.lte;
    const expectedCutoff = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(cutoff.getTime()).toBe(expectedCutoff.getTime());
  });

  it("does not call updateMany when findMany returns empty", async () => {
    (prisma.dispute.findMany as jest.Mock).mockResolvedValue([]);

    await service.purgeCompletedDisputeData(MEDIATOR);

    expect(prisma.dispute.updateMany).not.toHaveBeenCalled();
  });

  it("only selects id and tradeId in the query to minimise data exposure", async () => {
    (prisma.dispute.findMany as jest.Mock).mockResolvedValue([]);

    await service.purgeCompletedDisputeData(MEDIATOR);

    expect(prisma.dispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, tradeId: true },
      })
    );
  });
});

describe("COMPLETED_DISPUTE_STATUSES constant", () => {
  it("contains RESOLVED and CLOSED", () => {
    expect(COMPLETED_DISPUTE_STATUSES).toContain(DisputeStatus.RESOLVED);
    expect(COMPLETED_DISPUTE_STATUSES).toContain(DisputeStatus.CLOSED);
  });

  it("does not contain OPEN or UNDER_REVIEW", () => {
    expect(COMPLETED_DISPUTE_STATUSES).not.toContain(DisputeStatus.OPEN);
    expect(COMPLETED_DISPUTE_STATUSES).not.toContain(DisputeStatus.UNDER_REVIEW);
  });
});
