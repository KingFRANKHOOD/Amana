# amana_escrow — Security assumptions & upgrade path

This document records the trust model the escrow contract relies on and the
supported path for upgrading storage. It complements the migration notes in
[README.md](./README.md).

## Trust model

- **Authorization.** Every state-changing entry point requires the acting
  party's `require_auth()` (buyer, seller, submitter, initiator, caller). The
  contract never moves funds or mutates a trade on behalf of an unauthenticated
  caller.
- **Admin.** Set once at `initialize()` and trusted to configure the fee and
  mediator set. `initialize()` is single-shot and rejects reinitialization.
- **Mediator.** Trusted to resolve disputes. Both the legacy single-slot
  mediator and the mediator registry are honoured; revocation clears both paths.
- **Treasury.** Receives protocol fees; fee math uses checked arithmetic so an
  overflow aborts rather than wrapping.

## Input assumptions

Caller-supplied data is treated as untrusted and bounded at the entry point:

- Hash / CID / description strings are capped at `MAX_HASH_LEN` (256 bytes).
  Real IPFS CIDs (~62 bytes) and hex digests (64 bytes) fit comfortably; the cap
  rejects oversized payloads that would bloat persistent storage and inflate gas
  for every later read/write.
- Required pointers (`reason_hash`, `ipfs_hash`, `ipfs_cid`, `driver_id_hash`)
  must be non-empty.
- Dispute loss ratios are each bounded to `<= 10_000` bps before summing, so a
  malformed value is rejected with a clear message instead of a `u32` overflow
  panic, and the two shares must sum to exactly `10_000` (100%).

## Storage upgrade path

The persistent layout is versioned to keep future upgrades forward-compatible:

- `CURRENT_SCHEMA_VERSION` (currently `1`) is written under
  `DataKey::SchemaVersion` at `initialize()` and read via `get_schema_version()`.
- Instances deployed before schema versioning existed have no stored marker and
  report version `1` (the original layout), so an upgrade can branch on
  `get_schema_version()` to decide whether a migration is required.
- `DataKey::SchemaVersion` is appended as the last enum variant; because Soroban
  keys variants by name, adding it does not change the XDR encoding of any
  pre-existing variant.

When changing the persistent layout: bump `CURRENT_SCHEMA_VERSION`, branch on the
stored value to migrate older instances, and preserve the storage-compatibility
contract documented in [README.md](./README.md) (do not rename or reorder
existing `DataKey` variants).
