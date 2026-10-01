/**
 * Regression test for issue #1402:
 * Export worker never scoped the trade query to the requesting user.
 */

let capturedProcessor: ((job: any) => Promise<any>) | null = null;

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), close: jest.fn() })),
  Worker: jest.fn().mockImplementation((_name: string, proc: any) => {
    capturedProcessor = proc;
    return { close: jest.fn(), on: jest.fn() };
  }),
}));

jest.mock("ioredis", () => jest.fn().mockImplementation(() => ({ quit: jest.fn() })));

jest.mock("../middleware/logger", () => ({
  appLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockChildLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("../lib/logging", () => ({
  getJobContextualLogger: jest.fn().mockReturnValue(mockChildLogger),
}));

jest.mock("../lib/bullMetrics", () => ({
  bullJobDuration: { record: jest.fn() },
  bullJobFailedTotal: { add: jest.fn() },
}));

const mockFindMany = jest.fn().mockResolvedValue([]);
jest.mock("../lib/db", () => ({
  prisma: {
    trade: { findMany: (...args: any[]) => mockFindMany(...args) },
  },
}));

import { createExportWorker } from "../jobs/workers/export.worker";

describe("export.worker #1402 — per-user scoping", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    capturedProcessor = null;
    createExportWorker();
    expect(capturedProcessor).not.toBeNull();
  });

  it("scopes empty-filter exports to requestedBy via AND+OR", async () => {
    await capturedProcessor!({ id: "j-1", data: { requestedBy: "GaBuyer123", format: "json" } });
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const where = mockFindMany.mock.calls[0][0].where;
    // Must be AND-wrapped with owner OR clause
    expect(where).toHaveProperty("AND");
    const andClauses = where.AND as Array<Record<string, unknown>>;
    const ownerClause = andClauses.find((c) => "OR" in c) as any;
    expect(ownerClause).toBeDefined();
    // Normalized to lowercase
    expect(ownerClause.OR).toEqual([
      { buyerAddress: "gabuyer123" },
      { sellerAddress: "gabuyer123" },
    ]);
  });

  it("intersects caller filters with owner scope (cannot broaden)", async () => {
    await capturedProcessor!({
      id: "j-2",
      data: {
        requestedBy: "owner1",
        format: "json",
        filters: { status: "FUNDED", buyerAddress: "attacker-other-user" },
        tradeIds: ["t-1", "t-2"],
      },
    });
    const where = mockFindMany.mock.calls[0][0].where;
    const andClauses = where.AND as Array<Record<string, unknown>>;
    // Filters preserved but ANDed with owner constraint
    expect(andClauses).toContainEqual({ status: "FUNDED", buyerAddress: "attacker-other-user" });
    expect(andClauses).toContainEqual({ tradeId: { in: ["t-1", "t-2"] } });
    expect(andClauses).toContainEqual({
      OR: [{ buyerAddress: "owner1" }, { sellerAddress: "owner1" }],
    });
  });

  it("rejects jobs with missing requestedBy", async () => {
    await expect(
      capturedProcessor!({ id: "j-3", data: { requestedBy: "", format: "json" } }),
    ).rejects.toThrow("missing requestedBy");
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("rejects jobs with whitespace-only requestedBy", async () => {
    await expect(
      capturedProcessor!({ id: "j-4", data: { requestedBy: "   ", format: "csv" } }),
    ).rejects.toThrow();
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});
