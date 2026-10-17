# Amana Incident Response Playbook & Runbook

Severity levels, operational response steps, critical failure scenarios, escalation matrices, communication templates, and quarterly drill procedures for production incidents.

Uses the same P0–P3 severity conventions as [threat-model.md](../threat-model.md).

---

## 1. Severity Levels & Response SLAs

| Severity | Definition | Examples | Acknowledgment SLA | Mitigation Target |
|---|---|---|---|---|
| **P0 - Critical** | Direct loss of funds, active exploit, or total service outage for all users. | Treasury/escrow contract drained; database corrupted/unreachable; admin key compromise ([threat-model.md](../threat-model.md) TH-P-02); backend completely offline. | **< 5 minutes** (Page on-call & eng leads) | **< 30 minutes** |
| **P1 - High** | Core transaction flow broken for significant subset of users; no direct fund loss yet. | Trade creation/deposit/release failing; authentication down for key wallet providers; database replication lag > 60s; production migration failure. | **< 15 minutes** (Page on-call) | **< 2 hours** |
| **P2 - Medium** | Degraded performance or non-core subsystem broken; workarounds available. | Evidence upload failing; audit history export broken; elevated latency (p99 > 1500ms); feature flag misbehaving; background worker queue backlog. | **< 1 hour** (Business hours) | **< 8 hours** |
| **P3 - Low** | Minor cosmetic issue, documentation drift, or edge-case bug with negligible impact. | API doc typo; non-blocking warning log spam; admin dashboard filtering glitch. | **< 24 hours** | Next sprint |

> [!IMPORTANT]
> **Triage Rule**: When in doubt, classify one severity level higher and downgrade after triage. It is always safer and cheaper to stand down a P0 than to recover from an uncontained P1.

---

## 2. Incident Command System (ICS) Roles & Escalation Matrix

During a P0/P1 incident, clear role separation prevents duplicated efforts and communication bottlenecks:

### 2.1 ICS Roles & Responsibilities

1. **Incident Commander (IC)**:
   - Owns overall incident response, timeline logging, and coordination.
   - Coordinates technical resources and makes final mitigation/rollback decisions.
   - Maintains the official incident channel (`#incident-YYYYMMDD-title`).
2. **Technical Lead (TL)**:
   - Directs diagnostic and remediation efforts.
   - Proposes technical fixes, rollbacks, or hotfixes to the IC.
   - Coordinates database, smart contract, and backend infrastructure engineers.
3. **Communications Lead (CL)**:
   - Drafts internal updates, customer notifications, and status page announcements.
   - Insulates technical responders from external queries.
4. **Security / Compliance Officer (SO)**:
   - Assesses breach scope, data exfiltration, or PII compromise.
   - Initiates regulatory reporting (e.g. GDPR 72h notification) and forensic preservation.

### 2.2 Escalation Matrix & Authority Tree

```
                                  ┌────────────────────────┐
                                  │   Alert Triggered /    │
                                  │   Incident Reported    │
                                  └───────────┬────────────┘
                                              │
                                              ▼
                                 ┌───────────────────────────┐
                                 │   Primary On-Call Eng     │
                                 │   (Ack within 5-15 min)   │
                                 └────────────┬──────────────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      │ No Ack / Complex Incident (>15 min)           │
                      ▼                                               ▼
          ┌──────────────────────────┐                   ┌──────────────────────────┐
          │    Secondary On-Call     │                   │     Engineering Lead     │
          │    & DevOps Team Lead    │                   │   (Assumes IC role)      │
          └───────────┬──────────────┘                   └────────────┬─────────────┘
                      │                                               │
                      └───────────────────────┬───────────────────────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      ▼                                               ▼
          ┌──────────────────────────┐                   ┌──────────────────────────┐
          │ Smart Contract & Key     │                   │  Executive & Legal /     │
          │ Holders (Treasury/Admin) │                   │  Compliance Officer      │
          └──────────────────────────┘                   └──────────────────────────┘
```

### 2.3 Decision Authority Matrix

| Action | Required Approver | Emergency Bypass |
|---|---|---|
| **Toggle Feature Flag** | Primary On-Call / IC | Yes (immediate mitigation) |
| **Roll Back Backend Deployment** | IC or TL | Yes |
| **Emergency Pause Smart Contract** | Multi-sig Key Holders + Eng Lead | IC if automated drain detected |
| **Rotate Admin Stellar Pubkeys** | Admin Key Custodians + IC | IC with 2-of-3 key holders |
| **Post Public Status Page Notice** | Communications Lead or IC | Primary On-Call for confirmed P0 |
| **Notify Data Protection Authority** | Compliance Officer + General Counsel | Required within 72h under GDPR Art. 33 |

---

## 3. Immediate Response Workflow

1. **Acknowledge & Declare**:
   - Primary on-call acknowledges PagerDuty/Opsgenie alert.
   - Create incident Slack channel: `#incident-YYYYMMDD-<description>`.
   - Start timestamped timeline: Record observations, hypothesis, commands run, and output.
2. **Assess & Classify**:
   - Review `/health/aggregate`, Prometheus alerts, and Loki log streams.
   - Determine severity level (P0–P3).
3. **Mitigate Before Diagnosing**:
   - Prioritize stopping user impact or fund loss over identifying root cause.
   - **Feature Flag**: Disable problematic feature flag via Admin API (`POST /api/v1/admin/features`).
   - **Deploy Rollback**: Roll back latest container release via `kubectl rollout undo` (see [rollback.md](./rollback.md)).
   - **Contract Freeze**: For suspected escrow draining, invoke contract pause or revoke compromised admin pubkeys in `ADMIN_STELLAR_PUBKEYS`.
4. **Inspect Aggregated Health Signals**:
   ```bash
   # Quick process aliveness
   curl -s https://<api-host>/health/live

   # Runtime readiness with dependencies
   curl -s https://<api-host>/health/ready

   # Full aggregated health breakdown across all components
   curl -s https://<api-host>/health/aggregate | jq .
   ```
5. **Communicate & Update**:
   - Post initial status update within 15 minutes using templates in Section 5.
   - Update every 30 minutes for P0, every 60 minutes for P1.
6. **Resolve & Postmortem**:
   - Confirm user traffic is normal across a full cycle.
   - Execute mandatory blameless postmortem within 48 hours.

---

## 4. Critical Failure Scenarios & Playbooks

---

### Scenario 1: Database Corruption, Data Loss & Disaster Recovery

**Symptoms**: `BackupVerificationFailed` alert fires; PostgreSQL logs show WAL replay errors, relation file corruption, or database crash looping.

#### Containment & Remediation Procedure:
1. **Immediate Write Isolation**:
   - Prevent further corrupted writes: Enable database maintenance mode or set connection pool to read-only.
   ```bash
   # Scale down write workers to prevent partial write batches
   kubectl scale deployment/backend-worker --replicas=0 -n default
   ```
2. **Inspect Scratch Verification DB**:
   - `scripts/verify-backup.sh` leaves failed verification instances intact on failure.
   - Inspect specific table corruption:
   ```bash
   kubectl logs -n amana job/db-backup-verify-daily-<timestamp>
   ```
3. **Execute Point-in-Time Recovery (PITR)**:
   - Restore latest verified backup snapshot from S3 / backup volume:
   ```bash
   ./scripts/db-restore.sh --snapshot-id <latest-good-snapshot> --pitr-target "2026-08-30T12:00:00Z"
   ```
4. **Reconcile Off-Chain State Against Stellar Ledger**:
   - Run the event backfill script to replay on-chain events from the last confirmed ledger sequence:
   ```bash
   pnpm --filter backend run backfill:events --from-ledger <last-valid-ledger>
   ```
5. **Verify Database Consistency**:
   - Run constraint checks and orphaned relation scripts:
   ```bash
   ./scripts/verify-backup.sh
   ```
6. **Resume Traffic**:
   - Scale back deployment replicas and verify via `GET /health/aggregate`.

---

### Scenario 2: Smart Contract Anomalies, Escrow Invariant Violations & Stuck Funds

**Symptoms**: Invariant violation alerts (escrow balance `<` sum of active trade amounts); Soroban transaction reverts; unexpected contract balance decrease.

#### Containment & Remediation Procedure:
1. **Emergency Flow Freeze**:
   - If contract draining is suspected, multi-sig administrators invoke emergency pause or lock deposits.
   - Immediately disable trade release feature flags via admin API:
   ```bash
   curl -X POST https://<api-host>/api/v1/admin/features \
     -H "Authorization: Bearer $ADMIN_JWT" \
     -H "Content-Type: application/json" \
     -d '{"feature": "ESCROW_AUTO_RELEASE", "enabled": false}'
   ```
2. **Audit On-Chain State vs Local DB**:
   - Query Soroban contract storage balance:
   ```bash
   soroban contract invoke \
     --id $AMANA_ESCROW_CONTRACT_ID \
     --source $ADMIN_SECRET \
     --network testnet \
     -- get_contract_balance
   ```
3. **Isolate Stuck Trades**:
   - Query backend for trades in `FUNDED` or `DELIVERED` status with stalled milestone execution.
   - Extract cryptographic audit history via `GET /api/v1/trades/:id/history?signed=true` for forensic review.
4. **Deploy Contract Hotfix**:
   - If contract logic requires upgrade, follow contract upgrade protocol in [rollback.md](./rollback.md#contract-rollback).
   - Re-anchor contract state and re-enable release pipelines after verification.

---

### Scenario 3: Security Breaches, Admin Key Compromise & Unauthorized Access

**Symptoms**: Unauthorized admin API calls; unfamiliar public key added to `ADMIN_STELLAR_PUBKEYS`; Gitleaks alert on secret leakage; mass PII query detected.

#### Containment & Remediation Procedure:
1. **Immediate Credential Revocation**:
   - Rotate `ADMIN_STELLAR_PUBKEYS` immediately in Kubernetes secrets:
   ```bash
   kubectl create secret generic amana-secrets \
     --from-literal=ADMIN_STELLAR_PUBKEYS="<new-secure-pubkey>" \
     --dry-run=client -o yaml | kubectl apply -f -
   ```
2. **Invalidate All Active Sessions & JWTs**:
   - Rotate `JWT_SECRET` in production secrets.
   - Invalidate all Redis session tokens and refresh tokens:
   ```bash
   kubectl exec -it deployment/redis -- redis-cli FLUSHDB
   ```
3. **Rotate Encryption Keys**:
   - Rotate `TRADE_NOTES_ENCRYPTION_KEY` and Pinata IPFS signing credentials.
4. **Forensic Audit Log Analysis**:
   - Extract immutable financial audit logs for the breach window:
   ```bash
   curl -s "https://<api-host>/api/v1/audit-logs?dateFrom=2026-08-30T00:00:00Z" \
     -H "Authorization: Bearer $NEW_ADMIN_JWT" | jq .
   ```
5. **Initiate Regulatory & Legal Notification**:
   - If PII or customer wallet data was exposed, notify the Compliance Officer to initiate the GDPR 72-hour notification protocol (Template in Section 5.4).

---

### Scenario 4: Ransomware, Distributed Denial of Service (DDoS) & API Flooding

**Symptoms**: Spike in HTTP 429 / 503 errors; connection pool timeout alerts (`pg_pool_timeout_total` increasing); edge ingress CPU saturation.

#### Containment & Remediation Procedure:
1. **Engage Cloudflare / WAF Under Attack Mode**:
   - Enable strict managed challenge (CAPTCHA / JavaScript challenge) at Cloudflare / Ingress ALB.
2. **Tighten Rate Limiting Envelopes**:
   - Reduce per-IP and per-wallet rate limits via runtime environment variables:
   ```bash
   kubectl set env deployment/backend \
     RATE_LIMIT_USER_MAX=10 \
     RATE_LIMIT_TRADE_CREATION_MAX=5
   ```
3. **Scale Ingress & Backend Pods**:
   ```bash
   kubectl scale deployment/backend --replicas=10 -n default
   ```
4. **Isolate Backend Worker Queues**:
   - Ensure BullMQ background jobs continue processing critical settlements without starving HTTP listener threads.

---

### Scenario 5: Third-Party Dependency Outage (Stellar Horizon / IPFS / Redis)

**Symptoms**: `GET /health/aggregate` shows degraded status for `stellarRpc` or `ipfsStorage`; circuit breaker alerts fire.

#### Containment & Remediation Procedure:
1. **Stellar Horizon / RPC Outage**:
   - Switch primary RPC endpoint in ConfigMap to backup Horizon provider:
   ```bash
   kubectl patch configmap amana-config -p '{"data":{"STELLAR_RPC_URL":"https://horizon-backup.stellar.org"}}'
   kubectl rollout restart deployment/backend
   ```
2. **IPFS / Pinata Storage Degradation**:
   - Pinata circuit breaker will automatically trip to OPEN state.
   - Direct evidence viewing requests to backup IPFS gateway (`IPFS_GATEWAY_URLS`).
3. **Redis Cluster Failover**:
   - If Redis master fails, verify Sentinel or Managed Redis executes automated failover within 30s.

---

## 5. Communication Templates

### 5.1 Internal Incident Declaration & Update (Slack / Email)

**Initial Declaration (Post to `#incidents-core` within 15 min of P0/P1):**
```markdown
🚨 **INCIDENT DECLARED: [P0/P1] - [Brief Description]**
• **Severity**: P0 - Critical / P1 - High
• **Incident Commander**: @name
• **Technical Lead**: @name
• **Communications Lead**: @name
• **Impacted Systems**: [e.g. Escrow Releases / Trade Creation / Auth]
• **Symptoms Observed**: [e.g. HTTP 500 spike, Horizon timeout]
• **Immediate Actions Taken**: [e.g. Feature flag disabled, Rollback initiated]
• **Incident War Room**: #incident-20260830-escrow-lag / [Huddle Link]
• **Next Update**: Within 30 minutes (HH:MM UTC)
```

**Hourly Update Template:**
```markdown
📣 **INCIDENT UPDATE #[Number] - [Incident Title]**
• **Current Status**: Investigating / Identified / Mitigating / Monitoring
• **Timeline of Actions**:
  - 14:15 UTC: Rollback to build v1.0.4 completed.
  - 14:30 UTC: Database connection pool stabilized; error rate reduced to <0.5%.
• **Root Cause Hypothesis**: [Brief explanation]
• **Current Blocker / Next Steps**: [Immediate action items]
• **Next Update**: HH:MM UTC
```

---

### 5.2 Public Status Page Notifications

**Investigating (Initial Post):**
> **Identified Issue with Trade Processing**
> We are currently investigating an issue causing delays in trade deposits and escrow releases. Our engineering team is actively investigating the root cause. Existing funds held in smart contract escrows remain completely secure. Next update in 30 minutes.

**Mitigated / Monitoring:**
> **Mitigation Applied - Monitoring Systems**
> A fix has been deployed and transaction processing is returning to normal operation. We are monitoring system metrics and ledger sync latency to ensure full stability.

**Resolved:**
> **Service Restored - Incident Resolved**
> All trade creation, settlement, and withdrawal services are operating normally. All delayed transactions have been successfully processed. A detailed postmortem will be published within 48 hours.

---

### 5.3 Customer Direct Communication (Financial / Trade Delay Notice)

```text
Subject: Update Regarding Your Amana Escrow Transaction [Trade ID: {{tradeId}}]

Dear {{displayName}},

We are writing to inform you that between {{startTime}} and {{endTime}} UTC, our platform experienced a temporary service disruption that affected transaction release processing.

We want to reassure you that:
1. All funds deposited in your escrow account remained completely secure throughout the event on the Stellar blockchain.
2. Your transaction [{{tradeId}}] has now been fully processed / queued for release.
3. No action is required on your part.

If you have any questions or observe any discrepancies, please reach out to our dedicated support team at support@amana.com with your Trade ID.

Sincerely,
The Amana Operations Team
```

---

### 5.4 Regulatory Data Breach Disclosure Template (GDPR Article 33 Notice)

```text
FORMAL NOTIFICATION OF PERSONAL DATA BREACH
Pursuant to Article 33 of the General Data Protection Regulation (GDPR)

To: Data Protection Supervisory Authority
Date: [YYYY-MM-DD]
Organization: Amana Financial Technologies Inc.
Contact Officer: Data Protection Officer (dpo@amana.com)

1. NATURE OF THE PERSONAL DATA BREACH:
   - Date and time of incident: [YYYY-MM-DD HH:MM UTC]
   - Date and time incident was detected: [YYYY-MM-DD HH:MM UTC]
   - Nature of breach: [Confidentiality / Integrity / Availability]
   - Categories of data subjects affected: [Buyers / Sellers / Drivers]
   - Approximate number of data subjects affected: [Number]

2. CATEGORIES OF PERSONAL DATA CONCERNED:
   - [e.g. Driver names, vehicle registration numbers, delivery route descriptions]
   - Note: Financial keys and encrypted notes remained protected by AES-256-GCM / Ed25519 cryptography.

3. LIKELY CONSEQUENCES OF THE BREACH:
   - [Assessment of risk to rights and freedoms of individuals]

4. MEASURES TAKEN OR PROPOSED TO ADDRESS AND MITIGATE THE BREACH:
   - Immediate revocation of affected credentials and key rotation.
   - PII redaction and sanitization across all impacted records.
   - System patching and enhanced intrusion detection monitoring.

5. NOTIFICATION TO DATA SUBJECTS:
   - [Indicate whether data subjects have been or will be notified pursuant to Article 34]
```

---

## 6. Quarterly Incident Response Drill Program

To ensure muscle memory and operational readiness, Amana conducts mandatory quarterly incident drills.

### 6.1 Annual Drill Schedule & Scenarios

| Quarter | Drill Title | Scenario & Injects | Target MTTA | Target MTTR | Success Criteria |
|---|---|---|---|---|---|
| **Q1** | **Database Disaster Recovery & PITR** | Simulate primary database corruption; restore from S3 snapshot; verify ledger sequence reconciliation. | < 5 min | < 45 min | Zero orphaned records; `verify-backup.sh` passes 100%. |
| **Q2** | **Admin Key Compromise & Contract Emergency** | Simulate leaked admin key in public repo; execute key rotation, JWT invalidation, and multi-sig emergency freeze. | < 5 min | < 20 min | Old key successfully locked out; audit logs verified. |
| **Q3** | **Ransomware & API DDoS Flood** | Inject 50,000 req/sec synthetic flood on `/trades`; test WAF challenge, dynamic rate limiting, and pod autoscaling. | < 2 min | < 15 min | Core trade API remains available with p99 < 500ms. |
| **Q4** | **Stellar RPC & IPFS Gateway Outage** | Force primary Horizon RPC into error state; test automatic failover and circuit breaker recovery. | < 3 min | < 10 min | Event listener auto-reconnects with zero missed ledgers. |

### 6.2 Drill Execution Checklist
1. **Pre-Drill (T-7 Days)**:
   - Appoint Drill Coordinator (creates inject scripts and timetable).
   - Appoint Observers (record timestamps, communication accuracy, tool usage).
   - Confirm non-production staging environment matches production parity.
2. **Drill Execution (D-Day)**:
   - Inject simulated failure without prior notice to the on-call engineer.
   - Measure **MTTA** (Time to acknowledge page) and **MTTM** (Time to apply mitigation).
   - Follow ICS roles strictly: IC, TL, CL, and SO.
   - Execute communication templates in staging Slack channels.
3. **Post-Drill Evaluation (T+2 Days)**:
   - Score response against the Drill Evaluation Rubric (Section 6.3).
   - File remediation tickets for any identified playbook or tooling gaps.

### 6.3 Drill Evaluation Scorecard Rubric
- **Detection & Paging**: 25% (Alert fired accurately and on-call engaged within SLA)
- **Containment & Mitigation**: 35% (Quickest path to mitigate user impact selected)
- **Communication Quality**: 20% (Accurate, clear internal and external updates posted on time)
- **Recovery & Verification**: 20% (Full data integrity verified; zero unhandled errors)

---

## 7. Postmortem & Playbook Continuous Improvement

### 7.1 Blameless Postmortem Policy
A blameless postmortem is mandatory for all P0 and P1 incidents and must be published within **2 business days** of incident resolution.

### 7.2 Postmortem Template Sections
1. **Executive Summary**: 2-paragraph summary of what occurred, impact duration, and resolution.
2. **User Impact**: Total affected users, delayed volume in USDC, error rate spike percentage.
3. **Chronological Timeline**: Step-by-step timestamped log from initial trigger to resolution.
4. **Root Cause Analysis (5 Whys)**: Deep dive tracing proximate cause to systemic root cause.
5. **What Went Well / What Went Poorly / Where We Got Lucky**.
6. **Action Items & Preventative Measures**: Specific Jira/GitHub issues with assigned owners and SLA deadlines (P0 action items due within 14 days).

### 7.3 Mandatory Playbook Revision Trigger
Every postmortem action item that identifies a procedural or runbook gap **must** include an immediate PR updating this Incident Response Playbook (`docs/runbooks/incident-response.md`).
