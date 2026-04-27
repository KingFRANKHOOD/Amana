# Smart Contract Implementation Issues

Date: 2026-04-27
Context: Analysis of `contracts/amana_escrow/src/lib.rs` against `README.md` project description. Identified gaps between documented features and actual implementation.

---

## SC-001 - Video Proof Must Be Mandatory Before Delivery Confirmation

Description:
README states PoD is "mandatory video-based verification protocol" but `confirm_delivery()` can be called without requiring video proof first. The `submit_video_proof()` exists but is optional - buyer can confirm delivery without providing proof of delivery video, defeating the core escrow safety mechanism.

Requirements and Context:
- This is a smart contract implementation issue (Priority: P0).
- Scope includes: making video proof a prerequisite for `confirm_delivery()`.
- Contract location: `contracts/amana_escrow/src/lib.rs`
- Affected functions:
  - `confirm_delivery()` (line 484-497)
  - `submit_video_proof()` (line 802-839)
  - Trade struct needs field to track video proof status.

Acceptance Criteria:
- [ ] `confirm_delivery()` rejects calls when no video proof exists for trade.
- [ ] Trade struct tracks whether video proof has been submitted.
- [ ] Test coverage for happy path and rejection path.

Deliverables:
- [ ] Implementation making video proof mandatory before delivery confirmation.
- [ ] Tests verifying the requirement.
- [ ] Test snapshots demonstrating behavior.

NOTE:
This issue will not be reviewed or approved without tests proving video proof is required before `confirm_delivery()` succeeds.

---

## SC-002 - Implement Delivery Timelock/Deadline Mechanism

Description:
No mechanism for delivery deadlines exists. Trades can remain in `Funded` status indefinitely with funds locked. If buyer never confirms delivery or initiates dispute, funds remain locked forever with no timeout mechanism.

Requirements and Context:
- This is a smart contract implementation issue (Priority: P0).
- Scope includes: adding deadline field to Trade and enforcing timeout.
- Contract location: `contracts/amana_escrow/src/lib.rs`
- Affected functions:
  - `create_trade()` (line 375-405)
  - `Trade` struct (line 154-167)

Acceptance Criteria:
- [ ] Trade struct includes optional delivery_deadline field.
- [ ] `create_trade()` accepts optional deadline parameter.
- [ ] After deadline passes, either party can initiate refund.
- [ ] Test coverage for deadline expiry flow.

Deliverables:
- [ ] Implementation of delivery deadline.
- [ ] Tests for deadline enforcement.
- [ ] Test snapshots showing timeout behavior.

NOTE:
This issue will not be reviewed or approved without tests showing funds can be recovered after deadline passes.

---

## SC-003 - No Price Oracle / Volatility Protection Integration

Description:
README mentions "pay in local currency (NGN) while locking value in USDC" using Stellar Path Payments. No oracle or price conversion logic exists in the contract. Users cannot pay in local currency - only USDC is accepted.

Requirements and Context:
- This is a smart contract implementation issue (Priority: P1).
- Scope includes: either integrating price oracle or documenting limitation.
- Contract location: `contracts/amana_escrow/src/lib.rs`
- Affected functions:
  - `initialize()` (line 265-278)
  - `create_trade()` (line 375-405)

Acceptance Criteria:
- [ ] Document how local currency handling should work (on-chain vs off-chain).
- [ ] If on-chain, implement price oracle integration.
- [ ] Off-chain documentation in README explaining current limitation.

Deliverables:
- [ ] Technical design for price handling.
- [ ] Implementation or documented limitation.
- [ ] UPDATE to README explaining current scope.

NOTE:
This issue will not be reviewed or approved without clear technical decision on price handling architecture.

---

## SC-004 - Rounding Errors May Leave Funds Stranded in Escrow

Description:
Loss distribution uses integer division which may truncate and leave stranded funds in escrow. Small amounts lost due to integer truncation: `total=1, loss_bps=1, seller_loss_bps=1` → `1 * 1 * 1 / 100_000_000 = 0`.

Requirements and Context:
- This is a smart contract bug fix (Priority: P1).
- Scope includes: adding rounding protection to loss calculations.
- Contract location: `contracts/amana_escrow/src/lib.rs`
- Affected functions:
  - `resolve_dispute()` (line 625-693)

Acceptance Criteria:
- [ ] All loss calculations handle small amounts correctly.
- [ ] No funds left stranded (dust) in escrow after resolution.
- [ ] Conservation of funds invariant holds for all test cases.

Deliverables:
- [ ] Fixed calculation logic.
- [ ] Tests for edge case amounts (1, 10, 100).
- [ ] Test snapshots demonstrating conservation.

NOTE:
This issue will not be reviewed or approved without tests proving funds conservation for amounts 1, 10, 100.

---

## SC-005 - Missing buyer_loss_amount Verification in Dispute Resolution

Description:
Code comments (line 601-602) reference `buyer_loss_amount` calculation but only `seller_loss_amount` is computed. No verification that `seller_loss + buyer_loss = total * loss_bps`. This creates potential for funds to go unaccounted.

Requirements and Context:
- This is a smart contract bug fix (Priority: P1).
- Scope includes: adding verification check in resolve_dispute.
- Contract location: `contracts/amana_escrow/src/lib.rs`
- Affected functions:
  - `resolve_dispute()` (line 625-693)

Acceptance Criteria:
- [ ] Compute both buyer_loss_amount and seller_loss_amount.
- [ ] Verify loss sums correctly: `seller_loss + buyer_loss = expected_total_loss`.
- [ ] Panic or handle accounting mismatch.

Deliverables:
- [ ] Added verification logic.
- [ ] Tests for loss accounting.
- [ ] Test snapshots for verification behavior.

NOTE:
This issue will not be reviewed or approved without tests proving loss amounts are accounted for correctly.

---

## SC-006 - Evidence Can Be Submitted After Dispute Resolution

Description:
`submit_evidence()` only checks for `Disputed` status. Evidence can be submitted even after `resolve_dispute()` completes since trade remains in Disputed status during resolution. Need to prevent evidence submissions after resolution.

Requirements and Context:
- This is a smart contract logic fix (Priority: P1).
- Scope includes: adding post-resolution check.
- Contract location: `contracts/amana_escrow/src/lib.rs`
- Affected functions:
  - `submit_evidence()` (line 706-772)
  - `resolve_dispute()` (line 625-693)

Acceptance Criteria:
- [ ] Evidence cannot be submitted after resolution completes.
- [ ] Clear error message for post-resolution attempts.
- [ ] Test coverage for rejection path.

Deliverables:
- [ ] Fixed evidence submission logic.
- [ ] Tests for post-resolution rejection.
- [ ] Test snapshots showing error behavior.

NOTE:
This issue will not be reviewed or approved without tests proving evidence is rejected after resolution.

---

## SC-007 - fee_bps Validation Should Require Minimum Fee

Description:
`initialize()` rejects fees > 10_000 but allows 0. Zero fee means no platform revenue. Consider requiring minimum non-zero fee (e.g., 1 bps = 0.01%).

Requirements and Context:
- This is a smart contract configuration fix (Priority: P2).
- Scope includes: adding minimum fee validation.
- Contract location: `contracts/amana_escrow/src/lib.rs`
- Affected functions:
  - `initialize()` (line 265-278)

Acceptance Criteria:
- [ ] Initialize rejects fee_bps = 0.
- [ ] Initialize accepts valid fee > 0.
- [ ] Test coverage for boundary cases.

Deliverables:
- [ ] Updated fee validation.
- [ ] Tests for minimum fee.
- [ ] Test snapshots for rejection.

NOTE:
This issue will not be reviewed or approved without tests proving zero fee is rejected.

---

## SC-008 - CancelRequest State Leak on Admin Cancellation

Description:
When admin cancels a funded trade with `cancel_trade()`, the `CancelRequest` storage key is not cleaned up. This leaves stale state in storage.

Requirements and Context:
- This is a smart contract state leak fix (Priority: P2).
- Scope includes: cleanup of CancelRequest on admin cancel.
- Contract location: `contracts/amana_escrow/src/lib.rs`
- Affected functions:
  - `execute_cancellation()` (line 464-482)

Acceptance Criteria:
- [ ] CancelRequest removed on admin cancellation.
- [ ] Storage cleaned properly.
- [ ] Test coverage for cleanup verification.

Deliverables:
- [ ] Fixed cleanup logic.
- [ ] Tests checking storage state.
- [ ] Test snapshots for storage after cancel.

NOTE:
This issue will not be reviewed or approved without tests proving storage is properly cleaned.

---

## SC-009 - No Emergency Admin Withdrawal for Stuck Funds

Description:
No admin emergency withdrawal exists if funds get stuck (e.g., token contract breaks). If USDC token contract has issues, funds could be locked forever with no recovery path.

Requirements and Context:
- This is a smart contract feature (Priority: P2).
- Scope includes: emergency withdrawal function.
- Contract location: `contracts/amana_escrow/src/lib.rs`
- Affected functions: new function needed.

Acceptance Criteria:
- [ ] Admin can withdraw stuck funds after timeout.
- [ ] Emergency withdrawal requires extended timeout (e.g., 30 days).
- [ ] Emits event for audit trail.
- [ ] Test coverage.

Deliverables:
- [ ] Emergency withdrawal implementation.
- [ ] Tests for emergency scenario.
- [ ] Test snapshots for withdrawal flow.

NOTE:
This issue will not be reviewed or approved without tests for emergency fund recovery.

---

## SC-010 - Trade ID Collision Risk Under High Volume

Description:
Trade ID combines ledger sequence + counter: `trade_id = (ledger_seq << 32) | next_id`. Counter resets per session but ledger sequence advances. After ~4 billion trades, ID collision possible. Unlikely but worth noting.

Requirements and Context:
- This is a smart contract improvement (Priority: P3).
- Scope includes: making Trade ID more robust.
- Contract location: `contracts/amana_escrow/src/lib.rs`
- Affected functions:
  - `create_trade()` (line 375-405)

Acceptance Criteria:
- [ ] Document collision scenario.
- [ ] Consider adding randomness or unique source.
- [ ] Migration plan if needed.

Deliverables:
- [ ] Updated ID generation.
- [ ] Documentation of limitations.
- [ ] Test for edge case.

NOTE:
This issue will not be reviewed or approved without documentation of trade ID collision handling.

---

## SC-011 - Video Proof and Manifest Should Block Each Other

Description:
Video proof (`submit_video_proof`) and delivery manifest (`submit_manifest`) are independent. They should be coordinated - both required before `confirm_delivery`, or at least one required.

Requirements and Context:
- This is a smart contract logic fix (Priority: P2).
- Scope includes: coordination between proof types.
- Contract location: `contracts/amana_escrow/src/lib.rs`
- Affected functions:
  - `submit_video_proof()` (line 802-839)
  - `submit_manifest()` (line 843-874)
  - `confirm_delivery()` (line 484-497)

Acceptance Criteria:
- [ ] Require video OR manifest (or both) before delivery.
- [ ] Clear error if neither provided.
- [ ] Test coverage.

Deliverables:
- [ ] Updated delivery confirmation logic.
- [ ] Tests for proof requirements.
- [ ] Test snapshots for each scenario.

NOTE:
This issue will not be reviewed or approved without tests proving proof requirements are enforced.

---

## SC-012 - Missing Event Indexing for Client Queries

Description:
Events use short symbols but no event ID/counter for easy client-side filtering. Clients cannot efficiently query for "all events after event X".

Requirements and Context:
- This is a smart contract improvement (Priority: P3).
- Scope includes: adding event counters.
- Contract location: `contracts/amana_escrow/src/lib.rs`
- Affected functions: all emit calls.

Acceptance Criteria:
- [ ] Each event includes sequence number.
- [ ] Client can filter by event sequence.
- [ ] Test coverage.

Deliverables:
- [ ] Event sequence implementation.
- [ ] Tests for filtering.
- [ ] Test snapshots.

NOTE:
This issue will not be reviewed or approved without tests for event sequence filtering.

---

## Prioritization Summary

| Priority | Issue Code | Issue Title |
|----------|----------|------------|
| P0 | SC-001 | Video Proof Must Be Mandatory Before Delivery |
| P0 | SC-002 | Implement Delivery Timelock/Deadline |
| P1 | SC-003 | Price Oracle / Volatility Protection |
| P1 | SC-004 | Rounding Errors May Leave Funds Stranded |
| P1 | SC-005 | Missing buyer_loss_amount Verification |
| P1 | SC-006 | Evidence Can Be Submitted After Resolution |
| P2 | SC-007 | fee_bps Validation Should Require Minimum |
| P2 | SC-008 | CancelRequest State Leak |
| P2 | SC-009 | Emergency Admin Withdrawal |
| P2 | SC-011 | Video Proof and Manifest Coordination |
| P3 | SC-010 | Trade ID Collision Risk |
| P3 | SC-012 | Missing Event Indexing |

Date: 2026-04-27