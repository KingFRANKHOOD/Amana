# Trade Endpoints

All trade endpoints require `Authorization: Bearer <token>` (see
[overview.md](./overview.md#authentication)) unless stated otherwise.
Responses generally follow the [error envelope](./errors.md) on failure.

## Trade lifecycle

A trade moves through these statuses:

```
CREATED -> FUNDED -> DELIVERED -> COMPLETED
                  \-> DISPUTED -/
   \------------------------------> CANCELLED
```

Each transition below is built server-side as an **unsigned Stellar
transaction (XDR)** that the caller must sign client-side and submit to the
network - the backend never holds a user's signing key. `PENDING_SIGNATURE`
is the transient state between building and submitting a transaction.

## Create a trade

`POST /trades`

Builds the create-trade contract call. The buyer is derived from the bearer
token, not the request body - you cannot create a trade on someone else's
behalf.

Supports `Idempotency-Key` (see [overview.md](./overview.md#idempotency)).

**Request body**

```json
{
  "sellerAddress": "GBBB...C4",
  "amountUsdc": "125.1234567",
  "buyerLossBps": 5000,
  "sellerLossBps": 5000
}
```

`buyerLossBps` / `sellerLossBps` are basis points (0-10000) describing how a
dispute loss would be split between the two parties.

**Response `201`**

```json
{ "tradeId": "4294967297", "unsignedXdr": "AAAAAgAAAAC..." }
```

| Status | Meaning |
|---|---|
| `400` | Validation failed, see `VALIDATION_ERROR` in [errors.md](./errors.md) |
| `401` | Missing/invalid token |
| `500` | Unexpected server error |

## List your trades

`GET /trades`

Paginated list of trades where the caller is buyer or seller. See
[overview.md](./overview.md#pagination) for `page`/`limit`/`sort`.

**Query parameters**

| Param | Type | Notes |
|---|---|---|
| `status` | enum | `PENDING_SIGNATURE`, `CREATED`, `FUNDED`, `DELIVERED`, `COMPLETED`, `DISPUTED`, `CANCELLED` |
| `page` | integer | default `1` |
| `limit` | integer | default `20`, max `100` |
| `sort` | string | e.g. `createdAt:desc` |

**Response `200`**

```json
{
  "items": [
    {
      "tradeId": "4294967297",
      "buyerAddress": "GAAA...WHF",
      "sellerAddress": "GBBB...C4",
      "amountUsdc": "125.1234567",
      "status": "FUNDED"
    }
  ]
}
```

## Trade stats

`GET /trades/stats` - aggregate counts/totals for the caller's trades.
Response shape is intentionally open-ended (`additionalProperties: true` in
the OpenAPI spec) since new aggregates get added over time; treat unknown
fields as forward-compatible additions.

## Fetch a trade

`GET /trades/:id` - returns the [`TradeSummary`](#trade-object-fields) for a
single trade. `403` if the caller is neither buyer, seller, nor an admin;
`404` if the trade doesn't exist.

## Deposit

`POST /trades/:id/deposit`

Builds the deposit transaction. **Buyer only**, and the trade must be
`CREATED`. Supports `Idempotency-Key`.

**Response `200`**: `{ "unsignedXdr": "..." }`

## Confirm delivery

`POST /trades/:id/confirm`

Builds the confirm-delivery transaction. **Buyer only**, and the trade must
be `FUNDED`.

`403` example bodies:

```json
{ "error": "Only the buyer may confirm delivery" }
```

## Release funds

`POST /trades/:id/release`

Builds the release-funds transaction, moving escrowed funds to the seller.
**Buyer or an admin wallet** (see [admin.md](./admin.md)), and the trade
must be `DELIVERED`. Supports `Idempotency-Key`.

`403` example: `{ "error": "Only the buyer or an admin may release funds" }`

## Open a dispute

`POST /trades/:id/dispute`

Builds the dispute transaction. Supports `Idempotency-Key`.

**Request body**

```json
{
  "reason": "Goods arrived damaged at delivery point.",
  "category": "DAMAGE"
}
```

- `reason` is required, minimum 10 characters.
- Provide either `category` (name) or `categoryId` (numeric id) - it must
  match an active entry from `GET /dispute-categories`.

## Manifest

`GET /trades/:id/manifest` / `POST /trades/:id/manifest`

The delivery manifest (driver, vehicle, route, ETA). The response shape
depends on the caller's role, since manifest data includes courier PII:

| Caller | View |
|---|---|
| Seller | Full manifest, all fields |
| Buyer | Driver identity fields masked |
| Mediator/admin | Driver identity fields hashed |

`POST` requires `driverName`, `driverIdNumber`, `vehicleRegistration`,
`routeDescription`, `expectedDeliveryAt` (ISO 8601). Returns `409` if a
manifest already exists for the trade - manifests aren't overwritable via
this endpoint.

## Evidence

`GET /trades/:id/evidence` - list evidence records attached to a trade (photos, documents, etc. referenced by IPFS CID). Streaming/upload of the underlying files is handled by `GET /evidence/:cid/stream` and `POST /evidence/video`.

## Audit history

`GET /trades/:id/history`

Returns the full event history for a trade.

| Query param | Effect |
|---|---|
| `format=json` (default) | JSON array of events under `events` |
| `format=csv` | Returns `text/csv` instead of JSON |
| `signed=true` | Adds `canonicalPayload` and `integrity` (hash + algorithm + key id) so the export can be verified later |

`GET /trades/:id/history/verify?signature=<base64>` re-verifies a
previously-issued signed export and returns:

```json
{ "valid": true, "payloadHash": "...", "algorithm": "ed25519", "keyId": null }
```

## Trade object fields

`TradeSummary` (the shape returned by list/fetch endpoints) is intentionally
open (`additionalProperties: true`) since fields get added as the domain
model grows. The fields guaranteed to be present today:

| Field | Type | Notes |
|---|---|---|
| `tradeId` | string | Stable identifier, always present |
| `buyerAddress` | string | Stellar public key |
| `sellerAddress` | string | Stellar public key |
| `amountUsdc` | string | Decimal string, not a float - do not parse with `parseFloat` for anything money-related |
| `status` | string | One of the lifecycle statuses above |

Treat any other field on a trade object as informational and optional.
