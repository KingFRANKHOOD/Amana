import { PrismaClient, DisputeStatus } from "@prisma/client";
import { DisputeService } from "../services/dispute.service";
import { AppError, ErrorCode } from "../errors/errorCodes";

const MEDIATOR = "GA_MEDIATOR_VALID";

function createMockPrisma() {
  const txClient = {
    dispute: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  return {
    dispute: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient)),
    _tx: txClient,
  } as unknown as PrismaClient & { _tx: typeof txClient };
}

function makeDispute(status: DisputeStatus, id = 1, tradeId = "T-001", version = 0) {
  const now = new Date();
  return {
    id,
    tradeId,
    initiator: "GA_BUYER",
    reason: "Item not received",
    status,
    version,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    trade: { buyerAddress: "GA_BUYER", sellerAddress: "GA_SELLER", amountUsdc: "100" },
  };
}

describe("DisputeService – status transitions", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: DisputeService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new DisputeService(prisma as any);
    process.env.ADMIN_STELLAR_PUBKEYS = MEDIATOR;
  });

  afterEach(() => {
    delete process.env.ADMIN_STELLAR_PUBKEYS;
    jest.clearAllMocks();
  });

  function mockSuccessfulTransition(
    dispute: ReturnType<typeof makeDispute>,
    newStatus: DisputeStatus,
    resolvedAt: Date | null = null,
  ) {
    const updated = {
      ...dispute,
      status: newStatus,
      version: dispute.version + 1,
      resolvedAt,
    };

    prisma._tx.dispute.findFirst.mockResolvedValue(dispute);
    prisma._tx.dispute.updateMany.mockResolvedValue({ count: 1 });
    prisma._tx.dispute.findUniqueOrThrow.mockResolvedValue(updated);
    return updated;
  }

  // ── Valid forward transitions ─────────────────────────────────────────────

  it("OPEN → UNDER_REVIEW: succeeds and persists new status with CAS", async () => {
    const dispute = makeDispute(DisputeStatus.OPEN);
    mockSuccessfulTransition(dispute, DisputeStatus.UNDER_REVIEW);

    const result = await service.transitionDisputeStatus("T-001", MEDIATOR, DisputeStatus.UNDER_REVIEW);

    expect(prisma._tx.dispute.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: dispute.id, status: DisputeStatus.OPEN, version: 0 },
        data: expect.objectContaining({
          status: DisputeStatus.UNDER_REVIEW,
          version: { increment: 1 },
        }),
      }),
    );
    expect(result.status).toBe(DisputeStatus.UNDER_REVIEW);
  });

  it("OPEN → CLOSED: succeeds and sets resolvedAt", async () => {
    const dispute = makeDispute(DisputeStatus.OPEN);
    mockSuccessfulTransition(dispute, DisputeStatus.CLOSED, new Date());

    const result = await service.transitionDisputeStatus("T-001", MEDIATOR, DisputeStatus.CLOSED);

    expect(prisma._tx.dispute.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ resolvedAt: expect.any(Date) }),
      }),
    );
    expect(result.status).toBe(DisputeStatus.CLOSED);
    expect(result.resolvedAt).toBeDefined();
  });

  it("UNDER_REVIEW → RESOLVED: succeeds and sets resolvedAt", async () => {
    const dispute = makeDispute(DisputeStatus.UNDER_REVIEW);
    mockSuccessfulTransition(dispute, DisputeStatus.RESOLVED, new Date());

    const result = await service.transitionDisputeStatus("T-001", MEDIATOR, DisputeStatus.RESOLVED);

    expect(result.status).toBe(DisputeStatus.RESOLVED);
    expect(result.resolvedAt).toBeDefined();
  });

  it("UNDER_REVIEW → CLOSED: succeeds and sets resolvedAt", async () => {
    const dispute = makeDispute(DisputeStatus.UNDER_REVIEW);
    mockSuccessfulTransition(dispute, DisputeStatus.CLOSED, new Date());

    const result = await service.transitionDisputeStatus("T-001", MEDIATOR, DisputeStatus.CLOSED);

    expect(result.status).toBe(DisputeStatus.CLOSED);
    expect(result.resolvedAt).toBeDefined();
  });

  // ── Invalid / blocked transitions ────────────────────────────────────────

  it("OPEN → RESOLVED: throws DISPUTE_STATUS_TRANSITION_INVALID (skip UNDER_REVIEW)", async () => {
    prisma._tx.dispute.findFirst.mockResolvedValue(makeDispute(DisputeStatus.OPEN));

    await expect(
      service.transitionDisputeStatus("T-001", MEDIATOR, DisputeStatus.RESOLVED),
    ).rejects.toMatchObject({
      code: ErrorCode.DISPUTE_STATUS_TRANSITION_INVALID,
    });
    expect(prisma._tx.dispute.updateMany).not.toHaveBeenCalled();
  });

  it("RESOLVED → any: throws DISPUTE_STATUS_TRANSITION_INVALID (terminal state)", async () => {
    prisma._tx.dispute.findFirst.mockResolvedValue(makeDispute(DisputeStatus.RESOLVED));

    for (const next of [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW, DisputeStatus.CLOSED]) {
      await expect(
        service.transitionDisputeStatus("T-001", MEDIATOR, next),
      ).rejects.toMatchObject({
        code: ErrorCode.DISPUTE_STATUS_TRANSITION_INVALID,
      });
    }
    expect(prisma._tx.dispute.updateMany).not.toHaveBeenCalled();
  });

  it("CLOSED → any: throws DISPUTE_STATUS_TRANSITION_INVALID (terminal state)", async () => {
    prisma._tx.dispute.findFirst.mockResolvedValue(makeDispute(DisputeStatus.CLOSED));

    for (const next of [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW, DisputeStatus.RESOLVED]) {
      await expect(
        service.transitionDisputeStatus("T-001", MEDIATOR, next),
      ).rejects.toMatchObject({
        code: ErrorCode.DISPUTE_STATUS_TRANSITION_INVALID,
      });
    }
  });

  it("UNDER_REVIEW → OPEN: throws DISPUTE_STATUS_TRANSITION_INVALID (backwards move)", async () => {
    prisma._tx.dispute.findFirst.mockResolvedValue(makeDispute(DisputeStatus.UNDER_REVIEW));

    await expect(
      service.transitionDisputeStatus("T-001", MEDIATOR, DisputeStatus.OPEN),
    ).rejects.toMatchObject({
      code: ErrorCode.DISPUTE_STATUS_TRANSITION_INVALID,
    });
    expect(prisma._tx.dispute.updateMany).not.toHaveBeenCalled();
  });

  it("invalid transition error includes currentStatus, requestedStatus, and allowedTransitions", async () => {
    prisma._tx.dispute.findFirst.mockResolvedValue(makeDispute(DisputeStatus.OPEN));

    let caught: AppError | undefined;
    try {
      await service.transitionDisputeStatus("T-001", MEDIATOR, DisputeStatus.RESOLVED);
    } catch (e) {
      caught = e as AppError;
    }

    expect(caught).toBeDefined();
    expect(caught!.code).toBe(ErrorCode.DISPUTE_STATUS_TRANSITION_INVALID);
    expect(caught!.details).toMatchObject({
      currentStatus: DisputeStatus.OPEN,
      requestedStatus: DisputeStatus.RESOLVED,
      allowedTransitions: expect.arrayContaining([DisputeStatus.UNDER_REVIEW, DisputeStatus.CLOSED]),
    });
  });

  // ── Concurrency ───────────────────────────────────────────────────────────

  it("throws DISPUTE_STATUS_CONFLICT when another writer wins the CAS race", async () => {
    const dispute = makeDispute(DisputeStatus.OPEN);
    prisma._tx.dispute.findFirst.mockResolvedValue(dispute);
    prisma._tx.dispute.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.transitionDisputeStatus("T-001", MEDIATOR, DisputeStatus.UNDER_REVIEW),
    ).rejects.toMatchObject({
      code: ErrorCode.DISPUTE_STATUS_CONFLICT,
      statusCode: 409,
    });
    expect(prisma._tx.dispute.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  // ── Authorization ─────────────────────────────────────────────────────────

  it("throws AUTH_ERROR if caller is not a mediator", async () => {
    await expect(
      service.transitionDisputeStatus("T-001", "GA_NOT_MEDIATOR", DisputeStatus.UNDER_REVIEW),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_ERROR });
    expect(prisma._tx.dispute.findFirst).not.toHaveBeenCalled();
  });

  it("throws DISPUTE_NOT_FOUND if no dispute exists for the trade", async () => {
    prisma._tx.dispute.findFirst.mockResolvedValue(null);

    await expect(
      service.transitionDisputeStatus("T-UNKNOWN", MEDIATOR, DisputeStatus.UNDER_REVIEW),
    ).rejects.toMatchObject({ code: ErrorCode.DISPUTE_NOT_FOUND });
    expect(prisma._tx.dispute.updateMany).not.toHaveBeenCalled();
  });

  // ── listMediatorDisputes ──────────────────────────────────────────────────

  it("listMediatorDisputes returns all disputes by default when no status filter", async () => {
    const disputes = [
      makeDispute(DisputeStatus.OPEN, 1, "T-A"),
      makeDispute(DisputeStatus.UNDER_REVIEW, 2, "T-B"),
      makeDispute(DisputeStatus.RESOLVED, 3, "T-C"),
      makeDispute(DisputeStatus.CLOSED, 4, "T-D"),
    ];

    (prisma.dispute.findMany as jest.Mock).mockResolvedValue(disputes);
    (prisma.dispute.count as jest.Mock).mockResolvedValue(4);

    const result = await service.listMediatorDisputes(MEDIATOR);

    expect(prisma.dispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
    expect(result.items).toHaveLength(4);
    expect(result.pagination.total).toBe(4);
  });

  it("listMediatorDisputes filters by specific status when provided", async () => {
    (prisma.dispute.findMany as jest.Mock).mockResolvedValue([makeDispute(DisputeStatus.RESOLVED, 3, "T-C")]);
    (prisma.dispute.count as jest.Mock).mockResolvedValue(1);

    const result = await service.listMediatorDisputes(MEDIATOR, { status: DisputeStatus.RESOLVED });

    expect(prisma.dispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: DisputeStatus.RESOLVED } }),
    );
    expect(result.items[0].status).toBe(DisputeStatus.RESOLVED);
  });

  it("listMediatorDisputes throws AUTH_ERROR for non-mediator callers", async () => {
    await expect(
      service.listMediatorDisputes("GA_ATTACKER"),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_ERROR });
    expect(prisma.dispute.findMany).not.toHaveBeenCalled();
  });

  it("listMediatorDisputes paginates correctly", async () => {
    (prisma.dispute.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.dispute.count as jest.Mock).mockResolvedValue(50);

    const result = await service.listMediatorDisputes(MEDIATOR, { page: 3, limit: 10 });

    expect(prisma.dispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
    expect(result.pagination).toMatchObject({
      page: 3,
      limit: 10,
      total: 50,
      totalPages: 5,
    });
  });
});
