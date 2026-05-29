# Amana Escrow & Dispute System — Threat Model

**Branch:** `feature/security-48-threat-model-abuse-cases`  
**Scope:** `contracts/amana_escrow`, `backend/`, `docs/`  
**Last Updated:** 2026-04-24

---

## 1. System Overview

Amana is a blockchain-backed agricultural escrow platform running on Stellar/Soroban. The core escrow contract (`amana_escrow`) mediates funds between a **buyer** and a **seller**, with a trusted **mediator** pool and an **admin** for governance.

### Trust Boundaries

```
[Buyer Wallet] ──────────────────────────────────────────────────────┐
[Seller Wallet] ──────────────────── EscrowContract (Soroban) ───────┤─→ [cNGN Token Contract]
[Mediator Wallet] ───────────────────────────────────────────────────┘
        │                                    │
[Backend API (JWT)] ──────────────────→ [PostgreSQL / Redis]
        │
[Frontend (Next.js)] ──→ [Freighter Wallet Signer]
```

### Trade Lifecycle State Machine

```
Created → Funded → Delivered → Completed
                ↓
            Disputed → (Resolved by Mediator) → Completed
                ↑
        [cancel_trade (both parties or admin)]
             ↓
          Cancelled
```

---

## 2. Assets & Stakeholders

| Asset | Description |
|---|---|
| **Escrowed cNGN** | Buyer's funds locked in the contract during a live trade |
| **Admin Key** | Controls fee rate, treasury address, mediator registry |
| **Mediator Registry** | List of approved addresses that can resolve disputes |
| **Audit Trail** | On-chain events + signed Ed25519 audit exports |
| **IPFS Evidence** | Video proofs, delivery manifests, dispute briefs |
| **JWT Tokens** | Backend session tokens issued after Stellar signature |

---

## 3. Threat Matrix

### 3.1 Economic Attacks

---

#### TH-E-01 — Griefing via Dispute Spam

| Field | Detail |
|---|---|
| **Target** | Buyer / Seller |
| **Vector** | Either party calls `initiate_dispute()` on every trade they create, intentionally locking funds to delay settlement |
| **Impact** | Funds frozen; seller revenue delayed; mediator queue overwhelmed |
| **Likelihood** | High — no cost to initiate |

**Current Controls:**
- Dispute can only be initiated on `Funded` trades.
- Only buyer or seller of the specific trade may initiate.

**Recommended Mitigations:**
- Introduce a **dispute bond** (e.g., a small cNGN stake slashed if dispute is ruled frivolous).
- Rate-limit disputes per address at the backend API layer.
- Track dispute-initiation frequency in the mediator dashboard.

---

#### TH-E-02 — Loss-Ratio Front-Running

| Field | Detail |
|---|---|
| **Target** | Seller |
| **Vector** | Buyer creates a trade with `buyer_loss_bps=0, seller_loss_bps=10000`. If any dispute arises, the seller bears 100% of any loss regardless of outcome. |
| **Impact** | Seller receives zero funds even when they delivered. |
| **Likelihood** | Medium — seller must agree off-chain first |

**Current Controls:**
- Loss ratios are set at `create_trade()` and immutable thereafter.
- Both `buyer_loss_bps + seller_loss_bps` must equal 10,000 (enforced by assertion).

**Recommended Mitigations:**
- Add a **seller-acceptance step**: require the seller to sign `create_trade` parameters before the trade is `Funded`.
- Enforce a **minimum seller protection floor** (e.g., `seller_loss_bps` ≤ 5,000) unless both parties explicitly agree otherwise.

---

#### TH-E-03 — Fee Drain via Treasury Replacement

| Field | Detail |
|---|---|
| **Target** | Platform treasury |
| **Vector** | If the admin key is compromised, the attacker calls `update_fee_bps` (or re-initializes) to redirect fees to an attacker-controlled address. |
| **Impact** | All future platform fees drained. |
| **Likelihood** | Low — requires admin compromise |

**Current Controls:**
- Admin is set once at `initialize()` and stored in instance storage.
- `fee_bps` is validated to be `<= 10_000`.

**Recommended Mitigations:**
- Use a **multisig or DAO contract** as the admin address.
- Add a **time-lock** on admin parameter changes (treasury address, fee rate).

---

#### TH-E-04 — Zero-Amount Trade Pollution

| Field | Detail |
|---|---|
| **Target** | Contract state / indexers |
| **Vector** | Although `amount > 0` is enforced, an attacker could spam the network with minimum-value trades (e.g., `amount = 1`) to flood trade IDs and storage. |
| **Impact** | Storage cost increase; indexer / UI pollution. |
| **Likelihood** | Low on Stellar (transaction fees), but non-zero. |

**Recommended Mitigations:**
- Set a **minimum trade amount** threshold (e.g., 100 cNGN) enforced in `create_trade()`.
- Enforce minimum amounts at the backend API validation layer too (Zod schema).

---

### 3.2 Replay Attacks

---

#### TH-R-01 — XDR Transaction Replay

| Field | Detail |
|---|---|
| **Target** | Buyer |
| **Vector** | The backend issues unsigned XDR for `deposit`, `confirm_delivery`, `release_funds`. If an attacker intercepts and rebroadcasts a previously signed XDR, they could trigger double-execution. |
| **Impact** | Double fund release; duplicate state transitions. |
| **Likelihood** | Low — Stellar sequence numbers prevent direct replay. |

**Current Controls:**
- Stellar's native **account sequence number** prevents exact XDR replay.
- Trade status state machine prevents re-entry (e.g., `Funded` → `Funded` panics).

**Recommended Mitigations:**
- The existing idempotency key support on backend mutation endpoints is the correct defense layer — ensure it is enforced in production Redis.
- Document that each XDR must be signed and submitted within a **time bounds window** (Stellar `timeBounds`).

---

#### TH-R-02 — JWT Replay After Wallet Key Rotation

| Field | Detail |
|---|---|
| **Target** | Authenticated user session |
| **Vector** | A user rotates their Stellar signing key. Old JWTs, valid for their TTL, continue to authorize backend actions against the new key holder's account. |
| **Impact** | Unauthorized backend API access post key rotation. |
| **Likelihood** | Medium |

**Current Controls:**
- JWTs issued via the `/auth/verify` endpoint after challenge-response signature.

**Recommended Mitigations:**
- Bind JWT claims to the wallet `public_key` and validate it against the current network state on sensitive operations.
- Implement a **token revocation list** in Redis for explicit logout.
- Use a short JWT TTL (e.g., 1 hour) with refresh token rotation.

---

#### TH-R-03 — Audit Export Signature Replay

| Field | Detail |
|---|---|
| **Target** | Audit verification endpoint |
| **Vector** | A valid signed audit export for trade A is replayed against the `GET /trades/:id/history/verify` endpoint for trade B. |
| **Impact** | False attestation of trade B's history. |
| **Likelihood** | Low |

**Current Controls:**
- Ed25519 signature covers the `payloadHash` of the export body.

**Recommended Mitigations:**
- Include the `trade_id` in the signed payload so signatures are trade-scoped and cannot be cross-applied.

---

### 3.3 Privilege Abuse

---

#### TH-P-01 — Compromised Mediator — Biased Resolution

| Field | Detail |
|---|---|
| **Target** | Buyer or Seller |
| **Vector** | A registered mediator calls `resolve_dispute()` with `seller_gets_bps = 10_000` or `0`, awarding all funds to one party without genuine review. |
| **Impact** | One party loses their entire escrow. |
| **Likelihood** | Medium — mediators are externally trusted |

**Current Controls:**
- Mediator must be registered by admin via `add_mediator()`.
- `seller_gets_bps` is bounded to `[0, 10_000]`.
- On-chain `DisputeResolvedEvent` is emitted and auditable.

**Recommended Mitigations:**
- Implement a **mediator dispute-outcome log** tracked off-chain by the admin.
- Require **two-of-N mediator consensus** for high-value trades (e.g., `amount > threshold`).
- Add a **resolution appeal window** during which the admin can override a resolution.
- Rotate mediators regularly and track win-rate statistics to detect bias.

---

#### TH-P-02 — Admin Privilege Escalation

| Field | Detail |
|---|---|
| **Target** | All users |
| **Vector** | The admin calls `set_mediator()` to appoint themselves as mediator, then calls `initiate_dispute()` on any live trade, and `resolve_dispute()` to drain funds to any address. |
| **Impact** | Total loss of escrowed funds across all active trades. |
| **Likelihood** | Low — requires admin key compromise or insider threat |

**Current Controls:**
- `initiate_dispute` is restricted to buyer/seller of a specific trade only.
- Admin cannot initiate disputes on trades where they are not a party.

**Recommended Mitigations:**
- Prevent admin from being registered as a mediator.
- Use a **separate admin key** for governance vs. day-to-day mediation operations.
- Implement a multisig admin.

---

#### TH-P-03 — Seller Self-Cancellation After Buyer Funds

| Field | Detail |
|---|---|
| **Target** | Buyer |
| **Vector** | After buyer deposits funds (`Funded` status), seller submits a cancel request and waits for the buyer to counter-sign. Seller could use social engineering to trick buyer into cancelling a legitimate trade. |
| **Impact** | Buyer gets refunded but deal collapses; seller may re-trade at higher price (griefing). |
| **Likelihood** | Medium |

**Current Controls:**
- `cancel_trade` on `Funded` requires both `buyer` AND `seller` to submit cancel requests.
- Admin can force-cancel a funded trade unilaterally (emergency escape).

**Recommended Mitigations:**
- Log all cancel requests in the backend audit trail.
- Add a **cooling-off period** (minimum ledgers) before a mutual cancel becomes effective.

---

#### TH-P-04 — Video Proof Squatting

| Field | Detail |
|---|---|
| **Target** | Seller / Evidence integrity |
| **Vector** | The buyer (or another party with trade access) calls `submit_video_proof()` first, anchoring a false or irrelevant IPFS CID before the seller can submit legitimate delivery proof. |
| **Impact** | Mediator sees incorrect evidence; dispute resolution skewed. |
| **Likelihood** | Medium |

**Current Controls:**
- `VideoProofRecord` is immutable once set (one per trade).

**Recommended Mitigations:**
- Restrict `submit_video_proof()` to only the **seller** of the trade.
- Allow the seller to overwrite their own proof within a short time window.

---

### 3.4 Data Integrity & Off-Chain Attacks

---

#### TH-D-01 — IPFS Evidence Substitution

| Field | Detail |
|---|---|
| **Target** | Mediator / Dispute resolution |
| **Vector** | A party submits a valid IPFS CID to the contract, then unpins the original content and repins different content at the same CID (CID collision or gateway caching). |
| **Impact** | Mediator reviews different content than what was anchored. |
| **Likelihood** | Very Low — SHA-256 CID collision is computationally infeasible |

**Current Controls:**
- IPFS CIDs are content-addressed (SHA-256); content cannot change without changing the CID.

**Recommended Mitigations:**
- Pin all evidence CIDs to a **dedicated IPFS pinning service** (e.g., Pinata, Filecoin) as soon as they are submitted on-chain.
- Verify CID content is retrievable before accepting evidence in the backend.

---

#### TH-D-02 — Delivery Manifest Hash Preimage Attack

| Field | Detail |
|---|---|
| **Target** | Manifest integrity |
| **Vector** | Seller submits `driver_name_hash` and `driver_id_hash` that are hashes of fraudulent values, obscuring real delivery details from the mediator. |
| **Impact** | Mediator cannot verify the actual driver identity off-chain. |
| **Likelihood** | Medium |

**Current Controls:**
- Manifest fields are stored as hashes only (privacy-preserving design).

**Recommended Mitigations:**
- During dispute, require the seller to **reveal the preimage** off-chain (or to the mediator), and the mediator should verify the hash matches on-chain before resolving.
- Document this off-chain verification step in the mediator handbook.

---

## 4. Security Controls Summary

| Control | Location | Status |
|---|---|---|
| Auth required on all state mutations | `lib.rs` – `require_auth()` | ✅ Implemented |
| State machine guards (status checks) | `lib.rs` – `assert!(matches!(...))` | ✅ Implemented |
| Fee bounded at 100% (10,000 bps) | `initialize()` | ✅ Implemented |
| Loss ratio must sum to 100% | `create_trade()` | ✅ Implemented |
| Mediator registry with add/remove | `add_mediator`, `remove_mediator` | ✅ Implemented |
| Idempotency keys on mutations | Backend middleware | ✅ Implemented |
| Signed audit export (Ed25519) | Backend `/history/verify` | ✅ Implemented |
| Optimistic concurrency on status | Backend event processor | ✅ Implemented |
| Schema validation (Zod) | Backend middleware | ✅ Implemented |
| Structured error taxonomy | Backend error handler | ✅ Implemented |
| Dispute bond / stake | Contract | ❌ Not implemented |
| Seller acceptance of trade terms | Contract | ❌ Not implemented |
| Minimum trade amount floor | Contract + Backend | ❌ Not implemented |
| JWT revocation list | Backend / Redis | ❌ Not implemented |
| Multisig admin | Governance | ❌ Not implemented |
| Appeal window post-resolution | Contract | ❌ Not implemented |
| Evidence IPFS pinning service | Infrastructure | ❌ Not implemented |
| Mediator outcome audit log | Backend / Admin dashboard | ❌ Not implemented |

---

## 5. Recommendations Priority

| Priority | Finding | Effort |
|---|---|---|
| **P0 – Critical** | TH-P-02 Admin key is single point of failure → use multisig | High |
| **P0 – Critical** | TH-R-01/R-02 Ensure JWT TTL + Redis revocation in production | Low |
| **P1 – High** | TH-E-02 Seller must accept trade terms before funding | Medium |
| **P1 – High** | TH-P-01 Mediator consensus for high-value trade resolution | Medium |
| **P1 – High** | TH-P-04 Restrict video proof submission to seller only | Low |
| **P2 – Medium** | TH-E-01 Dispute bond to disincentivize griefing | Medium |
| **P2 – Medium** | TH-D-01 IPFS pinning service integration | Medium |
| **P3 – Low** | TH-E-04 Minimum trade amount enforcement | Low |
| **P3 – Low** | TH-R-03 Bind audit signatures to trade_id scope | Low |

---

## 6. Scope & Exclusions

- **In scope:** `contracts/amana_escrow`, backend API (`/trades`, `/auth`, `/evidence`), IPFS evidence layer.
- **Out of scope:** Stellar network-level attacks (validator collusion, ledger reorgs), Freighter wallet security, third-party IPFS gateway security.
- **Not modelled:** Social engineering of end-users outside the system.

---

## 7. References

- [Soroban Security Best Practices](https://developers.stellar.org/docs/smart-contracts)
- [Amana Backend Reliability Layer](./backend.md)
- [Amana Escrow Contract README](../contracts/amana_escrow/README.md)
- OWASP Smart Contract Top 10
