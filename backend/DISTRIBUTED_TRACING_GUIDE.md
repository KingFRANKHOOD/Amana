# Distributed Tracing Guide

The Amana backend uses [OpenTelemetry](https://opentelemetry.io/) for distributed
tracing. This guide documents what is instrumented, how to add coverage to a new
flow, and how to test it.

## Overview

- SDK setup lives in [`src/config/tracing.ts`](src/config/tracing.ts). It lazily
  builds a `NodeSDK` with auto-instrumentation for Node core modules/HTTP, plus
  optional Jaeger, Zipkin, and Prometheus exporters controlled by
  `JAEGER_ENDPOINT`, `ZIPKIN_ENDPOINT`, and `PROMETHEUS_PORT` (see
  the `Distributed tracing (optional)` section in [`.env.example`](.env.example)).
- Every inbound HTTP request gets a server span from
  [`tracingMiddleware`](src/middleware/tracing.middleware.ts), which also tags
  the span with correlation IDs, HTTP method/route/status, and response size.
- Business-logic spans are created with the `TracingHelper` class exported from
  `src/config/tracing.ts`.

## `TracingHelper`

```ts
import { TracingHelper } from '../config/tracing';

await TracingHelper.withSpan(
  'trade.create_pending',
  async (span) => {
    // ... do work ...
    span.setAttributes({ 'trade.id': tradeId });
    return result;
  },
  { attributes: { 'trade.id': tradeId } },
);
```

`withSpan` (async) and `withSyncSpan` (sync) start a span, run the callback,
record any thrown error on the span (`recordException` + `ERROR` status), and
always call `span.end()` in a `finally` block — callers don't need to manage
span lifecycle manually. `TracingHelper.addEvent` / `setAttributes` /
`recordException` operate on the currently active span when you don't have a
handle to it (e.g. from a callback nested a few calls deep).

Span names follow a `<domain>.<action>` convention (`auth.generate_challenge`,
`trade.create_pending`, `dispute.transition_status`) so they group naturally in
a tracing backend.

## Instrumented critical flows

| Flow | Span | File |
| --- | --- | --- |
| Auth challenge | `auth.generate_challenge` | `src/services/auth.service.ts` |
| Auth verify | `auth.verify_signature` | `src/services/auth.service.ts` |
| Trade creation | `trade.create_pending` | `src/services/trade.service.ts` |
| Dispute initiation (trade lifecycle) | `dispute.initiate` | `src/services/trade.service.ts` |
| Dispute resolution | `dispute.transition_status` | `src/services/dispute.service.ts` |
| Stellar/Soroban RPC calls | see `src/services/stellar.service.ts` | — |
| Outbound HTTP via the traced client | see `src/lib/traced-http-client.ts` | — |

Key span attributes:

- `auth.*` spans: `auth.operation`, `auth.wallet_address` (lowercased, no PII
  beyond the public Stellar address), and `auth.signature_valid` on verify.
- `trade.*` / `dispute.*` spans: `trade.id`, `trade.status`, and — for dispute
  transitions — `dispute.id`, `dispute.status_from`, `dispute.status_to`.

Attribute values are always primitives (string/number/boolean); never put
secrets, signed challenges, or full request bodies on a span.

## Adding tracing to a new flow

1. Import `TracingHelper` from `../config/tracing`.
2. Wrap the method body in `TracingHelper.withSpan('<domain>.<action>', async (span) => { ... })`.
3. Set attributes that are useful for debugging/filtering (IDs, statuses) —
   avoid unbounded-cardinality values (raw signatures, free-text reasons).
4. Add a test asserting the span is created (see below).

## Testing spans

Mock `@opentelemetry/api` so the real SDK/exporters never run in tests, and
assert against the mocked tracer/span instead of network calls:

```ts
const mockSpan = { setAttributes: jest.fn(), addEvent: jest.fn(), recordException: jest.fn(), setStatus: jest.fn(), end: jest.fn() };
const mockTracer = { startSpan: jest.fn(() => mockSpan) };

jest.mock('@opentelemetry/api', () => ({
  trace: { getTracer: jest.fn(() => mockTracer), getActiveSpan: jest.fn(() => mockSpan), setSpan: jest.fn(), active: jest.fn() },
  SpanKind: { INTERNAL: 'INTERNAL', SERVER: 'SERVER' },
  SpanStatusCode: { OK: 'OK', ERROR: 'ERROR' },
  context: { active: jest.fn(() => ({})), with: jest.fn((_ctx, fn) => fn()) },
}));
```

See [`src/__tests__/tracing.middleware.test.ts`](src/__tests__/tracing.middleware.test.ts)
for the HTTP-level pattern and
[`src/services/__tests__/tracing.coverage.test.ts`](src/services/__tests__/tracing.coverage.test.ts)
for the service-level pattern covering auth, trade lifecycle, and dispute
resolution.

## Local debugging

Run a local Jaeger instance and point the backend at it:

```bash
docker run -d --name jaeger -p 16686:16686 -p 14268:14268 jaegertracing/all-in-one:latest
JAEGER_ENDPOINT=http://localhost:14268/api/traces npm run dev
```

Then browse traces at http://localhost:16686.
