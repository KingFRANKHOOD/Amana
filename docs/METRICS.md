# Metrics and Analytics Schema

This document describes the privacy-safe event schema used by the frontend analytics layer.

## Goals
- Track key funnel transitions and failures
- Avoid sending PII, sensitive identifiers, or IP-like values
- Use a provider-agnostic wrapper so instrumentation is easy to maintain

## Event Types

### `funnel_step`
Used for transitions between important user steps.

Payload:
- `step`: string — the funnel step name
- `flow`: string (optional) — the flow or page context
- `target`: string (optional) — the destination or action target
- `status`: string (optional) — e.g. `started`, `completed`, `cancelled`

Example:
```json
{
  "step": "landing_to_trades",
  "flow": "landing",
  "target": "trades",
  "status": "started"
}
```

### `ui_failure`
Used for client-side UI errors and rendering problems.

Payload:
- `type`: string — error classification
- `message`: string (optional) — sanitized error message
- `source`: string (optional) — component or page context

### `api_failure`
Used for detected API-level failures.

Payload:
- `endpoint`: string — request endpoint
- `status`: number — HTTP response status code
- `method`: string — HTTP method
- `error`: string (optional) — sanitized error details

### `auth_event`
Used for wallet and authentication events.

Payload:
- `step`: string — auth step name
- `status`: string — `started`, `success`, or `failed`
- `error`: string (optional) — sanitized failure reason

## Privacy Rules
- Redact values for keys that include `email`, `name`, `address`, `wallet`, `token`, `jwt`, `session`, `ip`, or `phone`.
- Redact any string that matches common email, IP address, or wallet address patterns.
- Preserve only non-sensitive metadata useful for debugging and funnel analysis.

## Environment Configuration
The analytics wrapper supports provider configuration through public environment variables.

- `NEXT_PUBLIC_ANALYTICS_PROVIDER`: `plausible` | `custom` | `noop`
- `NEXT_PUBLIC_ANALYTICS_ENDPOINT`: custom endpoint URL for `custom` providers

In non-production environments, the analytics wrapper logs events to the console rather than sending them to an external service.

## Usage

The analytics wrapper lives at `frontend/src/lib/analytics.ts` and exposes the following helper functions:

- `trackEvent(eventName, payload)`
- `trackFunnelStep(step, metadata)`
- `trackFailure(errorType, metadata)`
- `trackApiFailure(endpoint, status, metadata)`
- `trackAuthEvent(step, status, metadata)`

Example:
```ts
import { trackFunnelStep } from '@/lib/analytics';
trackFunnelStep('landing_to_trades', { flow: 'landing', target: 'trades', status: 'started' });
```

## Provider Configuration

- `NEXT_PUBLIC_ANALYTICS_PROVIDER`: `plausible` | `custom` | `noop`
- `NEXT_PUBLIC_ANALYTICS_ENDPOINT`: required only when `custom` is selected

When `NEXT_PUBLIC_ANALYTICS_PROVIDER` is unset or `noop`, events remain console-only in development.
