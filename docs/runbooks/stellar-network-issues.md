# Operational Runbook: Stellar Network & RPC Issues

## 1. Overview & Scope

This runbook describes incident triage, alert resolution, and failover management for the **Stellar Network** integration within the Amana platform. It covers Soroban RPC nodes, Horizon endpoints, contract invocation failures, and transaction success rate degradation.

---

## 2. Automated Alerts Reference

The platform automatically raises the following alerts via the `AlertService`:

| Alert Type | Trigger Condition | Severity | Description |
| :--- | :--- | :--- | :--- |
| `stellar_connection_failure` | Primary RPC or Horizon node unreachable / timed out | **P1 / High** | Connectivity failure on current active Stellar node. Triggers automatic node failover. |
| `stellar_rpc_unavailable` | All primary and configured fallback RPC nodes are down | **P0 / Critical** | Complete loss of Soroban contract invocation capability. Core escrow operations suspended. |
| `stellar_rpc_failover` | System switched to a fallback RPC node | **P2 / Medium** | Primary node failed; service operating on backup RPC infrastructure. |
| `stellar_tx_rate_drop` | Rolling transaction success rate falls below 80% (over last 50 transactions) | **P1 / High** | Heightened Soroban transaction revert or submission failure rate. |

---

## 3. Immediate Triage Steps

When a Stellar alert fires, follow these sequential diagnostics:

### Step 1: Check Stellar Service & Node Health
Access the service health endpoint to determine which nodes are failing and view current latencies:

```bash
# Query aggregate health check
curl -s http://localhost:4000/health/aggregate | jq '.dependencies.stellarRpc'

# Or query detailed health endpoint
curl -s http://localhost:4000/health/detail | jq '{stellar: .checks.stellar, details: .details}'
```

Expected diagnostic payload fields:
- `stellarActiveRpcUrl`: Current active RPC endpoint.
- `stellarPrimaryRpcUrl`: Default primary RPC endpoint.
- `stellarFallbackRpcUrls`: List of configured backup RPC endpoints.
- `stellarTransactionStats`: `{ successRate, totalSubmissions, failedSubmissions }`.

### Step 2: Test Public / Configured RPC Endpoints Directly
Verify node reachability and getLatestLedger response from the command line:

```bash
# Test primary RPC node
curl -X POST https://soroban-testnet.stellar.org \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}'

# Test Stellar Public Status
curl -s https://status.stellar.org/api/v2/status.json | jq .
```

---

## 4. Remediation & Failover Procedures

### 4.1 Automatic Failover
The `StellarRpcManager` automatically fails over to the next configured fallback node in `STELLAR_FALLBACK_RPC_URLS` upon detecting consecutive RPC timeouts or HTTP 5xx errors.

### 4.2 Manual Fallback Configuration
If all configured nodes are unresponsive, update environment configuration to point to alternative public or private nodes:

1. Update `.env` / deployment configuration:
```env
STELLAR_RPC_URL=https://mainnet.sorobanrpc.com
STELLAR_FALLBACK_RPC_URLS=https://soroban-rpc.mainnet.stellar.org,https://rpc.ankr.com/stellar_soroban
STELLAR_HEALTH_TIMEOUT_MS=5000
```

2. Restart the backend service or trigger container redeployment:
```bash
# Docker / Kubernetes restart
docker compose restart backend
# or
kubectl rollout restart deployment/amana-backend
```

---

## 5. Diagnostic Commands & Metric Checks

### Prometheus Metrics
Check the following metrics on the `/metrics` endpoint:

- `stellar_rpc_node_healthy{node_url="..."}`: Binary health status (1 = healthy, 0 = unhealthy)
- `stellar_rpc_node_latency_ms{node_url="..."}`: Response latency gauge
- `stellar_rpc_failover_total`: Total count of failovers triggered
- `stellar_tx_submission_success_rate`: Rolling transaction success rate percentage

### Log Inspection
Filter backend logs for Stellar events:

```bash
# Filter for Stellar RPC alerts and failover events
grep -E "stellar|StellarRpcManager|failover" backend.log | jq .
```

---

## 6. Escalation & Status Tracking

1. **Stellar Network Outage**: Check official [Stellar Status Dashboard](https://status.stellar.org) and SDF Discord `#developers` channel.
2. **Contract / Simulation Errors**: If RPC is healthy but transactions fail (`stellar_tx_rate_drop`), check contract event logs:
   - Check `ProcessedEvent` table for Soroban contract reverts or insufficient resource fees.
   - Verify escrow account balance and sequence number synchronicity.
