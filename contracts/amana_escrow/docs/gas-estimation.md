# Amana Escrow Gas Estimation

This document records the assumptions used by the contract gas and footprint regression tests.

## Scope

The gas suite measures the Amana escrow hot paths that are most likely to affect user-facing transaction cost:

- `create_trade`
- `deposit`
- `initiate_dispute`
- `resolve_dispute`
- the combined dispute lifecycle

## Methodology

The tests use Soroban test utilities and reset the budget immediately before the measured closure. Setup calls such as contract registration, token minting, initialization, and mediator registration are intentionally excluded from hot-path measurements.

Every measured path asserts both CPU instruction cost and memory byte cost against versioned baseline thresholds committed in `src/tests/gas_footprint_tests.rs`.

## Re-baselining policy

Only re-baseline when a deliberate contract change increases cost for a documented reason. When re-baselining:

1. Run `cargo test` from `contracts/amana_escrow/`.
2. Capture measured CPU and memory values locally.
3. Round up to a stable threshold with conservative headroom.
4. Commit threshold changes together with the contract change that caused them.

Do not add network-dependent or timing-dependent checks to the gas suite. CI should remain deterministic and non-flaky.

## Current invariants

Gas estimation must not weaken these contract invariants:

- escrowed funds are conserved across release and dispute-resolution transfers;
- only valid trade lifecycle transitions are accepted;
- only approved mediators may resolve disputes;
- evidence and release sequence storage remain append-only or monotonic where applicable.
