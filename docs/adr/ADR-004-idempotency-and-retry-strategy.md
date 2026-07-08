# ADR-004: Idempotency and Retry Strategy

## Status

Accepted (implemented in `backend/src/middleware/idempotency.ts`,
`backend/src/lib/retry.ts`, and `backend/src/lib/circuitBreaker.ts`; see
[docs/api/overview.md](../api/overview.md#idempotency) for the
consumer-facing contract).

## Context

Amana's mutating endpoints build Stellar/Soroban transactions - operations
where a client retry after a network timeout is dangerous if the original
request actually succeeded server-side (e.g. a trade got created, but the
client never saw the response and retries "create trade" again). Separately,
several backend services depend on external, occasionally-flaky
infrastructure (Horizon, IPFS, the Soroban RPC event stream) where
transient failures are normal and shouldn't surface as user-facing errors,
but a *sustained* outage shouldn't be retried forever either.

These are two different problems that need two different mechanisms:
**idempotency** (client retries of the same logical request must be safe)
and **retry/circuit-breaking** (server-to-dependency calls must tolerate
transient failure without hammering a dead dependency).

## Decision

### Idempotency: client-supplied key, Redis-backed, lock + cache

Mutating endpoints (trade creation, deposit, release, dispute - see
[docs/api/trades.md](../api/trades.md)) accept an optional
`Idempotency-Key` header, handled by `idempotencyMiddleware`:

1. **Cache hit** (`idempotency:<method>:<path>:<key>` exists in Redis):
   replay the original cached response verbatim, *unless* the request body
   hash differs from the original - a key reused with a different body is
   a client bug, not a safe retry, and gets `409` rather than silently
   serving the wrong cached response.
2. **No cache, but a lock exists** (`idempotency:lock:...`, set via Redis
   `SET NX EX` so acquiring it is atomic): another request with the same
   key is already in flight. Rather than racing it, this request **polls
   for the first request's result** for up to `IDEMPOTENCY_LOCK_TTL`
   (30s), and only returns `409 "already in progress"` if that window
   elapses without a result - a client that retries quickly because it
   hasn't heard back yet gets the real answer, not a spurious conflict.
3. **No cache, no lock**: this request acquires the lock, proceeds
   normally, and on any 2xx response caches it (24h TTL) before releasing
   the lock (via `res.once("finish"/"close")`, so the lock releases even
   if the handler throws).
4. Non-2xx responses are **not cached** - a failed attempt should be
   retryable with the same key, not permanently frozen as "the answer."

Idempotency only applies to `POST`/`PUT`/`PATCH`/`DELETE` (mutations); a
request without the header is unaffected, and idempotency is opt-in per
request, not enforced globally, since not every mutation needs it (see
[docs/api/overview.md](../api/overview.md#idempotency) for which endpoints
support it).

### Retry and circuit-breaking: for server-to-dependency calls, not client requests

Separately, outbound calls to Horizon/Stellar RPC and IPFS (in
`pathPayment.service.ts`, `stellar.service.ts`, `eventListener.service.ts`,
`ipfs.service.ts`, `contract.service.ts`) go through:

- **`retryAsync`** (`lib/retry.ts`): retries only errors classified
  retryable by `isRetryableNetworkError` (HTTP `429`, or any `5xx`) -
  a `4xx` (bad request) is never retried, since retrying an invalid
  request just repeats the failure. Default backoff is fixed-step
  (`[1000, 2000, 4000, 8000]`ms) rather than exponential-with-jitter,
  capped at `DEFAULT_MAX_RETRIES` (3) attempts.
- **`CircuitBreaker`** (`lib/circuitBreaker.ts`): wraps a named dependency
  (e.g. `"horizon-path-payment"`) with `CLOSED`/`OPEN`/`HALF_OPEN` states -
  after `failureThreshold` consecutive failures it opens and fails fast
  (`CircuitBreakerOpenError`) for `cooldownMs` before allowing a trial
  request through (`HALF_OPEN`); `successThreshold` consecutive successes
  there closes it again. This protects the rest of the backend from
  piling up slow, doomed retries against a dependency that's actually
  down, and gives callers a fast, clear failure instead of a slow one.
- The two compose: `circuitBreaker.call(() => retryAsync(() => ...))` -
  retry absorbs brief blips, the circuit breaker catches sustained
  outages that retries alone wouldn't (and shouldn't) paper over.

## Consequences

- **Positive:** A client that retries a trade-creation/deposit/release/
  dispute request after a timeout - the most likely failure mode for a
  wallet-signing flow, where the user may take a while to sign - gets the
  original result instead of a duplicate side effect or a confusing error.
- **Positive:** Horizon/IPFS/RPC flakiness is absorbed close to the call
  site, and a sustained outage in one dependency fails fast instead of
  degrading the whole API's latency.
- **Negative:** Idempotency correctness depends entirely on Redis being
  available and not evicting keys early - a Redis outage during the
  `IDEMPOTENCY_LOCK_TTL` window degrades this to "no idempotency
  protection" rather than blocking requests (the middleware doesn't fail
  closed on Redis errors); this is a deliberate availability-over-strictness
  tradeoff worth knowing about, not a bug.
- **Negative/follow-up:** There are currently **two parallel circuit
  breaker implementations** - `lib/circuitBreaker.ts` (used by
  `pathPayment.service.ts`, `health.service.ts`, `ipfs.service.ts`,
  `eventListener.service.ts`) and a separate `lib/circuit-breaker.ts` (used
  only by `stellar.service.ts`), with different option shapes
  (`cooldownMs` vs `resetTimeoutMs`). This wasn't a deliberate decision so
  much as duplication that crept in - consolidating onto one
  implementation would remove a real source of confusion for anyone
  adding a new Horizon-backed call and guessing which one to import.
- **Negative:** The retry backoff is a fixed schedule, not exponential
  with jitter - under a thundering-herd scenario (many requests retrying
  the same dependency at once) this doesn't spread retries out as well as
  jittered backoff would.
