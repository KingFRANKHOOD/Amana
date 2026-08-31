# Amana Logging Standards

**Issue Reference:** #1105 — No Comprehensive Logging Standards Documented  
**Applies to:** Backend (Node.js/Pino), Frontend (Next.js/TracedHttpClient), Mobile (React Native Expo), Smart Contracts (Soroban/Rust), Background Jobs (BullMQ)

---

## Table of Contents

1. [Overview & Objectives](#1-overview--objectives)
2. [Log Levels](#2-log-levels)
3. [Universal Log Fields](#3-universal-log-fields)
4. [Backend Logging (Pino)](#4-backend-logging-pino)
5. [Frontend Logging (TracedHttpClient)](#5-frontend-logging-tracedhttpclient)
6. [Mobile Logging (React Native Expo)](#6-mobile-logging-react-native-expo)
7. [Smart Contract Event Logging (Soroban)](#7-smart-contract-event-logging-soroban)
8. [Background Job Logging (BullMQ)](#8-background-job-logging-bullmq)
9. [Sensitive Data & PII Handling](#9-sensitive-data--pii-handling)
10. [Log Retention & Volume Targets](#10-log-retention--volume-targets)
11. [Loki / Grafana Query Reference](#11-loki--grafana-query-reference)
12. [Do's and Don'ts](#12-dos-and-donts)

---

## 1. Overview & Objectives

Amana is a distributed escrow system. End-to-end observability is critical for diagnosing trade failures, contract discrepancies, and user-reported incidents quickly. These standards ensure:

- Every log line is **machine-parseable** (JSON / structured key-value).
- Every log line carries **trace context** (correlation ID, request ID, OpenTelemetry trace/span IDs) so a single trade failure can be followed from the browser across the API, job queue, and Stellar contract.
- **Sensitive fields** (wallet private keys, passwords, raw JWT tokens, PII) are never written to logs.
- Log output is sized correctly for our Loki + Promtail + Grafana stack and stays within configured retention budgets.

The existing `docs/ERROR_LOGGING_STANDARDS.md` covers the error-specific subset (AppError, error correlation IDs, Zod errors). This document covers the complete picture across all layers and lifecycle events.

---

## 2. Log Levels

All stacks use the same five levels and the same semantics:

| Level   | Pino value | When to use |
|---------|------------|-------------|
| `FATAL` | 60         | Process cannot continue — unrecoverable startup failure, critical dependency unavailable. Always exits (`process.exit(1)`). |
| `ERROR` | 50         | 5xx responses, uncaught exceptions, infrastructure faults, invariant violations. Requires triage. |
| `WARN`  | 40         | 4xx client errors, expected failures (rate limit, invalid business state), degraded-but-running conditions, slow queries. |
| `INFO`  | 30         | Normal lifecycle events (server start, service init, job completed, trade state change). |
| `DEBUG` | 20         | Detailed internals useful during local development and troubleshooting. Never enabled in production. |
| `TRACE` | 10         | Highly verbose: every individual DB query, serialised payloads. Only for targeted local debugging. |

### Level matrix per environment

| Environment  | Min level |
|--------------|-----------|
| `production` | `info`    |
| `staging`    | `info`    |
| `development`| `debug`   |
| `test`       | `silent`  |

The backend enforces this in `backend/src/middleware/logger.ts`:

```typescript
export const appLogger = pino(
  isTest
    ? { level: 'silent' }
    : {
        level: env.NODE_ENV === 'production' ? 'info' : 'debug',
        // ...
      }
);
```

---

## 3. Universal Log Fields

Every structured log record **must** include these fields regardless of stack:

| Field            | Type     | Description |
|------------------|----------|-------------|
| `level`          | string   | Log level (`info`, `warn`, `error`, …) |
| `time`           | number   | Unix timestamp (milliseconds) |
| `service`        | string   | `backend`, `frontend`, `mobile` |
| `correlationId`  | string   | Logical trace ID spanning multiple services. Propagated via `x-correlation-id` header. |
| `msg`            | string   | Human-readable description of the event. |

Additional fields are context-dependent (see per-stack sections) but when available **must** be included:

| Field           | Type   | When to include |
|-----------------|--------|-----------------|
| `requestId`     | string | Per-HTTP-request unique ID |
| `traceId`       | string | OpenTelemetry trace ID |
| `spanId`        | string | OpenTelemetry span ID |
| `tradeId`       | string | Any log touching a trade record |
| `userId`        | string | Any log touching a user action |
| `operation`     | string | Name of the logical operation (e.g. `trade.fund`, `dispute.resolve`) |
| `jobId`         | string/number | Background job logs |
| `durationMs`    | number | Latency-critical paths |
| `statusCode`    | number | HTTP response logs |

---

## 4. Backend Logging (Pino)

### 4.1 Logger Hierarchy

```
appLogger (pino root)
  └── pinoHttp middleware   → per-request access log
  └── requestLoggerMiddleware → structured finish log (status, durationMs, route)
  └── errorHandler         → structured error log (AppError, ZodError, unhandled)
  └── getContextualLogger(req) → per-handler child logger with correlationId + traceId
  └── getJobContextualLogger() → per-job child logger
```

Source: `backend/src/middleware/logger.ts`, `backend/src/lib/logging.ts`.

### 4.2 HTTP Request Logging

`pinoHttp` (`logger.ts`) emits two records per request:
1. **Incoming** — method, URL, headers with correlation/request IDs stripped to safe fields.
2. **Finished** — same fields plus `status`, `durationMs`, `route` (normalised, no UUIDs).

`requestLoggerMiddleware` (`request.logger.middleware.ts`) adds:
- Prometheus histogram increment via `metricsService.recordHttpRequest`
- Slow-endpoint alert dispatch when `durationMs > 2000`
- `X-Request-Id` and `X-Response-Time` response headers

Health check (`/health`) and docs (`/api/docs`) paths are excluded from access logs to reduce noise.

### 4.3 Using `getContextualLogger` in Handlers

Always prefer the contextual child logger inside route handlers and services. It pre-populates `correlationId`, `requestId`, `trace_id`, `span_id`, and `service`.

```typescript
import { getContextualLogger } from '../lib/logging';

export async function createTrade(req: AuthRequest, res: Response) {
  const logger = getContextualLogger(req);

  logger.info({ buyerAddress: req.user.address }, 'trade.create_pending: initiated');

  try {
    const trade = await tradeService.create({ ...req.body, buyerAddress: req.user.address });
    logger.info({ tradeId: trade.id }, 'trade.create_pending: success');
    res.status(201).json(trade);
  } catch (error) {
    // AppError / ServiceErrorConverter will produce structured error logs via errorHandler.
    // Re-throw — do NOT log here; double-logging creates noise.
    throw error;
  }
}
```

Do **not** call `appLogger` directly inside route handlers — it loses correlation context.

### 4.4 Error Logging

Error logging is handled centrally by `errorHandler.ts`. The middleware:

- Logs `AppError` at `WARN` (4xx) or `ERROR` (5xx).
- Logs Zod validation errors at `WARN`.
- Logs all unhandled errors at `ERROR`.

Each log includes: `errorCorrelationId`, `code`, `message`, `statusCode`, `tradeId`, `userId`, `operation`, `requestId`, `correlationId`, `path`, `method`, `stack`.

**Do not** swallow errors in handlers — let them bubble to the error handler so they are logged consistently. See `docs/ERROR_LOGGING_STANDARDS.md` for the full payload schema and `AppError` API.

### 4.5 External Service Calls (TracedHttpClient)

All outbound HTTP calls to Stellar Horizon, IPFS/Pinata, or third-party webhooks must use `TracedHttpClient` from `backend/src/lib/traced-http-client.ts`. The client:

- Creates an OpenTelemetry `CLIENT` span for every call.
- Propagates `x-correlation-id` and `x-request-id` from the active span context.
- Records `http.status_code`, request/response body sizes, and span status on the span.
- Uses `ServiceErrorConverter` to normalise failure into `AppError`.

```typescript
import { createTracedClient } from '../lib/traced-http-client';
import { ServiceErrorConverter, ServiceType } from '../errors/serviceErrorConverter';

const horizonClient = createTracedClient('https://horizon-testnet.stellar.org', 'stellar-horizon');

try {
  const { data } = await horizonClient.get(`/accounts/${address}`);
  return data;
} catch (err) {
  throw ServiceErrorConverter.convertStellarError(err, {
    operation: 'stellar.account_fetch',
    userId: address,
  });
}
```

### 4.6 Log Field Reference for Backend

```json
// INFO — successful request finish
{
  "level": "info",
  "time": 1756691586212,
  "service": "backend",
  "correlationId": "abc123",
  "requestId": "req_uuid",
  "trace_id": "otel_trace_id",
  "span_id": "otel_span_id",
  "method": "POST",
  "path": "/api/v1/trades",
  "route": "/api/v1/trades",
  "status": 201,
  "durationMs": 142.5,
  "userId": "GA2C5RF...",
  "msg": "request completed"
}

// WARN — 4xx AppError
{
  "level": "warn",
  "time": 1756691586212,
  "service": "backend",
  "correlationId": "abc123",
  "requestId": "req_uuid",
  "errorCorrelationId": "err_550e8400-...",
  "code": "TRADE_INVALID_STATUS",
  "message": "Trade must be in FUNDED status",
  "statusCode": 400,
  "tradeId": "TRD-90210",
  "userId": "GA2C5RF...",
  "operation": "POST /api/v1/trades/TRD-90210/manifest",
  "msg": "[TRADE_INVALID_STATUS] Business logic error handled"
}
```

---

## 5. Frontend Logging (TracedHttpClient)

The frontend does not have a persistent log store — browser console logs are ephemeral and should be treated as developer-only tooling. The objective is to:

1. Propagate correlation IDs to the backend so backend logs can be correlated to a user session.
2. Emit structured `console` calls that monitoring tools (Sentry, DataDog RUM) can scrape.

### 5.1 TracedHttpClient

`frontend/src/lib/traced-fetch.ts` exports a `TracedHttpClient` singleton. All API calls in components and hooks must go through this client, **not** raw `fetch` or Axios.

The client automatically:
- Generates a session-scoped `correlationId` stored in `sessionStorage` under `amana-correlation-id`.
- Adds `X-Correlation-Id` and `X-Request-Id` headers to every request.
- Emits structured `console.log` on request start, success, and `console.error` on failure.

```typescript
import { tracedHttpClient } from '@/lib/traced-fetch';

// Good — correlation ID is propagated automatically
const trade = await tracedHttpClient.get<Trade>('/api/v1/trades/TRD-90210');

// Bad — raw fetch loses correlation context
const res = await fetch('/api/v1/trades/TRD-90210');
```

### 5.2 Log Shape (Console)

```typescript
// Request start (console.log)
{
  correlationId: "abc123",
  requestId: "req_uuid",
  method: "GET",
  url: "/api/v1/trades/TRD-90210",
  headers: { "X-Correlation-Id": "abc123", ... }  // Authorization omitted
}

// Request success (console.log)
{
  correlationId: "abc123",
  requestId: "req_uuid",
  status: 200,
  duration: 138,
  headers: { ... }
}

// Request error (console.error)
{
  correlationId: "abc123",
  requestId: "req_uuid",
  error: "HTTP 404: Not Found",
  duration: 45
}
```

### 5.3 Error Handling in Components

Use `getErrorInfo` from `frontend/src/lib/errorHandler.ts` to translate backend error codes into user-facing toast messages. Never surface raw `err.message` directly to users.

```typescript
import { getErrorInfo } from '@/lib/errorHandler';
import { useToast } from '@/hooks/useToast';

const { addToast } = useToast();

try {
  await tracedHttpClient.post('/api/v1/trades', payload);
} catch (err) {
  const { title, message, type } = getErrorInfo(err);
  addToast({ title, message, type });
  // Also log for developer visibility
  console.error('[trade.create] failed', { correlationId, err });
}
```

### 5.4 Correlation ID Continuity

To link a user-initiated flow (e.g. multi-step trade creation) to a single correlation chain:

```typescript
import { setSessionCorrelationId, createCorrelationId } from '@/lib/traced-fetch';

// At the start of a new trade wizard flow
const flowCorrelationId = createCorrelationId();
setSessionCorrelationId(flowCorrelationId);

// All subsequent TracedHttpClient calls in the session will use flowCorrelationId
```

---

## 6. Mobile Logging (React Native Expo)

The mobile app (`mobile/`) is a React Native Expo client. It has no server-side log shipping but must propagate correlation IDs to the backend and use structured logging patterns for crash reporting and local dev debugging.

### 6.1 Guiding Principles

- Use `console.info`, `console.warn`, `console.error` with a structured first argument.
- Always include `{ screen, operation, correlationId }` context.
- Use the Expo `__DEV__` flag to gate verbose logging.

```typescript
// Good
console.info('[TradeCreate] Submitting trade', {
  screen: 'TradeCreate',
  operation: 'trade.submit',
  correlationId,
  tradePayload: { amount, currency }, // ✅ safe business data
});

// Bad — unstructured, hard to query
console.log('submitting trade...');
```

### 6.2 API Client Headers

The mobile API client at `mobile/src/api/client.ts` must attach `X-Correlation-Id` on every request:

```typescript
import axios from 'axios';
import { getCorrelationId } from '../utils/correlationId';

const apiClient = axios.create({ baseURL: process.env.EXPO_PUBLIC_API_URL });

apiClient.interceptors.request.use((config) => {
  config.headers['X-Correlation-Id'] = getCorrelationId();
  config.headers['X-Client-Platform'] = 'mobile';
  config.headers['X-App-Version'] = process.env.EXPO_PUBLIC_APP_VERSION ?? '0.0.0';
  return config;
});
```

### 6.3 Crash Reporting Integration

When integrating Sentry or similar:
- Set `Sentry.setTag('correlationId', correlationId)` at session start.
- Use `Sentry.addBreadcrumb` for trade state transitions.
- Never pass the raw error stack to the user interface.

### 6.4 Log Levels for Mobile

| Severity     | API | When to use |
|-------------|-----|-------------|
| `error`      | `console.error` | Uncaught exceptions, Sentry captures |
| `warn`       | `console.warn`  | Expected failures, degraded UX paths |
| `info`       | `console.info`  | Lifecycle events, state changes |
| `debug`      | `console.log` gated by `__DEV__` | Dev-only verbose output |

---

## 7. Smart Contract Event Logging (Soroban)

Soroban contracts (`contracts/amana_escrow/`) emit **on-chain events** via `env.events().publish(...)`. These are not traditional logs but serve as the immutable audit trail for all escrow state changes. They are indexed by `EventIndexerService` (`backend/src/services/event-indexer.ts`) into the database and then surfaced via the backend events API.

### 7.1 Event Naming Convention

All contract events follow `(topic_symbol, detail_struct)`:

```rust
// Correct — single descriptive topic, typed detail struct
env.events().publish(
    (symbol_short!("funded"),),
    FundedEventData { trade_id: trade_id.clone(), buyer: buyer.clone(), amount },
);
```

Topic symbols must be short (`symbol_short!`) and lowercase. Examples: `funded`, `released`, `refunded`, `disputed`, `resolved`.

### 7.2 Required Fields Per Event

Every contract event struct must include:

| Field     | Type          | Description |
|-----------|---------------|-------------|
| `trade_id`| `Bytes`/`String` | Unique trade identifier |
| `actor`   | `Address`     | Wallet address triggering the state change |
| Transition fields | varies | e.g. `amount`, `loss_ratio`, `resolution` |

### 7.3 Indexing & Correlation

The `EventIndexerService` correlates contract events with backend requests via `correlationId` stored in trade metadata. This allows a full trace from frontend action → backend API log → contract event.

### 7.4 What Not to Log in Contracts

Soroban contracts must **never** emit events containing:
- Private keys or seeds
- Off-chain API tokens
- Personal user data beyond public wallet addresses

---

## 8. Background Job Logging (BullMQ)

All BullMQ workers in `backend/src/jobs/workers/` must use `getJobContextualLogger` from `backend/src/lib/logging.ts`.

### 8.1 Standard Job Log Pattern

```typescript
import { getJobContextualLogger } from '../lib/logging';
import { Worker, Job } from 'bullmq';

export function createNotificationWorker() {
  return new Worker<NotificationJobData>(
    'notifications',
    async (job: Job<NotificationJobData>) => {
      const logger = getJobContextualLogger(
        job.id,
        job.data.correlationId,   // propagated from the request that enqueued the job
        { tradeId: job.data.tradeId, userId: job.data.userId }
      );

      logger.info({ attempt: job.attemptsMade }, 'notification.send: started');

      try {
        await sendNotification(job.data);
        logger.info('notification.send: success');
      } catch (error) {
        logger.error({ error }, 'notification.send: failed');
        throw error; // BullMQ will handle retry
      }
    },
    { connection: createQueueConnection() }
  );
}
```

### 8.2 Propagating Correlation IDs into Jobs

When enqueuing a job from a request handler, always forward the trace context:

```typescript
import { extractTraceContext } from '../lib/logging';

// In a route handler
const traceContext = extractTraceContext(req);

await notificationQueue.add('send', {
  email: user.email,
  tradeId,
  ...traceContext, // includes correlationId, requestId, trace_id, span_id
});
```

### 8.3 Required Job Log Fields

| Field         | Included via |
|---------------|-------------|
| `jobId`       | `getJobContextualLogger(job.id, ...)` |
| `correlationId` | forwarded from originating request |
| `tradeId`     | `additionalContext` argument |
| `userId`      | `additionalContext` argument |
| `attempt`     | logged explicitly: `{ attempt: job.attemptsMade }` |
| `queueName`   | logged at job start |

### 8.4 Worker-Level Error Logging

BullMQ's `Worker` emits `failed` and `error` events. Attach listeners to capture permanent failures:

```typescript
const worker = createNotificationWorker();

worker.on('failed', (job, err) => {
  appLogger.error(
    { jobId: job?.id, err, tradeId: job?.data?.tradeId },
    'notification.send: permanently failed after all retries'
  );
});
```

---

## 9. Sensitive Data & PII Handling

This section is **mandatory**. Logging sensitive data is an irreversible security incident.

### 9.1 Fields That Must NEVER Appear in Logs

| Category         | Examples |
|-----------------|----------|
| Cryptographic secrets | Stellar secret keys (`S...`), JWT secret, cookie signing keys, encryption keys |
| Auth tokens | Raw JWT access/refresh tokens, Supabase service role key, Pinata API secret |
| User PII | Full names, phone numbers, physical addresses, national ID numbers |
| Payment card data | Card numbers, CVV, expiry dates (Amana uses on-chain wallets, but relevant for future integrations) |
| Passwords | Any hash or plaintext password |

### 9.2 Safe Fields

The following are safe to log:

| Field | Notes |
|-------|-------|
| Stellar public key (`G...`) | Public, not sensitive |
| Trade ID, Dispute ID | Internal identifiers |
| User UUID | Internal identifier (not name/contact) |
| Wallet balance amounts | Financial but not secret |
| IPFS CID | Content hash, public |
| HTTP status codes | Safe |
| Error codes (`TRADE_INVALID_STATUS`) | Safe |

### 9.3 Redaction Rules in Code

**Never log request/response bodies wholesale.** Explicitly pick the fields you need:

```typescript
// ❌ Bad — may log sensitive fields
logger.info({ body: req.body }, 'Request received');

// ✅ Good — explicit safe fields only
logger.info(
  { tradeId: req.body.tradeId, amount: req.body.amount },
  'trade.create_pending: initiated'
);
```

For the backend request serialiser in `pinoHttp`, sensitive headers (`Authorization`, `cookie`) are excluded by default through the `serializers.req` override in `logger.ts`.

### 9.4 Pino Redaction Config (Backend)

If logging objects that may contain sensitive keys, add a `redact` block when constructing child loggers:

```typescript
const safeLogger = appLogger.child(
  { service: 'auth' },
  {
    redact: {
      paths: ['*.password', '*.secret', '*.token', '*.privateKey', '*.seedPhrase'],
      censor: '[REDACTED]',
    },
  }
);
```

### 9.5 Frontend — Authorization Header Exclusion

`TracedHttpClient` already strips `Authorization` from logged headers:

```typescript
headers: Object.fromEntries(
  Object.entries(headers).filter(([key]) =>
    !key.toLowerCase().includes('authorization')
  )
)
```

Do **not** modify this filter to include auth headers.

---

## 10. Log Retention & Volume Targets

Retention is governed by `docs/DATA_RETENTION_POLICY.md`. This section summarises log-specific targets.

| Log type          | Retention  | Notes |
|-------------------|------------|-------|
| Backend access logs (Loki) | 90 days | Promtail configured in `promtail/config.yml` |
| Error logs (Loki) | 180 days  | Errors warrant longer retention for audit |
| Audit trail (DB)  | 7 years   | Tamper-evident records — `docs/audit-logging.md` |
| Contract events (on-chain) | Permanent | Indexed off-chain; raw chain data permanent |
| Frontend console  | Session only | Ephemeral; crash reports ship to error monitoring service |
| Mobile logs       | Session only | Crash/error reports ship to Sentry |

### Volume Guidance

| Condition | Action |
|-----------|--------|
| Access log rate > 10 000 req/min | Enable health check path exclusion (already active) |
| DEBUG logs in staging exceed 50 MB/day | Review and trim debug statements; switch to `info` |
| Single job emits > 1 000 lines | Consolidate into batch summary log |

---

## 11. Loki / Grafana Query Reference

All backend logs ship via Promtail to Loki, labelled `{app="amana-backend"}`. Frontend and mobile logs are not in Loki.

### 11.1 Common Queries

**All errors in the last hour:**
```logql
{app="amana-backend"} | json | level="error"
```

**Errors for a specific trade:**
```logql
{app="amana-backend"} | json | tradeId="TRD-90210"
```

**All logs for a user session (by correlation ID):**
```logql
{app="amana-backend"} | json | correlationId="abc123"
```

**Look up a specific error from a user-reported `X-Error-Correlation-Id` header:**
```logql
{app="amana-backend"} | json | errorCorrelationId="err_550e8400-e29b-41d4-a716-446655440000"
```

**Slow requests (> 2 s):**
```logql
{app="amana-backend"} | json | durationMs > 2000
```

**5xx errors by route:**
```logql
{app="amana-backend"}
  | json
  | statusCode >= 500
  | line_format "{{.route}} {{.method}} {{.statusCode}} {{.durationMs}}ms"
```

**Background job failures:**
```logql
{app="amana-backend"} | json | jobId != "" | level="error"
```

**All logs for a specific job ID:**
```logql
{app="amana-backend"} | json | jobId="42"
```

**Trace a request from frontend to backend (frontend passes correlationId in `X-Correlation-Id`):**
```logql
{app="amana-backend"} | json | correlationId="<correlationId from browser console>"
```

### 11.2 Grafana Dashboard

The error-monitoring dashboard is at `grafana/provisioning/dashboards/error-monitoring-dashboard.json` (`amana-error-monitoring`). It includes:

- Error rate (5xx/4xx) time series
- Top error codes by volume
- Slow endpoint heatmap (p95, p99 latency)
- Job failure count per queue
- Live log stream filtered by error level

### 11.3 Alerting

Loki-based alert rules are defined in `grafana/provisioning/alerting/`. Key thresholds:

| Alert | Condition |
|-------|-----------|
| High 5xx rate | `rate({app="amana-backend"} \| json \| statusCode >= 500 [5m]) > 0.05` |
| Job queue failure spike | Failed jobs in any queue > 10 in 5 min |
| Slow endpoint | p95 latency > 2 s sustained for 5 min |

---

## 12. Do's and Don'ts

### ✅ Do

- Use `getContextualLogger(req)` inside every route handler — it pre-fills correlation context.
- Include `tradeId` and `userId` in every log that touches a trade or a user action.
- Use `getJobContextualLogger` in every BullMQ worker processor.
- Propagate `correlationId` from requests into enqueued jobs via `extractTraceContext(req)`.
- Forward `X-Correlation-Id` from frontend/mobile to the backend via `TracedHttpClient`.
- Use `ServiceErrorConverter.convertToAppError` to wrap external service failures.
- Let errors bubble to `errorHandler` — do not double-log.
- Use `appLogger.child({ ... })` with a `redact` config when logging objects that may have sensitive sub-fields.

### ❌ Don't

- **Never** log Stellar secret keys, JWTs, cookie values, or passwords.
- **Never** log `req.body` in full — pick only safe fields.
- **Never** use `console.log` in backend code — use `appLogger` or `getContextualLogger`.
- **Never** enable `debug` or `trace` level in production or staging.
- **Never** silence errors in catch blocks without re-throwing or logging.
- **Never** create a new `pino()` instance inside a handler — use the shared `appLogger`.
- **Never** log the entire `Authorization` header.
- **Never** emit contract events containing off-chain secrets or personal contact data.

---

## Related Documents

- [`docs/ERROR_LOGGING_STANDARDS.md`](./ERROR_LOGGING_STANDARDS.md) — AppError, error correlation IDs, Zod error format
- [`docs/audit-logging.md`](./audit-logging.md) — Tamper-evident audit trail for business events
- [`docs/DATA_RETENTION_POLICY.md`](./DATA_RETENTION_POLICY.md) — Retention schedules for all data including logs
- [`DISTRIBUTED_TRACING_GUIDE.md`](../DISTRIBUTED_TRACING_GUIDE.md) — OpenTelemetry setup, Jaeger, span creation
- [`docs/PROMETHEUS_METRICS.md`](./PROMETHEUS_METRICS.md) — Metrics (not logs) collected per route and queue
- [`backend/src/lib/logging.ts`](../backend/src/lib/logging.ts) — `getContextualLogger`, `getJobContextualLogger`, `extractTraceContext`
- [`backend/src/middleware/logger.ts`](../backend/src/middleware/logger.ts) — Pino root logger and pinoHttp config
- [`frontend/src/lib/traced-fetch.ts`](../frontend/src/lib/traced-fetch.ts) — Frontend TracedHttpClient
