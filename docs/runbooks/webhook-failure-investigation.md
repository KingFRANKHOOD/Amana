# Webhook Failure Investigation Runbook

This runbook provides step-by-step procedures for investigating and remediating persistent webhook delivery failures in the Amana platform.

## 1. Symptoms

- Partners report missing trade state change notifications.
- `webhook_delivery_failure` alerts fire in the alerting channel.
- Prometheus metrics show sustained elevation in `webhook_delivery_failures_total`.
- `GET /admin/webhooks/status` shows growing dead-letter count.

## 2. Severity Classification

| Severity | Criteria | Response SLA |
|---|---|---|
| **P1 - High** | Dead-letter queue growing > 10/hr, or critical partner webhook failing. | < 15 minutes |
| **P2 - Medium** | Sporadic 5xx/429 responses, single webhook target failing. | < 1 hour |
| **P3 - Low** | Single transient failure, auto-recovered within retry window. | < 24 hours |

## 3. Immediate Triage

1. **Acknowledge the alert** and declare incident severity per the table above.
2. **Check webhook status dashboard**:
   ```bash
   curl -s -H "Authorization: Bearer $ADMIN_JWT" \
     https://<api-host>/api/v1/admin/webhooks/status | jq .
   ```
3. **Inspect recent dead letters**:
   ```bash
   curl -s -H "Authorization: Bearer $ADMIN_JWT" \
     "https://<api-host>/api/v1/admin/webhooks/dead-letters?limit=20" | jq .
   ```

## 4. Diagnostic Steps

### 4.1 Identify Failing Endpoints

- Review `deadLetters.recent` from the admin status endpoint.
- Note patterns: same `webhookUrl`, specific `event` types, or specific `tradeId` ranges.
- Check if failures are isolated to a single partner or systemic.

### 4.2 Verify Target Health

- Manually `curl` the failing webhook URL with a synthetic payload:
  ```bash
  curl -v -X POST https://<partner-webhook>/events \
    -H "Content-Type: application/json" \
    -H "X-Webhook-Signature: <computed-sig>" \
    -d '{"event":"trade.created","tradeId":"test","status":"CREATED","timestamp":"2026-08-30T19:00:00Z","data":{}}'
  ```
- Document the HTTP status code and response body.

### 4.3 Review Application Logs

Filter logs for the failing URL:
```bash
grep -E "Webhook (delivery|dispatch)" logs/app.log | jq .
```

Key fields to inspect:
- `webhookUrl`
- `subscriptionId`
- `statusCode`
- `attempt`
- `consecutiveFailures`

### 4.4 Check Network & DNS

- Verify DNS resolution for the target hostname.
- Confirm TLS certificate validity.
- Check for IP blocks or firewall rules if running from restricted environments.

### 4.5 Review Retry Configuration

Current defaults (see `env.ts`):
- `WEBHOOK_MAX_ATTEMPTS`: 3
- `WEBHOOK_RETRY_BASE_MS`: 1000
- `WEBHOOK_RETRY_MAX_MS`: 30000
- `WEBHOOK_CONSECUTIVE_FAILURE_THRESHOLD`: 5

## 5. Remediation Procedures

### 5.1 Partner-Side Fix

If the partner's endpoint is returning 5xx or is unreachable:
1. Notify the partner with the `lastError` details from the dead-letter record.
2. Provide the synthetic payload that reproduces the failure.
3. Ask the partner to:
   - Verify endpoint is listening on the expected path.
   - Check load balancer / WAF rules.
   - Confirm TLS chain is valid.

### 5.2 Temporary Disable Webhook

If the failing endpoint is causing cascading issues (e.g., queue backlog):

```bash
curl -X PATCH https://<api-host>/api/v1/admin/features \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"name": "WEBHOOK_DISPATCH_ENABLED", "enabled": false}'
```

> **Note**: This requires the `WEBHOOK_DISPATCH_ENABLED` feature flag to exist. If it does not, create it in the feature flag service.

### 5.3 Replay Dead-Lettered Events

Once the partner endpoint is healthy, replay dead-lettered events:

```bash
curl -X POST https://<api-host>/api/v1/admin/webhooks/dead-letters/replay \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl": "https://partner.example.com/hook"}'
```

> **Note**: This endpoint should be implemented if not already available. As a workaround, use the admin API to read dead letters and dispatch manually.

### 5.4 Adjust Retry Policy

If failures are transient (e.g., partner maintenance window), you can increase retries temporarily:

```bash
kubectl set env deployment/backend \
  WEBHOOK_MAX_ATTEMPTS=5 \
  WEBHOOK_RETRY_BASE_MS=2000 \
  WEBHOOK_RETRY_MAX_MS=60000
kubectl rollout restart deployment/backend
```

## 6. Prevention

- **Monitoring**: Ensure `webhook_delivery_failures_total` and `webhook_dead_letter_total` are covered by Prometheus alerts.
- **Partner Onboarding**: Require partners to provide a health-check endpoint and confirm receipt of test events before production traffic.
- **Circuit Breaking**: Consider adding per-URL circuit breakers to prevent retry storms from overwhelming a degraded partner.

## 7. Escalation

| Condition | Escalation Path |
|---|---|
| Dead-letter count > 100 in 1 hour | Page on-call + notify partner success team |
| Critical trade event (e.g., `trade.completed`) failing for > 30 min | Page engineering lead + communications lead |
| Partner unresponsive for > 4 hours | Disable webhook and notify users via in-app notification |

## 8. Post-Incident

1. Update this runbook with any new failure modes discovered.
2. File a GitHub issue for systemic fixes (e.g., adding circuit breakers).
3. Conduct a blameless postmortem per the [Incident Response Playbook](../runbooks/incident-response.md).
