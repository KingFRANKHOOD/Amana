# Admin Endpoints

The endpoints on this page are for administrative operations. Some require
admin privileges (wallet address in `ADMIN_STELLAR_PUBKEYS` environment
variable), while others require only authentication. See individual endpoint
documentation below for specific requirements.

There is no separate "admin login" - the same challenge/verify flow in
[overview.md](./overview.md#authentication) applies; admin status is purely
a function of which wallet signed in.

## Treasury

The treasury holds funds swept from resolved/expired escrow contracts.

`GET /treasury/balance` - current balance of the escrow contract treasury.

**Authentication:** Any authenticated user (bearer token required).

```json
{ "balance": "50000.0000000", "asset": "USDC", "contractId": "CA..." }
```

`GET /treasury/config` - the treasury's contract id, network, and settlement
asset.

**Authentication:** Any authenticated user (bearer token required).

```json
{ "contractId": "CA...", "network": "testnet", "asset": "USDC" }
```

`POST /treasury/withdraw` - builds an unsigned withdrawal transaction moving
funds out of the treasury.

**Authentication:** Admin only. Wallet address must appear in
`ADMIN_STELLAR_PUBKEYS` (comma-separated allowlist). Non-admin users receive
`403 { "error": "Only admin can withdraw treasury funds" }`.

Request:

```json
{ "destination": "GBBB...C4", "amount": "1000.0000000" }
```

Response: `{ "unsignedXdr": "..." }`. As with trade transactions, the caller
still signs and submits this themselves - the backend never holds a signing
key for the treasury.

## Batch trade status updates

`POST /admin/trades/batch/status`

Force-transitions up to 100 trades in one call, e.g. for support/ops
workflows where a trade is stuck. Bypasses the normal buyer/seller-only
transition endpoints in [trades.md](./trades.md), but still enforces the
same status-transition graph (you can't jump straight from `CREATED` to
`COMPLETED`).

**Request body**

```json
{
  "updates": [
    { "tradeId": "4294967297", "status": "CANCELLED" },
    { "tradeId": "4294967298", "status": "CANCELLED" }
  ]
}
```

**Response `200`** - always `200` even for partial failure; check
`succeeded`/`failed` per item rather than the HTTP status:

```json
{
  "succeeded": ["4294967297"],
  "failed": [
    { "tradeId": "4294967298", "reason": "Invalid transition from COMPLETED to CANCELLED" }
  ]
}
```

Failure reasons include `"Trade not found"`, an invalid-transition message,
and `"Concurrency conflict: trade was modified"` (another request updated
the same trade between this request's read and write - retry the batch for
just that trade).

## Feature flags

`GET /admin/features` - list every configured flag.

```json
{
  "flags": {
    "new-checkout": { "enabled": true, "updatedAt": "2026-07-05T12:00:00.000Z" },
    "beta-dashboard": { "enabled": true, "rolloutPercentage": 25, "updatedAt": "2026-07-01T09:00:00.000Z" }
  }
}
```

A flag not present in this map is treated as disabled everywhere.

`PATCH /admin/features/:name` - create or update a flag.

**Request body**

```json
{ "enabled": true, "rolloutPercentage": 25 }
```

| Field | Required | Notes |
|---|---|---|
| `enabled` | yes | Master on/off switch |
| `rolloutPercentage` | no | `0`-`100`. Omit (or `100`) for "on for everyone"; `0` for "off for everyone but flag stays configured"; anything in between gates a deterministic subset of users |

`400 VALIDATION_ERROR` if `rolloutPercentage` is outside `0`-`100`.

**Response `200`**

```json
{
  "name": "new-checkout",
  "flag": { "enabled": true, "rolloutPercentage": 25, "updatedAt": "2026-07-05T12:00:00.000Z" }
}
```

### How rollout percentage gating works

When a route is wrapped in `requireFeature('name')` middleware, the flag is
resolved per authenticated user (by JWT `sub`, falling back to
`walletAddress`), not per request:

- The same user always lands on the same side of the rollout line - a user
  in a 10% rollout stays in it on every request, they aren't re-rolled each
  time.
- A request with no authenticated user can't be placed in a partial
  rollout and is treated as disabled.
- A disabled route responds `503`:

```json
{ "code": "FEATURE_DISABLED", "error": "Feature 'new-checkout' is currently disabled" }
```

Flags are stored in Redis under `feature:<name>`, so flipping a flag via
`PATCH` takes effect immediately for all backend instances - no
redeploy required.
