# ADR-001: Stellar Path Payment Architecture

## Status

Accepted (implemented in `backend/src/services/pathPayment.service.ts`,
exposed via `GET /wallet/path-payment-quote` - see
[docs/api/stellar.md](../api/stellar.md#path-payment-quotes)).

## Context

Amana settles trades in USDC on Stellar, but buyers frequently hold other
assets (most notably NGN-pegged tokens, or XLM). Requiring a buyer to
manually acquire USDC before funding a trade is friction that pushes people
off the platform. Stellar's DEX supports **path payments**, which let a
sender pay in one asset while the receiver gets another, atomically, via an
on-network conversion path - but discovering a *viable* path (one with
enough liquidity for the amount involved) requires querying Horizon's
`strictSendPaths` endpoint, and that endpoint is an external network
dependency that can be slow, rate-limited, or briefly unavailable.

We needed a way to expose "what will I get if I pay with X" to the frontend
without making every quote request a single point of failure for the rest
of the API.

## Decision

1. **Always quote against USDC as the destination asset.** The backend
   resolves the correct USDC issuer for the configured network
   (`USDC_ISSUER_MAINNET`/`USDC_ISSUER_TESTNET`) rather than accepting an
   arbitrary destination asset - trade settlement is always USDC, so the
   quote endpoint's job is narrowly "convert this into what a trade needs,"
   not a general-purpose DEX quoting service.
2. **Source asset defaults to a fixed test/reference issuer when the caller
   doesn't supply one**, so the endpoint has a sane behavior in
   non-production environments without every caller needing to know a real
   issuer address.
3. **Wrap the Horizon call in both a retry and a circuit breaker**
   (`retryAsync` from `lib/retry.ts`, `CircuitBreaker` from
   `lib/circuitBreaker.ts`, named `horizon-path-payment`):
   - `retryAsync` absorbs transient failures (network blips, Horizon 5xx)
     with backoff, so a single flaky request doesn't surface as an error to
     the client.
   - The circuit breaker (5 consecutive failures to open, 2 successes in
     half-open to close, 30s cooldown) protects the rest of the backend
     from a sustained Horizon outage - once open, quote requests fail fast
     with a clear "temporarily unavailable" error instead of piling up
     retries against a dead dependency.
4. **The quote endpoint is read-only and side-effect-free.** It never
   builds or submits a transaction; it only returns candidate routes
   (`source_amount`, `destination_amount`, `path`, etc.) for the client to
   choose from before initiating an actual payment/deposit flow elsewhere.
5. **No caching of path payment quotes.** Unlike `stellar.asset.ts` (which
   caches asset lookups for 5 minutes - see
   [docs/api/stellar.md](../api/stellar.md#assets)), path quotes are
   time-sensitive to DEX liquidity and are deliberately fetched live every
   time rather than risking a stale quote a user acts on.

## Consequences

- **Positive:** A Horizon outage degrades gracefully (fast, clear failure
  via the circuit breaker) instead of cascading into slow timeouts across
  the API.
- **Positive:** Buyers can fund trades from whatever asset they hold,
  which is the entire point of exposing this endpoint.
- **Negative:** Quotes are advisory only - the actual conversion happens
  when the buyer's wallet builds and submits the real path payment
  transaction client-side, and DEX liquidity can move between quote and
  execution. The backend does not (and cannot, without holding funds)
  guarantee the quoted rate.
- **Negative:** The circuit breaker is process-local (an in-memory
  `Map`-backed registry in `lib/circuitBreaker.ts`), so in a multi-instance
  deployment each instance trips independently - a coordinated view of
  Horizon health across instances would need a shared store, which we
  don't have today.
- **Follow-up:** If additional Horizon-backed endpoints need the same
  resilience pattern, extract the retry+circuit-breaker wrapping into a
  shared helper rather than re-implementing it per service - `stellar.fees.ts`
  and `stellar.tx.status.ts` currently handle Horizon failures with a bare
  `try/catch` -> `502`, not this pattern, and might benefit from it as they
  see more traffic.
