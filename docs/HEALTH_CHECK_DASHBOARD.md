# Comprehensive API Health Check Aggregation & Monitoring Guide

## 1. Overview & Architecture

The Amana backend provides deep, aggregated health checking and observability across all core services and infrastructure dependencies. Rather than exposing only isolated, binary ping endpoints, the aggregated health architecture computes a weighted system health score, evaluates dependency latencies, tracks queue backlogs, detects circuit breaker states, and provides unified visibility into overall system operational readiness.

```
                              ┌────────────────────────────────────────────────────────┐
                              │            Incoming Traffic / Load Balancers           │
                              │        (Kubernetes Probes, Ingress, AWS ALB)           │
                              └──────────────────────────┬─────────────────────────────┘
                                                         │
                                    ┌────────────────────┼────────────────────┐
                                    │                    │                    │
                           GET /health/live     GET /health/ready     GET /health/aggregate
                           (Liveness Probe)     (Readiness Probe)     (Deep Introspection)
                                    │                    │                    │
                                    └────────────────────┼────────────────────┘
                                                         │
                                                         ▼
                                       ┌───────────────────────────────────┐
                                       │     HealthService Aggregator      │
                                       └─────────────────┬─────────────────┘
                                                         │
         ┌───────────────┬───────────────┬───────────────┼───────────────┬───────────────┬───────────────┐
         │               │               │               │               │               │               │
         ▼               ▼               ▼               ▼               ▼               ▼               ▼
    PostgreSQL         Redis        Stellar RPC     Soroban Event     IPFS/Pinata     Worker Queues    Local Disk
    Database           Cache        & Horizon       Indexer Lag       Gateway         (BullMQ)         Storage & Volume
   (Read/Write)      (Session)     (Contract)      (ProcessedLedger)  (Pin Status)   (Waiting Jobs)    (Writeability)
```

---

## 2. Health Check API Endpoints

All health check endpoints are operational and unversioned (mounted at `/health` without `/api/v1` prefix).

### 2.1 Summary Matrix of Health Endpoints

| Endpoint | HTTP Method | Target Consumer | Criticality Checks | Response Code (Healthy / Failing) | Description |
|---|---|---|---|---|---|
| `/health/live` | `GET` | Kubernetes Liveness Probe, Docker daemon | Process execution | `200` / `503` | Lightweight process responsiveness check. Fails only if process is deadlocked. |
| `/health/ready` | `GET` | Kubernetes Readiness Probe, Load Balancer | Database, Redis, Config, Key | `200` / `503` | Verifies instance is ready to receive and process user traffic. |
| `/health/startup` | `GET` | Kubernetes Startup Probe, Bootstrapper | Critical initial bootstrap deps | `200` / `503` | Fails fast during startup if database, config, or encryption keys are missing. |
| `/health/aggregate` | `GET` | Datadog, Grafana, Opsgenie, Admin tools | All 9 core & external subsystems | `200` (Healthy/Degraded) / `503` (Unhealthy) | Full aggregated dependency report with system health score (0-100%). |
| `/health/summary` | `GET` | Status widgets, operational dashboards | All dependencies | `200` / `503` | Concise summary of healthy vs degraded vs failing counts and health score. |
| `/health/detail` | `GET` | Diagnostic tools, UptimeRobot | External services latency | `200` / `503` | Legacy per-service status and latency introspection. |

---

## 3. Aggregated Health Response Schema (`GET /health/aggregate`)

### Example 200 OK Response (Healthy):
```json
{
  "status": "healthy",
  "systemHealthScore": 100,
  "timestamp": "2026-08-30T15:00:00.000Z",
  "uptimeSeconds": 86400,
  "version": "1.0.0",
  "environment": "production",
  "summary": {
    "totalDependencies": 9,
    "healthyCount": 9,
    "degradedCount": 0,
    "unhealthyCount": 0,
    "criticalFailingCount": 0
  },
  "dependencies": {
    "database": {
      "name": "PostgreSQL Database",
      "status": "healthy",
      "isCritical": true,
      "latencyMs": 4,
      "message": "Database connection healthy"
    },
    "redis": {
      "name": "Redis Cache & Session Store",
      "status": "healthy",
      "isCritical": true,
      "latencyMs": 2,
      "message": "Redis connection healthy"
    },
    "stellarRpc": {
      "name": "Stellar Horizon / RPC",
      "status": "healthy",
      "isCritical": true,
      "latencyMs": 115,
      "message": "Stellar RPC connection healthy"
    },
    "eventIndexer": {
      "name": "Soroban Event Indexer",
      "status": "healthy",
      "isCritical": true,
      "latencyMs": 8,
      "message": "Indexer healthy - last ledger processed 2.4s ago"
    },
    "ipfsStorage": {
      "name": "IPFS / Pinata Storage",
      "status": "healthy",
      "isCritical": false,
      "latencyMs": 230,
      "message": "IPFS/Pinata connection healthy"
    },
    "workerQueues": {
      "name": "BullMQ Worker Queues",
      "status": "healthy",
      "isCritical": false,
      "latencyMs": 2,
      "message": "Queue redis connection active and accepting jobs"
    },
    "localStorage": {
      "name": "Local Disk & Archival Volume",
      "status": "healthy",
      "isCritical": false,
      "latencyMs": 1,
      "message": "Storage volume writable and accessible"
    },
    "configuration": {
      "name": "Application Configuration",
      "status": "healthy",
      "isCritical": true,
      "latencyMs": 0,
      "message": "Configuration valid"
    },
    "encryptionKey": {
      "name": "Encryption Key Management",
      "status": "healthy",
      "isCritical": true,
      "latencyMs": 0,
      "message": "Trade notes encryption key configured"
    }
  },
  "details": {
    "circuitBreakers": [
      { "name": "pinata-pin", "state": "CLOSED" },
      { "name": "ipfs-gateway", "state": "CLOSED" }
    ],
    "websocketConnections": {
      "total": 42,
      "perUserLimit": 5,
      "globalLimit": 1000,
      "maxPerUser": 3
    }
  }
}
```

---

## 4. Load Balancer & Kubernetes Configuration

### 4.1 Kubernetes Deployment Probes (`infra/k8s/backend-deployment.yaml`)
```yaml
containers:
  - name: backend
    image: kingfrankhood/amana-backend:1.0.0
    ports:
      - containerPort: 4000
        name: http
    startupProbe:
      httpGet:
        path: /health/startup
        port: http
      initialDelaySeconds: 5
      periodSeconds: 5
      failureThreshold: 10
    livenessProbe:
      httpGet:
        path: /health/live
        port: http
      initialDelaySeconds: 15
      periodSeconds: 15
      timeoutSeconds: 3
      failureThreshold: 3
    readinessProbe:
      httpGet:
        path: /health/ready
        port: http
      initialDelaySeconds: 10
      periodSeconds: 10
      timeoutSeconds: 5
      failureThreshold: 3
```

### 4.2 Ingress & AWS ALB Annotations (`infra/k8s/ingress.yaml`)
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: amana-ingress
  annotations:
    alb.ingress.kubernetes.io/healthcheck-path: /health/ready
    alb.ingress.kubernetes.io/healthcheck-interval-seconds: "15"
    alb.ingress.kubernetes.io/healthcheck-timeout-seconds: "5"
    alb.ingress.kubernetes.io/healthy-threshold-count: "2"
    alb.ingress.kubernetes.io/unhealthy-threshold-count: "3"
    alb.ingress.kubernetes.io/success-codes: "200"
```

---

## 5. Grafana System Health Dashboard

A pre-provisioned Grafana dashboard is located at:
`grafana/provisioning/dashboards/system-health-dashboard.json`

### Key Panels Configured:
1. **Database Connection Pool Gauge**: Visualizes active vs idle pool connections against warning thresholds (30 warn, 45 red).
2. **Database Waiting Queries**: Flags connection pool saturation and query backlogs.
3. **HTTP Request Latency (p50, p95, p99)**: Live latency histograms derived from Prometheus bucket metrics.
4. **Active BullMQ Queue Depths**: Live monitoring of waiting and active jobs across all background queues (`webhooks`, `notifications`, `exports`, `evidence-verification`, `trust-score-recalculation`, `data-retention-cleanup`, `data-archival`).
5. **Error Rates by Type**: Real-time breakdown of validation, database, and external API error spikes.
