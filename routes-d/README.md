# routes-d

Standalone Stellar route-building service for the Amana platform.

`routes-d` is a small, self-contained Node.js/TypeScript (Express) package that
builds **unsigned Stellar transaction envelopes** (XDR) against the Stellar
network via Horizon, and exposes read-only Horizon data through its routers. It
does **not** sign or submit transactions — a client signs the returned
`envelopeXDR` offline and submits it itself.

It is split out from the main `backend/` so that route-calculation logic can
evolve and be tested independently of the Amana escrow API.

## Purpose

Amana trades move value on the Stellar network. The mobile and web clients need
well-formed, correctly sized Stellar transactions (path payments, trustlines,
etc.) that can be signed locally in a wallet. `routes-d` encapsulates that
"build the envelope" logic and exposes it over HTTP so the rest of the platform
does not need to construct Stellar operations itself.

Because the module only reads from Horizon and produces unsigned envelopes, it
has **no database**, **no persistence**, and **no secrets**.

## Architecture

```
Client (mobile / web / premium)
        │  HTTPS (REST/JSON)
        ▼
┌────────────────────────────┐
│        routes-d            │  Node.js + Express + @stellar/stellar-sdk
│  ┌──────────────────────┐  │
│  │ Routers              │  │
│  │  - stellar.ledger    │  │
│  │  - stellar.payments  │  │
│  │  - stellar.trustline │  │
│  │  - payment.strictSend│  │
│  │  - payment.strictRecv│  │
│  └──────────────────────┘  │
│  Zod request validation    │
└────────────┬───────────────┘
             │  Horizon REST
             ▼
      ┌──────────────┐
      │ Horizon      │
      │ (testnet or  │
      │  mainnet)    │
      └──────────────┘
```

The package exposes factory functions (one per router). Consumers mount the
returned `Router` instances on their own Express app under whatever path prefix
they choose.

## Getting Started

```bash
cd routes-d
npm install
```

Run tests:

```bash
npm test        # vitest run (80% coverage threshold)
```

Type-check / lint (both run `tsc --noEmit`):

```bash
npm run lint
```

Build (emits `dist/`):

```bash
npm run build
```

### Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `STELLAR_NETWORK` | `testnet` | `testnet` or `mainnet`. Selects the Horizon endpoint and the network passphrase used when building a transaction. |

There are no other required environment variables. When `STELLAR_NETWORK` is
`mainnet` the routers use `https://horizon.stellar.org` and the Stellar PUBLIC
network passphrase; otherwise they use `https://horizon-testnet.stellar.org`
and the TESTNET passphrase.

## Usage

Each source file under `routes/` exports a factory that returns an Express
`Router`:

| Factory | Functions |
|---|---|
| `createLedgerRouter()` | `stellar.ledger.ts` |
| `createPaymentHistoryRouter()` | `stellar.payments.ts` |
| `createTrustlineRouter()` | `stellar.trustline.ts` |
| `createStrictSendPaymentRouter()` | `stellar.payment.strictSend.ts` |
| `createStrictReceivePaymentRouter()` | `stellar.payment.strictReceive.ts` |

Example mounting (in a consumer Express app):

```ts
import express from "express";
import { createLedgerRouter } from "routes-d/routes/stellar.ledger";

const app = express();
app.use(express.json());
app.use("/stellar", createLedgerRouter());
```

## API Surface

All request bodies are validated with Zod. A failed validation returns
`400` with `{ "error": "Validation failed", "details": [...issues] }`.

Endpoints that must load an account (trustline, path payments) return `404`
`{ "error": "Source account not found" }` when the account does not exist on
Horizon, and `502` with a `details` message when Horizon itself fails.

### `GET /ledger/latest`

Returns the latest ledger:

```json
{
  "sequence": 1234,
  "hash": "abc...",
  "closedAt": "2026-01-01T00:00:00Z",
  "totalOps": 42,
  "protocolVersion": 22,
  "txCount": 10
}
```

`503` `{ "error": "No ledger data available" }` when no ledger is returned.

### `GET /:address/payments`

Query params: `cursor` (default `"0"`), `limit` (default `20`, max `100`).
Returns payment history for an account (newest first):

```json
{
  "payments": [
    {
      "id": "1",
      "type": "payment",
      "amount": "100.0000000",
      "asset": { "code": "USDC", "issuer": "G..." },
      "from": "G...",
      "to": "G...",
      "memo": null,
      "createdAt": "2026-01-01T00:00:00Z",
      "pagingToken": "123-1"
    }
  ],
  "pagination": { "nextCursor": "…", "hasMore": true, "limit": 20 }
}
```

`400` for an invalid Stellar account address.

### `POST /trustline` — Add / change trustline

Body (`zod`):

```json
{
  "sourceAccount": "G...",
  "asset": { "code": "USDC", "issuer": "G..." },
  "limit": "100.00"
}
```

`limit` is optional (omit to use Stellar's default max). Returns:

```json
{
  "envelopeXDR": "AAAAAA...",
  "networkPassphrase": "Test SDF Network ; September 2015"
}
```

### `DELETE /trustline` — Remove trustline

Body:

```json
{
  "sourceAccount": "G...",
  "asset": { "code": "USDC", "issuer": "G..." }
}
```

Builds a `changeTrust` operation with `limit: "0"` (removing the trustline).

### `POST /strict-send` — Path payment (send amount)

Builds a `pathPaymentStrictSend` operation. Body:

```json
{
  "sourceAccount": "G...",
  "destination": "G...",
  "sourceAmount": "10.00",
  "destinationMin": "9.50",
  "sourceAsset": { "code": "XLM", "issuer": "G..." },
  "destinationAsset": { "code": "USDC", "issuer": "G..." },
  "path": [],
  "memo": "invoice-1"
}
```

`sourceAsset` (defaults to native XLM when omitted), `path`, and `memo` are
optional. Returns `{ envelopeXDR, networkPassphrase }`.

### `POST /strict-receive` — Path payment (receive amount)

Builds a `pathPaymentStrictReceive` operation. Body:

```json
{
  "sourceAccount": "G...",
  "destination": "G...",
  "destinationAmount": "10.00",
  "sourceMax": "10.50",
  "destinationAsset": { "code": "USDC", "issuer": "G..." },
  "sourceAsset": { "code": "XLM", "issuer": "G..." },
  "path": [],
  "memo": "invoice-1"
}
```

`sourceAsset` (defaults to native XLM when omitted), `path`, and `memo` are
optional. Returns `{ envelopeXDR, networkPassphrase }`.

## Testing

Tests live in `tests/` and use Vitest with supertest, stubbing the Stellar SDK
so no network is required. Coverage thresholds (80% across lines, functions,
branches, statements) are enforced by the Vitest config and mirrored in CI.

## Related

- [Architecture](../docs/architecture.md)
- [ADR-009: Route-building service separation](../docs/adr/ADR-009-route-building-service-separation.md)
