/**
 * @jest-environment node
 */
import fs from "fs";
import path from "path";
import {
  BACKEND_TRADE_STATUSES,
  TRADE_FILTER_STATUSES,
  toBackendStatus,
} from "../tradeStatusFilter";

// Contract test: the frontend mirror must match the backend Prisma enum that
// GET /trades validates `status` against, so drift between services fails here.
function readPrismaTradeStatusEnum(): string[] {
  const schemaPath = path.resolve(__dirname, "../../../../../backend/prisma/schema.prisma");
  const schema = fs.readFileSync(schemaPath, "utf8");
  const match = schema.match(/enum\s+TradeStatus\s*\{([^}]*)\}/);
  if (!match) throw new Error("TradeStatus enum not found in schema.prisma");
  return match[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter(Boolean);
}

describe("trade status filter mapping", () => {
  it("mirrors the backend TradeStatus enum exactly", () => {
    expect([...BACKEND_TRADE_STATUSES].sort()).toEqual(readPrismaTradeStatusEnum().sort());
  });

  it("sends no status for the 'all' tab", () => {
    expect(toBackendStatus("all")).toBeUndefined();
  });

  it.each(TRADE_FILTER_STATUSES.filter((s) => s !== "all"))(
    "maps the '%s' tab to a valid backend enum value",
    (filter) => {
      const status = toBackendStatus(filter);
      expect(status).toBeDefined();
      expect(readPrismaTradeStatusEnum()).toContain(status);
    },
  );

  it("maps each tab to the expected backend status", () => {
    expect(toBackendStatus("active")).toBe("FUNDED");
    expect(toBackendStatus("pending")).toBe("PENDING_SIGNATURE");
    expect(toBackendStatus("completed")).toBe("COMPLETED");
    expect(toBackendStatus("disputed")).toBe("DISPUTED");
  });
});
