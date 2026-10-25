# ADR-009: Route-building Service Separation (`routes-d`)

## Status

Accepted

Implementation lives in [`routes-d/`](../../routes-d/); see the
[README](../../routes-d/README.md) and the
[architecture guide](../architecture.md#route-building-layer-routes-d).

## Context

Amana moves value on the Stellar network. Both the web and mobile clients need
well-formed Stellar transaction envelopes (path payments, trustlines, payment
history, latest ledger) that can be signed locally in a wallet. Constructing
these reliably requires knowledge of the Stellar SDK, Horizon, the active
network, and transaction/operation semantics.

Historically this logic was considered part of the main escrow API. That
coupling had several costs:

- The main `backend/` is responsible for the trade/dispute/evidence domain and
  its data model; routing logic had no natural home there and grew alongside
  unrelated responsibilities.
- Routing logic needed its own tests against the Stellar SDK without spinning
  up the full backend (database, Prisma, auth).
- The build/test loop for route changes was heavier than necessary, and
  independent versioning / reviews were hard.
- New contributors had no single, discoverable place to learn how Stellar
  routing works in Amana.

## Decision

1. **Standalone service.** Create a self-contained Node.js/TypeScript + Express
   package (`routes-d/`) that only builds **unsigned** Stellar transaction
   envelopes and exposes read-only Horizon data. It has no database, no
   persistence, and no secrets.
2. **Stateless, network-configurable.** The only configuration is
   `STELLAR_NETWORK` (`testnet` default / `mainnet`), which selects the Horizon
   endpoint and network passphrase at runtime.
3. **Composable routers.** Each capability is a factory that returns an Express
   `Router` (`stellar.ledger`, `stellar.payments`, `stellar.trustline`,
   `stellar.payment.strictSend`, `stellar.payment.strictReceive`), so consumers
   mount the routers they need under their own path prefixes.
4. **Signing stays client-side.** `routes-d` returns `envelopeXDR` plus the
   network passphrase; it never holds keys and never signs or submits
   transactions. The client signs offline and submits to Stellar.
5. **Independent testing and CI.** Tests use Vitest + supertest and stub the
   Stellar SDK (no network required), with an 80% coverage threshold enforced
   locally and in CI. A dedicated CI job runs on `routes-d/**` changes.
6. **Documentation as a first-class deliverable.** Purpose, architecture, API
   surface, and configuration are documented in `routes-d/README.md`, wired
   into `docs/architecture.md` and the contributor onboarding guide, and this
   ADR records the separation rationale.

## Consequences

- **Positive:** Clear ownership of routing logic; independent, fast tests;
  no need for a database or secrets to build or test routing; a discoverable
  home for Stellar operation construction; lower barrier for new
  contributors.
- **Negative:** An additional package and runtime to operate and monitor; a
  network call path (client → routes-d → Horizon) that must be resilient;
  shared Stellar SDK versioning across packages must be kept in mind.
- **Follow-up:** Deduplicate any overlap with backend Stellar code once the
  backend's byte-identification and signing flows are consolidated; keep the
  Pact/consumer contract for routes-d aligned as new operations are added.
