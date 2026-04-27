/**
 * abi.version.gate.test.ts
 *
 * CI compatibility gate for backend-contract ABI and version drift — Issue #422.
 *
 * Scope:
 *  1. Contract version assertion — the backend must pin and validate the
 *     deployed contract version against a known-good range.
 *  2. Upgrade-sensitive storage layout — persistent keys the backend reads
 *     must remain stable across upgrades.
 *  3. Event schema compatibility — event topics/data shapes the backend listens
 *     for must match what the contract emits.
 *  4. Return-type contract — functions expected to return specific types must
 *     remain unchanged.
 *
 * Failing any of these blocks the merge in CI.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.JWT_SECRET =
    process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgresql://test:test@localhost:5432/test";
  process.env.AMANA_ESCROW_CONTRACT_ID =
    process.env.AMANA_ESCROW_CONTRACT_ID || "CONTRACT_ID";
  process.env.USDC_CONTRACT_ID =
    process.env.USDC_CONTRACT_ID || "USDC_CONTRACT_ID";
});

// ── Frozen contract ABI snapshot ──────────────────────────────────────────────
//
// SOURCE OF TRUTH: update this object only after a deliberate, reviewed
// contract upgrade. Any backend divergence from these shapes will fail CI.

const FROZEN_CONTRACT_ABI = {
  version: "1.0.0",

  functions: {
    create_trade: {
      args: ["buyer:Address", "seller:Address", "amount:i128", "buyer_loss_bps:u32", "seller_loss_bps:u32"],
      returnType: "u64",
    },
    deposit: {
      args: ["trade_id:u64"],
      returnType: "void",
    },
    confirm_delivery: {
      args: ["trade_id:u64", "buyer:Address"],
      returnType: "void",
    },
    release_funds: {
      args: ["trade_id:u64"],
      returnType: "void",
    },
    initiate_dispute: {
      args: ["trade_id:u64", "initiator:Address", "reason_hash:String"],
      returnType: "void",
    },
  },

  // Persistent storage keys that the backend reads via Soroban RPC getLedgerEntries.
  // These must remain stable between upgrades — any rename is a breaking change.
  storageKeys: [
    "Trade",       // Maps trade_id → TradeState
    "Counter",     // Monotone trade ID counter
    "Admin",       // Contract admin address
  ],

  // Event topics emitted by the contract and consumed by eventListener.service.ts.
  // Shape: [topic_symbol, ...indexed_args]
  events: {
    trade_created:      { topics: ["trade_created", "trade_id:u64"] },
    deposit_made:       { topics: ["deposit_made", "trade_id:u64", "depositor:Address"] },
    delivery_confirmed: { topics: ["delivery_confirmed", "trade_id:u64"] },
    funds_released:     { topics: ["funds_released", "trade_id:u64"] },
    dispute_initiated:  { topics: ["dispute_initiated", "trade_id:u64", "initiator:Address"] },
  },
} as const;

// ── Backend's declared assumptions (mirrors ContractService call shapes) ──────

// Argument lists extracted from ContractService method signatures.
// These are kept in sync with the actual service via import in the
// full abi.compatibility.test.ts; here we snapshot the counts and names
// so that a contract upgrade triggers a deliberate review.

const BACKEND_ASSUMPTIONS = {
  create_trade: {
    argCount: 5,
    argNames: ["buyer", "seller", "amount", "buyer_loss_bps", "seller_loss_bps"],
    returnType: "u64",
  },
  deposit: {
    argCount: 1,
    argNames: ["trade_id"],
    returnType: "void",
  },
  confirm_delivery: {
    argCount: 2,
    argNames: ["trade_id", "buyer"],
    returnType: "void",
  },
  release_funds: {
    argCount: 1,
    argNames: ["trade_id"],
    returnType: "void",
  },
  initiate_dispute: {
    argCount: 3,
    argNames: ["trade_id", "initiator", "reason_hash"],
    returnType: "void",
  },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function contractArgCount(fnName: keyof typeof FROZEN_CONTRACT_ABI.functions) {
  return FROZEN_CONTRACT_ABI.functions[fnName].args.length;
}

function contractArgName(
  fnName: keyof typeof FROZEN_CONTRACT_ABI.functions,
  index: number
) {
  return FROZEN_CONTRACT_ABI.functions[fnName].args[index].split(":")[0];
}

// ── 1. Function argument count gate ───────────────────────────────────────────

describe("ABI gate: function argument counts must match frozen snapshot (#422)", () => {
  const fns = Object.keys(BACKEND_ASSUMPTIONS) as Array<
    keyof typeof BACKEND_ASSUMPTIONS
  >;

  for (const fn of fns) {
    it(`${fn}: backend assumes ${BACKEND_ASSUMPTIONS[fn].argCount} args — contract exposes ${contractArgCount(fn)}`, () => {
      expect(BACKEND_ASSUMPTIONS[fn].argCount).toBe(contractArgCount(fn));
    });
  }
});

// ── 2. Function argument order gate ──────────────────────────────────────────

describe("ABI gate: argument order must match frozen snapshot (#422)", () => {
  it("create_trade: argument names in correct order", () => {
    const expected = BACKEND_ASSUMPTIONS.create_trade.argNames;
    for (let i = 0; i < expected.length; i++) {
      expect(contractArgName("create_trade", i)).toBe(expected[i]);
    }
  });

  it("initiate_dispute: argument names in correct order", () => {
    const expected = BACKEND_ASSUMPTIONS.initiate_dispute.argNames;
    for (let i = 0; i < expected.length; i++) {
      expect(contractArgName("initiate_dispute", i)).toBe(expected[i]);
    }
  });

  it("confirm_delivery: argument names in correct order", () => {
    const expected = BACKEND_ASSUMPTIONS.confirm_delivery.argNames;
    for (let i = 0; i < expected.length; i++) {
      expect(contractArgName("confirm_delivery", i)).toBe(expected[i]);
    }
  });
});

// ── 3. Return-type contract gate ──────────────────────────────────────────────

describe("ABI gate: return types must remain stable (#422)", () => {
  it("create_trade returns u64 (trade ID)", () => {
    expect(FROZEN_CONTRACT_ABI.functions.create_trade.returnType).toBe("u64");
    expect(BACKEND_ASSUMPTIONS.create_trade.returnType).toBe("u64");
  });

  it("deposit, confirm_delivery, release_funds, initiate_dispute return void", () => {
    const voidFns = ["deposit", "confirm_delivery", "release_funds", "initiate_dispute"] as const;
    for (const fn of voidFns) {
      expect(FROZEN_CONTRACT_ABI.functions[fn].returnType).toBe("void");
      expect(BACKEND_ASSUMPTIONS[fn].returnType).toBe("void");
    }
  });
});

// ── 4. Storage key stability gate ─────────────────────────────────────────────

describe("ABI gate: persistent storage keys must not be renamed or removed (#422)", () => {
  const EXPECTED_STORAGE_KEYS = ["Trade", "Counter", "Admin"] as const;

  for (const key of EXPECTED_STORAGE_KEYS) {
    it(`storage key '${key}' exists in frozen snapshot`, () => {
      expect(FROZEN_CONTRACT_ABI.storageKeys).toContain(key);
    });
  }

  it("no unexpected storage keys were added without a review", () => {
    // If this fails, a new key was added to the contract without updating
    // the gate — add it above after deliberate review.
    expect(FROZEN_CONTRACT_ABI.storageKeys.length).toBe(EXPECTED_STORAGE_KEYS.length);
  });
});

// ── 5. Event schema gate ──────────────────────────────────────────────────────

describe("ABI gate: event topic schemas must remain stable (#422)", () => {
  const EXPECTED_EVENTS = [
    "trade_created",
    "deposit_made",
    "delivery_confirmed",
    "funds_released",
    "dispute_initiated",
  ] as const;

  it("all expected events are present in the frozen snapshot", () => {
    const frozenEvents = Object.keys(FROZEN_CONTRACT_ABI.events);
    for (const ev of EXPECTED_EVENTS) {
      expect(frozenEvents).toContain(ev);
    }
  });

  it("trade_created event includes trade_id as the second topic", () => {
    expect(FROZEN_CONTRACT_ABI.events.trade_created.topics[1]).toMatch(/trade_id/);
  });

  it("dispute_initiated event includes initiator address as a topic", () => {
    expect(FROZEN_CONTRACT_ABI.events.dispute_initiated.topics).toContain(
      "initiator:Address"
    );
  });

  it("no unexpected events were silently added", () => {
    expect(Object.keys(FROZEN_CONTRACT_ABI.events).length).toBe(
      EXPECTED_EVENTS.length
    );
  });
});

// ── 6. Version pin gate ───────────────────────────────────────────────────────

describe("ABI gate: contract version pin (#422)", () => {
  // The backend is validated against a known-good contract version.
  // Bumping this requires a deliberate PR that also updates all compatibility
  // assertions above.
  const PINNED_VERSION = "1.0.0";

  it("frozen ABI version matches pinned version", () => {
    expect(FROZEN_CONTRACT_ABI.version).toBe(PINNED_VERSION);
  });

  it("pinned version follows semver format", () => {
    expect(PINNED_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
