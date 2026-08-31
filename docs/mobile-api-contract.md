# Mobile API Contract

This document records the API contract that the Amana **mobile** app
(`mobile/`) depends on from the **backend** (`backend/`). It is the companion
to the consumer-driven contract tests authored in
[`mobile/tests/pact/trades.pact.test.ts`](../mobile/tests/pact/trades.pact.test.ts)
(consumer `AmanaMobile` → provider `AmanaBackend`).

The backend is the source of truth for these contracts. The mobile app's
types and client are expected to satisfy them; the Pact consumer tests pin the
exact request and response shapes the mobile app relies on, and the backend
provider verification (`backend/src/__tests__/trades.pact.verify.test.ts`)
guards both the frontend and mobile consumers.

## How the mobile client talks to the backend

- The base URL is configured via `EXPO_PUBLIC_API_URL`
  (`mobile/src/api/client.ts`), defaulting to `http://localhost:4000`.
- Authentication uses a bearer token. The axios request interceptor attaches
  `Authorization: Bearer <token>` from the auth store when present.
- The mobile trade endpoints live in `mobile/src/api/trade.ts` (`tradeApi`).

## Verified interactions

The following interactions are covered by the mobile Pact consumer tests and
verified against the backend provider.

### `POST /trades` — Create trade

Request (`Content-Type: application/json`, `Authorization: Bearer <token>`):

```json
{
  "sellerAddress": "G...",
  "amountUsdc": "100.00",
  "buyerLossBps": 5000,
  "sellerLossBps": 5000
}
```

Response `201`:

```json
{
  "tradeId": "4294967297",
  "unsignedXdr": "AAAA..."
}
```

### `GET /trades/:id` — Get trade

Response `200`:

```json
{
  "tradeId": "4294967297",
  "buyerAddress": "G...",
  "sellerAddress": "G...",
  "amountCngn": "100.00",
  "buyerLossBps": 5000,
  "sellerLossBps": 5000,
  "status": "CREATED",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

### `GET /trades` — List trades

Query params `page`, `limit`. Response `200`:

```json
{
  "items": [
    {
      "tradeId": "4294967297",
      "buyerAddress": "G...",
      "sellerAddress": "G...",
      "amountCngn": "100.00",
      "buyerLossBps": 5000,
      "sellerLossBps": 5000,
      "status": "CREATED",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
}
```

### `POST /trades/:id/deposit`, `/confirm`, `/release`

Each returns `200`:

```json
{ "unsignedXdr": "AAAA..." }
```

- `/deposit` requires the trade in `CREATED` status.
- `/confirm` requires the trade in `FUNDED` status.
- `/release` requires the trade in `DELIVERED` status.

## Known divergences (mobile client vs. backend)

The Pact tests document the **backend's** actual contract. The following gaps
exist between the current mobile `src/types/trade.ts` / `src/api/trade.ts`
mapping and the verified contract — these are tracked here so they are not
silently reintroduced:

| Area | Mobile client expects | Backend returns |
|---|---|---|
| Trade amount field | `amountUsdc` | `amountCngn` |
| List response | `trades` / `total` / `page` / `limit` | `items` / `pagination` |
| Dispute request | `{ reason }` only | requires `category` (or `categoryId`) |

These divergences mean the mobile app's display layer must map the backend
fields correctly, and any consumer-side fix should keep the Pact tests green.
## Run the mobile pact tests

```bash
cd mobile
pnpm install
pnpm test:pact
```

Generated pact artifacts are written to `mobile/tests/pact/pacts/` (gitignored)
and consumed by the backend provider verification in CI (`contract-tests` job).
