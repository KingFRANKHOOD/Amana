# Runbook: PostgreSQL Connection Pool Exhaustion

**Issue:** #1093  
**Severity:** High  
**Last Updated:** 2026-08-30

---

## Symptoms

- Application becomes unresponsive under load
- Health check returns `status: "degraded"` or `"unhealthy"` with pool saturation warning
- Alert `pg_pool_saturation` fires via webhook
- Logs show `Connection pool error` or `Slow query` messages
- HTTP 503 responses increase for write endpoints
- Queries waiting for connection > 0 in `/health/aggregate` response

## Detection

### Health Check Endpoint

```bash
curl -s http://localhost:4000/health/aggregate | jq '.details.connectionPool'
```

Response when saturated:
```json
{
  "activeConnections": 14,
  "idleConnections": 1,
  "waitingQueries": 3,
  "utilizationPercent": 93,
  "status": "critical",
  "message": "Pool saturation alert: 14/15 connections in use (93% >= 80% threshold)"
}
```

### Prometheus Metrics

| Metric | Description |
|---|---|
| `pg_pool_active_connections` | Active connections in pool |
| `pg_pool_idle_connections` | Idle connections in pool |
| `pg_pool_waiting_queries` | Queries waiting for a connection |
| `pg_pool_timeout_total` | Total connection timeout events |

### Alert Types

- `pg_pool_saturation` — Fires when active connections exceed 80% of pool limit for sustained period
- `db_connection_failure` — Fires when database is unreachable

## Immediate Response

### 1. Identify the Bottleneck

```bash
# Check active queries
psql $DATABASE_URL -c "
  SELECT pid, state, query, query_start, now() - query_start AS duration
  FROM pg_stat_activity
  WHERE datname = current_database()
  ORDER BY duration DESC
  LIMIT 20;
"

# Check waiting queries
psql $DATABASE_URL -c "
  SELECT pid, wait_event_type, wait_event, query
  FROM pg_stat_activity
  WHERE wait_event IS NOT NULL
    AND datname = current_database();
"
```

### 2. Kill Long-Running Queries (Emergency)

```sql
-- Kill queries running longer than 30 seconds
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'active'
  AND now() - query_start > interval '30 seconds'
  AND datname = current_database();
```

### 3. Kill Idle-in-Transaction Sessions

```sql
-- Kill sessions idle in transaction for > 5 minutes
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND now() - state_change > interval '5 minutes'
  AND datname = current_database();
```

## Root Cause Investigation

### Common Causes

1. **Connection leak**: Test file or service opens connections without cleanup
2. **Slow queries**: Large table scans, missing indexes, N+1 query patterns
3. **Transaction timeout**: Long-running transactions holding connections
4. **Pool size misconfiguration**: Pool too small for concurrent load
5. **PgBouncer misconfiguration**: Pool mode or limits misconfigured

### Investigation Steps

```bash
# 1. Check pool configuration
echo "Pool size: $DATABASE_POOL_SIZE (default: 15)"
echo "Pool timeout: $DATABASE_POOL_TIMEOUT (default: 10s)"

# 2. Check connection count
psql $DATABASE_URL -c "
  SELECT count(*) as total,
         state,
         COUNT(*) FILTER (WHERE state = 'active') as active,
         COUNT(*) FILTER (WHERE state = 'idle') as idle,
         COUNT(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction
  FROM pg_stat_activity
  WHERE datname = current_database()
  GROUP BY state;
"

# 3. Check for lock contention
psql $DATABASE_URL -c "
  SELECT blocked.pid AS blocked_pid,
         blocked.query AS blocked_query,
         blocking.pid AS blocking_pid,
         blocking.query AS blocking_query
  FROM pg_stat_activity blocked
  JOIN pg_locks blocked_locks ON blocked.pid = blocked_locks.pid
  JOIN pg_locks blocking_locks ON blocked_locks.locktype = blocking_locks.locktype
    AND blocked_locks.relation = blocking_locks.relation
    AND blocked_locks.pid != blocking_locks.pid
  JOIN pg_stat_activity blocking ON blocking_locks.pid = blocking.pid
  WHERE NOT blocked_locks.granted;
"
```

## Remediation

### Increase Pool Size (Temporary)

If the issue is genuine concurrency and not a leak:

```bash
# Update environment variable
DATABASE_POOL_SIZE=25  # was 15

# If using PgBouncer, also increase:
PGBOUNCER_DEFAULT_POOL_SIZE=25
```

### Fix Connection Leaks

1. Check `backend/src/__tests__/` for tests that don't clean up Prisma connections
2. Verify `afterAll` hooks in test files call `prisma.$disconnect()`
3. Check `backend/src/__tests__/cleanup.ts` is in `setupFilesAfterEnv`

### Add Missing Indexes

```sql
-- Check for sequential scans on large tables
SELECT relname, seq_scan, idx_scan,
       CASE WHEN seq_scan > 0 THEN 'MISSING INDEX' ELSE 'OK' END as status
FROM pg_stat_user_tables
WHERE seq_scan > 1000
ORDER BY seq_scan DESC;
```

### Optimize Slow Queries

```sql
-- Find slow queries
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

## Prevention

### Monitoring

- Pool utilization alert at 80% threshold (`POOL_SATURATION_WARN_THRESHOLD`)
- Connection acquisition time logging for queries > 1s
- Health check includes pool status in `/health/aggregate`

### Configuration

| Variable | Recommended Value | Description |
|---|---|---|
| `DATABASE_POOL_SIZE` | 15-25 | Max connections per Prisma instance |
| `DATABASE_POOL_TIMEOUT` | 10 | Seconds to wait for connection |
| `DATABASE_MAX_OVERFLOW` | 5 | Extra connections beyond pool size |
| `POOL_SATURATION_WARN_THRESHOLD` | 80 | Percent that triggers alert |
| `PGBOUNCER_DEFAULT_POOL_SIZE` | 15-25 | PgBouncer server connections per DB |
| `PGBOUNCER_POOL_MODE` | transaction | Recommended pooling mode |

### Testing

- Run `--detectOpenHandles` in CI to catch connection leaks
- Use `scripts/test-up.sh` for ephemeral test databases
- Monitor pool metrics in load tests (`k6/load-test.js`)

## Escalation

If pool exhaustion persists after remediation:

1. Check PgBouncer logs for connection recycling issues
2. Review Aurora PostgreSQL `max_connections` parameter (default 100)
3. Consider read replicas to distribute read traffic
4. Evaluate connection pooling at the infrastructure level (Supabase pooler)

## References

- [Prisma Connection Management](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections)
- [PostgreSQL pg_stat_activity](https://www.postgresql.org/docs/current/monitoring-stats.html#PG-STAT-ACTIVITY-VIEW)
- [PgBouncer Pool Modes](https://www.pgbouncer.org/config.html#pool-mode)
- [Issue #988: Connection Pool Tuning](https://github.com/KingFRANKHOOD/Amana/issues/988)
