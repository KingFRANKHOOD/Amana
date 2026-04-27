# Backend Hardening: Event Outbox, Upload Verification, IPFS Egress Control, and PII Retention

## Overview

This PR implements four backend security and reliability hardening issues for the Amana platform:

- **Issue #236**: Resilient chain event outbox with retry/backoff and dead-letter handling
- **Issue #419**: Evidence upload verification with MIME sniffing and pluggable malware scanner hooks
- **Issue #427**: IPFS egress hardening with allowlist, timeouts, and circuit breakers
- **Issue #431**: PII minimization and retention window enforcement with metadata redaction

All changes maintain backward compatibility, include comprehensive tests, and are thoroughly documented.

---

## Issue #236: Resilient Chain Event Outbox

### Problem
Event processing was vulnerable to handler failures without retry semantics, risking lost state transitions and transaction inconsistencies.

### Solution
- **ChainEventOutbox schema**: Persistent per-event state tracking (`PENDING`, `RETRYING`, `PROCESSED`, `DEAD_LETTER`)
- **Exponential backoff**: Failed events are automatically re-scheduled with configurable backoff bounds
- **Dead-letter handling**: Events exceeding max attempts are moved to dead-letter for manual investigation
- **Exactly-once semantics preserved**: ProcessedEvent write remains in the same transaction as event handling

### Configuration
- `EVENT_OUTBOX_MAX_ATTEMPTS` (default: 5)
- `BACKOFF_INITIAL_MS` (default: 1000)
- `BACKOFF_MAX_MS` (default: 30000)

### Files Changed
- `backend/prisma/schema.prisma` + migration
- `backend/src/config/eventListener.config.ts`
- `backend/src/services/eventListener.service.ts`
- `backend/src/__tests__/eventListener.outbox.test.ts` (new)
- `docs/backend.md`

### Tests
- 39 eventListener tests covering outbox state, retry semantics, and backoff behavior all pass

---

## Issue #419: Evidence Upload Verification

### Problem
Upload validation was weak: only mime-type checking without byte-level validation, no integration point for malware scanning.

### Solution
- **MIME sniffing**: Byte-level magic header validation (MP4 `ftyp` marker, WebM `0x1A45DFA3`)
- **Malware scanner hook**: Pluggable `EvidenceScanner` interface with optional/required failure modes
- **Configurable limits**: Evidence size limits controllable via environment without code changes
- **Fail-safe modes**: Scanner unavailability is fail-open by default, fail-closed when required

### Configuration
- `EVIDENCE_MAX_BYTES` (default: 52428800)
- `EVIDENCE_SCAN_REQUIRED` (default: false)

### Files Changed
- `backend/src/services/evidence.service.ts`
- `backend/src/routes/evidence.routes.ts`
- `backend/src/__tests__/evidence.service.test.ts` (new tests: mime spoofing, scanner flags, scanner unavailable scenarios)
- `docs/backend.md`

### Tests
- 13 evidence service tests covering mime sniffing, scanner hook behavior, and spoofing prevention all pass

---

## Issue #427: IPFS Egress Hardening

### Problem
IPFS streaming and uploads lacked timeout enforcement, no gateway validation, and no protection against upstream failures.

### Solution
- **Streaming timeouts**: Configurable per-request timeout for IPFS gateway calls
- **Gateway allowlist**: Optional hostname allowlist for outbound IPFS gateway URLs
- **Circuit breakers**: Per-gateway in-process circuit state prevents cascade during upstream outages
- **Automatic fallback**: Failed gateways are skipped; service tries alternates before giving up
- **Upload protection**: Pinata upload timeout and circuit breaker to protect backend stability

### Configuration
- `IPFS_STREAM_TIMEOUT_MS` (default: 5000)
- `IPFS_GATEWAY_ALLOWLIST` (comma-separated hostnames, optional)
- `IPFS_GATEWAY_CIRCUIT_FAILURE_THRESHOLD` (default: 3)
- `IPFS_GATEWAY_CIRCUIT_COOLDOWN_MS` (default: 30000)
- `IPFS_UPLOAD_TIMEOUT_MS` (default: 10000)
- `IPFS_PINATA_CIRCUIT_FAILURE_THRESHOLD` (default: 3)
- `IPFS_PINATA_CIRCUIT_COOLDOWN_MS` (default: 30000)

### Files Changed
- `backend/src/services/evidence.service.ts` (gateway resolution + circuit logic)
- `backend/src/services/ipfs.service.ts` (upload timeout + circuit logic)
- `backend/src/__tests__/streaming.service.test.ts` (new tests: allowlist, circuit fallback)
- `backend/src/__tests__/ipfs.service.test.ts` (new tests: upload timeout, circuit)
- `docs/backend.md`

### Tests
- 17 IPFS/streaming tests covering timeouts, allowlist enforcement, and circuit behavior all pass

---

## Issue #431: PII Minimization and Retention

### Problem
Sensitive manifest and evidence metadata was permanently retained with full access; audit history exposed raw vehicle registrations and evidence details to all parties.

### Solution
- **Manifest retention**: Seller raw PII (driver name, ID) redacted after configurable retention window
- **Evidence metadata retention**: Evidence CID, filename redacted after retention window; uploads actor field redacted for non-admin access
- **Admin-safe access**: Explicit admin role support for mediator review without data loss
- **Audit minimization**: Vehicle registration masked for non-admin callers; evidence metadata minimized with retention status flag

### Configuration
- `MANIFEST_PII_RETENTION_DAYS` (default: 30)
- `EVIDENCE_METADATA_RETENTION_DAYS` (default: 90)
- `ADMIN_STELLAR_PUBKEYS` (comma-separated admin wallet addresses)

### Files Changed
- `backend/src/services/manifest.service.ts` (retention windows, redaction rules)
- `backend/src/services/auditTrail.service.ts` (admin access, metadata minimization)
- `backend/src/services/evidence.service.ts` (retention windows, admin bypass)
- `backend/src/__tests__/manifest.service.test.ts` (new test: retention redaction)
- `backend/src/__tests__/auditTrail.service.test.ts` (new tests: admin access, metadata redaction)
- `backend/src/__tests__/evidence.service.test.ts` (new tests: admin access, retention redaction)
- `docs/backend.md`

### Tests
- 38 manifest/audit/evidence tests covering admin access, retention enforcement, and metadata redaction all pass

---

## Testing & Validation

### Focused Test Suites (All Passing)
```bash
npm test -- --runInBand src/__tests__/eventListener.test.ts
npm test -- --runInBand src/__tests__/eventListener.outbox.test.ts
npm test -- --runInBand src/__tests__/evidence.service.test.ts
npm test -- --runInBand src/__tests__/streaming.service.test.ts
npm test -- --runInBand src/__tests__/ipfs.service.test.ts
npm test -- --runInBand src/__tests__/manifest.service.test.ts
npm test -- --runInBand src/__tests__/auditTrail.service.test.ts
```

### Build
```bash
npm run build  # TypeScript compilation succeeds with no errors
```

### Git Commits
1. `backend: add resilient chain event outbox with retry and dead-letter`
2. `backend: harden evidence upload with mime sniffing and scan hooks`
3. `backend: add IPFS egress allowlist, timeouts, and circuit breakers`
4. `backend: enforce PII retention windows and metadata redaction`

---

## Migration Strategy

**No breaking changes**: All features are additive or opt-in via configuration.

- Event outbox is transparent to existing code but provides durability guarantees
- Evidence scanner is optional (defaults to no-op)
- IPFS circuit breakers are transparent backpressure management
- PII retention is enforced at read time (no data deletion)
- Admin access is explicit via `ADMIN_STELLAR_PUBKEYS` list

---

## Documentation Updates

All features are documented in `docs/backend.md` with:
- Feature descriptions and design rationale
- Configuration option reference with defaults
- Example usage patterns
- Troubleshooting guidance for operators

---

## Environment Variables Summary

| Variable | Default | Purpose |
|----------|---------|---------|
| `EVENT_OUTBOX_MAX_ATTEMPTS` | 5 | Max event processing attempts |
| `BACKOFF_INITIAL_MS` | 1000 | Event retry backoff initial delay |
| `BACKOFF_MAX_MS` | 30000 | Event retry backoff max delay |
| `EVIDENCE_MAX_BYTES` | 52428800 | Max evidence upload size |
| `EVIDENCE_SCAN_REQUIRED` | false | Fail-closed when scanner unavailable |
| `IPFS_STREAM_TIMEOUT_MS` | 5000 | Gateway stream timeout |
| `IPFS_GATEWAY_ALLOWLIST` | (none) | Comma-separated allowed gateway hostnames |
| `IPFS_GATEWAY_CIRCUIT_FAILURE_THRESHOLD` | 3 | Failures before circuit opens |
| `IPFS_GATEWAY_CIRCUIT_COOLDOWN_MS` | 30000 | Circuit open duration |
| `IPFS_UPLOAD_TIMEOUT_MS` | 10000 | Pinata upload timeout |
| `IPFS_PINATA_CIRCUIT_FAILURE_THRESHOLD` | 3 | Upload failures before circuit |
| `IPFS_PINATA_CIRCUIT_COOLDOWN_MS` | 30000 | Upload circuit duration |
| `MANIFEST_PII_RETENTION_DAYS` | 30 | Manifest seller PII retention |
| `EVIDENCE_METADATA_RETENTION_DAYS` | 90 | Evidence metadata retention |
| `ADMIN_STELLAR_PUBKEYS` | (none) | Comma-separated admin wallet addresses |

---

## Review Checklist

- [x] All four issues have isolated implementation commits
- [x] Focused test suites for each issue pass
- [x] TypeScript compilation succeeds
- [x] Backward compatibility maintained
- [x] Configuration driven via environment variables
- [x] Comprehensive documentation in `docs/backend.md`
- [x] Error handling covers service unavailability scenarios
- [x] No hardcoded credentials or secrets

---

## Branch Information

**Branch**: `backend-hardening-outbox-ipfs-pii`
**Base**: `main`
**Commits**: 4 (one per issue)
**Total Changes**: ~800 lines code + tests + docs
