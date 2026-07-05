# ADR-002: Escrow Loss-Sharing Model

## Status

Accepted (implemented in `contracts/amana_escrow/src/lib.rs`,
`resolve_dispute`; surfaced to API consumers as `buyerLossBps`/
`sellerLossBps` on trade creation - see
[docs/api/trades.md](../api/trades.md#create-a-trade)).

## Context

Amana escrows funds during a trade and, on a dispute, a mediator has to
decide how much of the total goes to the seller vs. is refunded to the
buyer. A binary "seller gets everything" or "buyer gets everything"
outcome doesn't reflect the reality of most delivery disputes (e.g. goods
arrived late but usable, or partially damaged) - most disputes resolve
somewhere in between.

We needed a payout model that:
- Lets a mediator issue a partial ruling (e.g. "seller gets 70%") without
  the contract needing dispute-specific logic per case.
  Lets the two parties pre-agree, at trade creation, how *they personally*
  want any eventual loss split between them - some trade pairs may agree
  the buyer should absorb more risk (e.g. buyer is testing an unproven
  seller), others the opposite.
- Is exact integer arithmetic on-chain (no floats in Soroban), auditable,
  and cannot be gamed by rounding in either party's favor.

## Decision

Basis points (bps, 1/100th of a percent, `BPS_DIVISOR = 10_000`) are used
throughout instead of percentages or decimals, matching how Stellar/Soroban
fee configuration already works elsewhere in the contract (`fee_bps`).

At trade creation, the buyer supplies `buyer_loss_bps` and
`seller_loss_bps`, which **must sum to exactly 10_000** (100%) - this is
enforced by the contract (`assert!(buyer_loss_bps + seller_loss_bps ==
10_000)`), not left to convention. These describe how a loss, if one
occurs, is split between the two parties; they say nothing about the size
of the loss itself.

At dispute resolution, the mediator supplies a single number,
`seller_gets_bps` (0-10_000): what fraction of the total the seller
deserves, in the mediator's judgment. The contract derives everything else:

```
loss_bps          = 10_000 - seller_gets_bps
buyer_loss_amount  = total * loss_bps * buyer_loss_bps  / (10_000 * 10_000)
seller_loss_amount = total * loss_bps * seller_loss_bps / (10_000 * 10_000)
seller_raw        = total - seller_loss_amount
buyer_refund      = total - seller_raw
fee               = seller_raw * fee_bps / 10_000   # platform fee, seller's portion only
seller_net        = seller_raw - fee
```

Worked example (`total=10_000, seller_gets_bps=7_000 (mediator: seller
deserves 70%), buyer_loss_bps=6_000, seller_loss_bps=4_000, fee_bps=100`):

| Quantity | Value |
|---|---|
| `loss_bps` (30% loss) | `3_000` |
| `buyer_loss_amount` | `1_800` |
| `seller_loss_amount` | `1_200` |
| `seller_raw` | `8_800` |
| `buyer_refund` | `1_200` |
| platform `fee` | `88` |
| `seller_net` -> seller | `8_712` |
| `buyer_refund` -> buyer | `1_200` |
| `fee` -> treasury | `88` |

`8_712 + 1_200 + 88 = 10_000` - the three payouts always sum to the
original total; there is no remainder to account for separately.

Key design choices worth calling out explicitly:

- **The mediator never sees or sets `buyer_loss_bps`/`seller_loss_bps`.**
  Those were fixed by the two parties at trade creation and are immutable
  for that trade. The mediator's only input is "how much did the seller
  earn," which keeps the mediator's job simple and prevents a mediator
  from unilaterally changing the parties' pre-agreed risk split.
- **The platform fee is deducted only from the seller's portion**, never
  from the buyer's refund - a buyer who ends up refunded (in part or
  fully) because the seller under-delivered isn't also charged a platform
  fee on money they're getting back.
- **All arithmetic is `i128`/`u32` integer math with `checked_mul`,
  panicking (reverting the transaction) on overflow** rather than wrapping
  or silently truncating - an overflowed payout calculation must fail the
  transaction, not produce a wrong number.

## Consequences

- **Positive:** A single mediator input (`seller_gets_bps`) is sufficient
  for any dispute outcome from "buyer fully refunded" to "seller fully
  paid," with the parties' own risk-sharing agreement automatically
  applied - the mediator doesn't need to reason about basis-point math per
  case.
- **Positive:** The three-way payout (seller/buyer/treasury) always sums
  exactly to the escrowed total by construction, which makes the
  calculation straightforward to unit-test and fuzz-test exhaustively (see
  `contracts/amana_escrow/src/tests/bps_fuzz_tests.rs`).
- **Negative:** `buyer_loss_bps`/`seller_loss_bps` are fixed at trade
  creation and cannot be renegotiated later, even if circumstances change
  before a dispute arises - amending them requires cancelling and
  recreating the trade.
- **Negative:** The double basis-point multiplication
  (`loss_bps * buyer_loss_bps`, divided by `10_000 * 10_000`) means very
  small trade amounts can round loss shares down to zero for one party
  even when a nonzero split was intended - this is expected integer-math
  behavior, not a bug, but is worth knowing before assuming precision holds
  at very low `total` values.
