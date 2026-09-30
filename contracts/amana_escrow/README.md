# amana_escrow

This crate contains the Soroban escrow contract used by Amana.

## cNGN migration and upgrade notes

### Migration behavior

- The contract already supports any Stellar token contract address passed to `initialize(admin, cngn_contract, treasury, fee_bps, source_token)`.
- The token contract address is stored under `DataKey::CngnContract`. Soroban keys storage entries by variant name, so this name is part of the on-chain layout and must not be renamed.
- Trades are token-bound at creation time (`Trade.token`), so existing trades keep their original token address and settlement path.
- The contract is single-initialize; it does not support in-place token switching after initialization.

### Storage compatibility contract

For production upgrades, these compatibility expectations must remain stable:

- `DataKey` variants and serialized layout remain unchanged, especially:
  - `CngnContract`
  - `Trade(u64)`
  - `Mediator` and `MediatorRegistry(Address)`
  - `DisputeData(u64)`, `EvidenceList(u64)`, `VideoProof(u64)`, `Manifest(u64)`
- `initialize` remains one-time and rejects reinitialization.
- Legacy mediator compatibility is preserved:
  - `set_mediator()` legacy slot continues to interoperate with `add_mediator()` registry entries.
  - `remove_mediator()` continues clearing both legacy and registry paths when applicable.
- Legacy evidence accessor compatibility is preserved:
  - `get_evidence_list()` is the primary API.
  - `get_evidence()` remains available for legacy clients.

### Safe rollout guidance for cNGN production

1. Validate in staging using the same contract build and cNGN contract ID intended for production.
2. Run full contract test suite and verify lifecycle invariants before deployment.
3. Deploy upgraded WASM without renaming storage keys or changing `DataKey` ordering/serialization.
4. Initialize new production deployment with cNGN token contract.
5. Monitor event processing and settlement balances across:
   - new cNGN trades,
   - pre-existing trades bound to their original token.
6. Do not assume rollback can mutate already-initialized on-chain token configuration.

## Migration test checklist

Existing tests in `src/lib.rs` and `tests/dispute_flow.rs` cover migration-sensitive behavior:

- lifecycle continuity, invalid transitions, and conservation checks
- legacy + registry mediator interoperability and revocation semantics
- evidence/video/manifest compatibility and persistence guarantees
- long-ledger-gap continuity (`test_trade_id_counter_survives_long_ledger_gap`)

Before production rollout, execute:

```bash
cargo test
```

## Local deployment

`contracts/deploy-local.sh` builds the `amana_escrow` wasm artifact and
deploys (or upgrades) it against a local Soroban network for manual testing.

```bash
./contracts/deploy-local.sh \
  --network standalone \
  --admin <ADMIN_PUBKEY> \
  --token-contract <TOKEN_CONTRACT_ID> \
  --treasury <TREASURY_PUBKEY> \
  --fee-bps 100
```

Pass `--upgrade` to upgrade an already-deployed local contract instead of
deploying a new one, or `--help` for the full option list. The script is a
thin wrapper around `scripts/deploy-contract-local.sh`.

## Deployment safety checks

Contract CI runs `scripts/check-contract-deployment-safety.sh` before the test
suite for contract changes. The script is intentionally static and
deterministic: it verifies deployment-critical files exist, the crate keeps the
explicit `wasm` feature and native `rlib` test configuration, initialization
remains guarded by admin auth and the one-time initialized flag, and no obvious
secret or live key material is committed under `contracts/`.

Run the same check locally from the repository root:

```bash
bash scripts/check-contract-deployment-safety.sh
```
