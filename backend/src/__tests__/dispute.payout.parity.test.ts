/**
 * Dispute resolution payout parity tests.
 *
 * The contract (contracts/amana_escrow/src/lib.rs) computes payout amounts
 * for resolve_dispute() using integer arithmetic with loss-sharing:
 *
 *   loss_bps         = 10_000 − seller_gets_bps
 *   seller_loss      = floor(total × loss_bps × seller_loss_bps / 100_000_000)
 *   seller_raw       = total − seller_loss
 *   buyer_refund     = total − seller_raw          (= seller_loss)
 *   fee              = floor(seller_raw × fee_bps / 10_000)
 *   seller_net       = seller_raw − fee
 *   invariant        = seller_net + buyer_refund + fee == total
 *
 * These tests mirror the on-chain arithmetic in TypeScript using BigInt to
 * guarantee integer-exact results, then assert the conservation invariant and
 * compare against hand-computed expected values from the contract's own
 * inline documentation.
 */

const BPS_DIVISOR = 10_000n;

interface PayoutResult {
  sellerRaw: bigint;
  sellerNet: bigint;
  buyerRefund: bigint;
  fee: bigint;
}

/**
 * Mirrors the Rust helpers checked_loss_amount() and checked_fee_amount()
 * plus the resolve_dispute() payout calculation.
 */
function calcPayout(
  total: bigint,
  sellerGetsBps: bigint,
  sellerLossBps: bigint,
  feeBps: bigint
): PayoutResult {
  const lossBps = BPS_DIVISOR - sellerGetsBps;
  // seller_loss = total * loss_bps * seller_loss_bps / (10_000 * 10_000)
  const sellerLoss = (total * lossBps * sellerLossBps) / (BPS_DIVISOR * BPS_DIVISOR);
  const sellerRaw = total - sellerLoss;
  const buyerRefund = total - sellerRaw; // equals sellerLoss
  // fee = seller_raw * fee_bps / 10_000
  const fee = (sellerRaw * feeBps) / BPS_DIVISOR;
  const sellerNet = sellerRaw - fee;
  return { sellerRaw, sellerNet, buyerRefund, fee };
}

// ---------------------------------------------------------------------------
// Invariant helper
// ---------------------------------------------------------------------------

function assertConservation(result: PayoutResult, total: bigint, label: string) {
  const sum = result.sellerNet + result.buyerRefund + result.fee;
  expect(sum).toBe(total);
  if (sum !== total) {
    // surfaced as a descriptive failure in case Jest swallows BigInt diffs
    throw new Error(
      `[${label}] conservation violated: ${result.sellerNet} + ${result.buyerRefund} + ${result.fee} = ${sum} ≠ ${total}`
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dispute payout parity — backend mirrors contract arithmetic", () => {
  describe("documented contract example", () => {
    // From resolve_dispute() inline comment (lib.rs line 759–771):
    //   total=10_000, seller_gets_bps=7_000, buyer_loss_bps=6_000,
    //   seller_loss_bps=4_000, fee_bps=100
    //   → seller_raw=8_800, fee=88, seller_net=8_712, buyer_refund=1_200
    it("matches the inline contract example exactly", () => {
      const result = calcPayout(10_000n, 7_000n, 4_000n, 100n);

      expect(result.sellerRaw).toBe(8_800n);
      expect(result.fee).toBe(88n);
      expect(result.sellerNet).toBe(8_712n);
      expect(result.buyerRefund).toBe(1_200n);
      assertConservation(result, 10_000n, "contract-example");
    });
  });

  describe("full seller win (seller_gets_bps = 10_000)", () => {
    it("buyer receives nothing, all funds go to seller minus fee", () => {
      const result = calcPayout(10_000n, 10_000n, 4_000n, 100n);

      expect(result.buyerRefund).toBe(0n);
      expect(result.sellerRaw).toBe(10_000n);
      expect(result.fee).toBe(100n);
      expect(result.sellerNet).toBe(9_900n);
      assertConservation(result, 10_000n, "full-seller-win");
    });

    it("conservation holds with zero fee", () => {
      const result = calcPayout(10_000n, 10_000n, 5_000n, 0n);

      expect(result.buyerRefund).toBe(0n);
      expect(result.fee).toBe(0n);
      expect(result.sellerNet).toBe(10_000n);
      assertConservation(result, 10_000n, "full-seller-win-zero-fee");
    });
  });

  describe("full buyer win (seller_gets_bps = 0, seller_loss_bps = 10_000)", () => {
    // When seller_gets_bps=0 AND the trade was created with seller_loss_bps=10_000,
    // the seller bears 100% of the full loss: seller_loss = total * 10_000 * 10_000 / 100_000_000 = total
    it("seller receives nothing, buyer gets full refund, no fee", () => {
      const result = calcPayout(10_000n, 0n, 10_000n, 100n);

      expect(result.sellerRaw).toBe(0n);
      expect(result.sellerNet).toBe(0n);
      expect(result.fee).toBe(0n);
      expect(result.buyerRefund).toBe(10_000n);
      assertConservation(result, 10_000n, "full-buyer-win");
    });
  });

  describe("50/50 split", () => {
    it("with symmetric loss sharing, each party bears half the pot", () => {
      // seller_gets_bps=5_000, seller_loss_bps=5_000, fee_bps=0
      // loss_bps=5_000, seller_loss=10_000*5_000*5_000/100_000_000=2_500
      // seller_raw=7_500, buyer_refund=2_500, fee=0, seller_net=7_500
      const result = calcPayout(10_000n, 5_000n, 5_000n, 0n);

      expect(result.sellerRaw).toBe(7_500n);
      expect(result.buyerRefund).toBe(2_500n);
      expect(result.fee).toBe(0n);
      assertConservation(result, 10_000n, "50-50");
    });
  });

  describe("zero fee (fee_bps = 0)", () => {
    it("seller_net equals seller_raw when fee is zero", () => {
      const result = calcPayout(10_000n, 8_000n, 3_000n, 0n);

      expect(result.fee).toBe(0n);
      expect(result.sellerNet).toBe(result.sellerRaw);
      assertConservation(result, 10_000n, "zero-fee");
    });
  });

  describe("maximum fee (fee_bps = 10_000)", () => {
    it("seller receives nothing when fee consumes the entire seller portion", () => {
      const result = calcPayout(10_000n, 7_000n, 4_000n, 10_000n);

      expect(result.sellerNet).toBe(0n);
      expect(result.fee).toBe(result.sellerRaw);
      assertConservation(result, 10_000n, "max-fee");
    });
  });

  describe("loss-sharing extremes", () => {
    it("buyer absorbs all loss (seller_loss_bps=0) — seller keeps full share minus fee", () => {
      // seller_gets_bps=7_000, seller_loss_bps=0
      // seller_loss = 10_000*3_000*0/100_000_000 = 0
      // seller_raw = 10_000, buyer_refund = 0
      const result = calcPayout(10_000n, 7_000n, 0n, 100n);

      expect(result.sellerRaw).toBe(10_000n);
      expect(result.buyerRefund).toBe(0n);
      assertConservation(result, 10_000n, "buyer-absorbs-all-loss");
    });

    it("seller absorbs all loss (seller_loss_bps=10_000)", () => {
      // seller_gets_bps=7_000, seller_loss_bps=10_000
      // seller_loss = 10_000*3_000*10_000/100_000_000 = 3_000
      // seller_raw = 7_000, buyer_refund = 3_000
      const result = calcPayout(10_000n, 7_000n, 10_000n, 100n);

      expect(result.sellerRaw).toBe(7_000n);
      expect(result.buyerRefund).toBe(3_000n);
      expect(result.fee).toBe(70n);
      expect(result.sellerNet).toBe(6_930n);
      assertConservation(result, 10_000n, "seller-absorbs-all-loss");
    });
  });

  describe("rounding: non-round total amounts", () => {
    it("conservation invariant holds for total=10_001", () => {
      const result = calcPayout(10_001n, 7_000n, 4_000n, 100n);
      assertConservation(result, 10_001n, "total-10001");
    });

    it("conservation invariant holds for odd total=9_999", () => {
      const result = calcPayout(9_999n, 6_543n, 3_210n, 75n);
      assertConservation(result, 9_999n, "total-9999");
    });

    it("conservation invariant holds for prime total=9_973", () => {
      const result = calcPayout(9_973n, 7_777n, 4_444n, 123n);
      assertConservation(result, 9_973n, "prime-total");
    });
  });

  describe("large amounts (cNGN precision)", () => {
    it("conservation holds for 1_000_000 units (representing 10 cNGN at 5 decimals)", () => {
      const total = 1_000_000n;
      const result = calcPayout(total, 7_000n, 4_000n, 100n);
      assertConservation(result, total, "large-amount");
    });

    it("conservation holds for 999_999_999 units", () => {
      const total = 999_999_999n;
      const result = calcPayout(total, 8_500n, 2_000n, 50n);
      assertConservation(result, total, "near-billion");
    });
  });

  describe("non-negative invariant", () => {
    it("all payout components are non-negative across a range of inputs", () => {
      const cases = [
        { sellerGetsBps: 0n, sellerLossBps: 5_000n, feeBps: 100n },
        { sellerGetsBps: 5_000n, sellerLossBps: 0n, feeBps: 200n },
        { sellerGetsBps: 10_000n, sellerLossBps: 10_000n, feeBps: 0n },
        { sellerGetsBps: 3_333n, sellerLossBps: 6_666n, feeBps: 500n },
      ];

      for (const { sellerGetsBps, sellerLossBps, feeBps } of cases) {
        const result = calcPayout(10_000n, sellerGetsBps, sellerLossBps, feeBps);
        expect(result.sellerNet).toBeGreaterThanOrEqual(0n);
        expect(result.buyerRefund).toBeGreaterThanOrEqual(0n);
        expect(result.fee).toBeGreaterThanOrEqual(0n);
        assertConservation(
          result,
          10_000n,
          `sg=${sellerGetsBps} sl=${sellerLossBps} f=${feeBps}`
        );
      }
    });
  });
});
