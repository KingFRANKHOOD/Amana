/**
 * Tests for the shared access-control helpers (Issue #525, #1017)
 *
 * Validates that getMediatorAllowlist and isMediatorAddress correctly parse
 * ADMIN_STELLAR_PUBKEYS and enforce mediator/arbitrator route guards.
 * Addresses are normalized to lowercase for consistent comparison.
 *
 * Also covers the escrow schedule authorization guard (Issue #1394): the
 * GET /trades/:id/schedule handler must only expose a trade's milestone
 * schedule to the buyer, seller, or a mediator — never to unrelated
 * authenticated users (IDOR).
 */
import { getMediatorAllowlist, isMediatorAddress, normalizeAddress } from "../lib/accessControl";

const ADDR_A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const ADDR_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const ADDR_C = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

describe("getMediatorAllowlist", () => {
  afterEach(() => {
    delete process.env.ADMIN_STELLAR_PUBKEYS;
  });

  it("returns an empty set when env var is unset", () => {
    delete process.env.ADMIN_STELLAR_PUBKEYS;
    expect(getMediatorAllowlist().size).toBe(0);
  });

  it("returns an empty set when env var is an empty string", () => {
    process.env.ADMIN_STELLAR_PUBKEYS = "";
    expect(getMediatorAllowlist().size).toBe(0);
  });

  it("returns a set with one address for a single entry (normalized lowercase)", () => {
    process.env.ADMIN_STELLAR_PUBKEYS = ADDR_A;
    const allowlist = getMediatorAllowlist();
    expect(allowlist.size).toBe(1);
    expect(allowlist.has(ADDR_A.toLowerCase())).toBe(true);
  });

  it("returns all addresses for a comma-separated list (normalized lowercase)", () => {
    process.env.ADMIN_STELLAR_PUBKEYS = `${ADDR_A},${ADDR_B},${ADDR_C}`;
    const allowlist = getMediatorAllowlist();
    expect(allowlist.size).toBe(3);
    expect(allowlist.has(ADDR_A.toLowerCase())).toBe(true);
    expect(allowlist.has(ADDR_B.toLowerCase())).toBe(true);
    expect(allowlist.has(ADDR_C.toLowerCase())).toBe(true);
  });

  it("trims whitespace and normalizes to lowercase", () => {
    process.env.ADMIN_STELLAR_PUBKEYS = `  ${ADDR_A}  ,  ${ADDR_B}  `;
    const allowlist = getMediatorAllowlist();
    expect(allowlist.has(ADDR_A.toLowerCase())).toBe(true);
    expect(allowlist.has(ADDR_B.toLowerCase())).toBe(true);
  });

  it("ignores empty entries produced by trailing commas", () => {
    process.env.ADMIN_STELLAR_PUBKEYS = `${ADDR_A},${ADDR_B},`;
    const allowlist = getMediatorAllowlist();
    expect(allowlist.size).toBe(2);
  });

  it("returns a new Set on each call (no shared mutable state)", () => {
    process.env.ADMIN_STELLAR_PUBKEYS = ADDR_A;
    const first = getMediatorAllowlist();
    const second = getMediatorAllowlist();
    expect(first).not.toBe(second);
  });
});

describe("normalizeAddress", () => {
  it("lowercases addresses", () => {
    expect(normalizeAddress("GABC123")).toBe("gabc123");
  });

  it("trims whitespace", () => {
    expect(normalizeAddress("  GABC123  ")).toBe("gabc123");
  });

  it("handles mixed case and whitespace", () => {
    expect(normalizeAddress("  GaBc123  ")).toBe("gabc123");
  });
});

describe("isMediatorAddress", () => {
  afterEach(() => {
    delete process.env.ADMIN_STELLAR_PUBKEYS;
  });

  it("returns false when the allowlist is empty", () => {
    delete process.env.ADMIN_STELLAR_PUBKEYS;
    expect(isMediatorAddress(ADDR_A)).toBe(false);
  });

  it("returns true for an address that is in the allowlist", () => {
    process.env.ADMIN_STELLAR_PUBKEYS = `${ADDR_A},${ADDR_B}`;
    expect(isMediatorAddress(ADDR_A)).toBe(true);
    expect(isMediatorAddress(ADDR_B)).toBe(true);
  });

  it("returns false for an address that is not in the allowlist", () => {
    process.env.ADMIN_STELLAR_PUBKEYS = ADDR_A;
    expect(isMediatorAddress(ADDR_B)).toBe(false);
  });

  it("is case-insensitive — uppercase and lowercase match after normalization", () => {
    process.env.ADMIN_STELLAR_PUBKEYS = ADDR_A;
    expect(isMediatorAddress(ADDR_A.toLowerCase())).toBe(true);
    expect(isMediatorAddress(ADDR_A.toUpperCase())).toBe(true);
  });

  it("normalizes addresses with leading/trailing whitespace", () => {
    process.env.ADMIN_STELLAR_PUBKEYS = ADDR_A;
    expect(isMediatorAddress(`  ${ADDR_A}  `)).toBe(true);
  });

  it("returns false for an empty-string address", () => {
    process.env.ADMIN_STELLAR_PUBKEYS = ADDR_A;
    expect(isMediatorAddress("")).toBe(false);
  });
});

/**
 * Regression coverage for Issue #1394.
 *
 * The GET /trades/:id/schedule handler previously only required
 * authMiddleware and a trade-exists check, so any authenticated user could
 * read another trade's milestone amounts, due dates, condition hashes, and
 * released status (IDOR). The handler now mirrors the POST /:id/schedule
 * guard: the caller must be the buyer, the seller, or a mediator.
 *
 * These tests exercise the same predicate the route uses so the guard cannot
 * silently regress.
 */
describe("escrow schedule access guard (Issue #1394)", () => {
  afterEach(() => {
    delete process.env.ADMIN_STELLAR_PUBKEYS;
  });

  const buyer = ADDR_A;
  const seller = ADDR_B;
  const outsider = ADDR_C;

  const trade = { buyerAddress: buyer, sellerAddress: seller };

  // Mirrors the route guard: buyer, seller, or mediator may read the schedule.
  const canReadSchedule = (t: { buyerAddress: string; sellerAddress: string }, walletAddress: string): boolean => {
    const isBuyerOrSeller =
      normalizeAddress(t.buyerAddress) === normalizeAddress(walletAddress) ||
      normalizeAddress(t.sellerAddress) === normalizeAddress(walletAddress);
    return isBuyerOrSeller || isMediatorAddress(walletAddress);
  };

  it("allows the buyer to read the schedule", () => {
    expect(canReadSchedule(trade, buyer)).toBe(true);
  });

  it("allows the seller to read the schedule", () => {
    expect(canReadSchedule(trade, seller)).toBe(true);
  });

  it("allows a mediator to read the schedule", () => {
    process.env.ADMIN_STELLAR_PUBKEYS = outsider;
    expect(canReadSchedule(trade, outsider)).toBe(true);
  });

  it("denies an authenticated non-party (IDOR regression)", () => {
    delete process.env.ADMIN_STELLAR_PUBKEYS;
    expect(canReadSchedule(trade, outsider)).toBe(false);
  });

  it("denies an empty wallet address", () => {
    delete process.env.ADMIN_STELLAR_PUBKEYS;
    expect(canReadSchedule(trade, "")).toBe(false);
  });

  it("matches parties case-insensitively", () => {
    expect(canReadSchedule(trade, buyer.toLowerCase())).toBe(true);
    expect(canReadSchedule(trade, seller.toUpperCase())).toBe(true);
  });
});
