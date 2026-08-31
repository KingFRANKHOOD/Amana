# NetworkPolicy Testing Guide

## Overview

This guide provides comprehensive testing procedures to validate that the NetworkPolicy configuration in `/workspaces/Amana/infra/k8s/network-policies.yaml` is working correctly and enforcing the intended security controls.

## Prerequisites

- kubectl configured to access the Kubernetes cluster
- Network policy support enabled in the cluster (usually enabled by default)
- Network debugging tools: `netcat` (nc), `curl`, or `wget` inside pods
- Optional: tcpdump or Cilium CLI for advanced diagnostics

## Policy Structure

The NetworkPolicy manifests enforce:
1. **Default Deny All**: All ingress traffic is blocked by default
2. **Explicit Allow List**: Only explicitly allowed traffic is permitted
3. **Egress Filtering**: Controlled egress for external service communication
4. **Pod-to-Pod Communication**: Allowed only between specific service pairs

## Testing Scenarios

### 1. Test Default Deny-All Policy

**Objective**: Verify that pods cannot communicate by default.

**Test Method**:
```bash
# Get a pod name
BACKEND_POD=$(kubectl get pods -l app=backend -o jsonpath='{.items[0].metadata.name}')
REDIS_POD=$(kubectl get pods -l app=redis -o jsonpath='{.items[0].metadata.name}')

# Try to connect from backend to redis (should succeed - allowed policy)
kubectl exec -it $BACKEND_POD -- redis-cli -h redis-service -p 6379 ping

# Try to connect from frontend to redis (should fail - no policy)
FRONTEND_POD=$(kubectl get pods -l app=frontend -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it $FRONTEND_POD -- nc -zv redis-service 6379
# Expected: Connection refused or timeout (2-5 seconds)
```

### 2. Test Ingress from Ingress-Nginx Controller

**Objective**: Verify that frontend and backend services can receive traffic from the ingress controller.

**Test Method**:
```bash
# Check if ingress-nginx pods can reach frontend
NGINX_POD=$(kubectl get pods -n ingress-nginx -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it -n ingress-nginx $NGINX_POD -- \
  curl -s http://frontend-service:3000 | head -20

# Check if ingress-nginx pods can reach backend API
kubectl exec -it -n ingress-nginx $NGINX_POD -- \
  curl -s http://backend-service:4000/health
```

### 3. Test Backend to PostgreSQL Access

**Objective**: Verify backend pods can access the PostgreSQL database.

**Test Method**:
```bash
# Get backend pod
BACKEND_POD=$(kubectl get pods -l app=backend -o jsonpath='{.items[0].metadata.name}')

# Test connection to PostgreSQL
kubectl exec -it $BACKEND_POD -- \
  psql -h postgres-service -U postgres -d amana -c "SELECT version();"

# Alternative: Test with connection string
kubectl exec -it $BACKEND_POD -- \
  pg_isready -h postgres-service -p 5432 -U postgres
```

### 4. Test Backend to Redis Access

**Objective**: Verify backend pods can access Redis.

**Test Method**:
```bash
# Get backend pod
BACKEND_POD=$(kubectl get pods -l app=backend -o jsonpath='{.items[0].metadata.name}')

# Test Redis connectivity
kubectl exec -it $BACKEND_POD -- redis-cli -h redis-service -a $REDIS_PASSWORD ping

# Test Redis operations
kubectl exec -it $BACKEND_POD -- \
  redis-cli -h redis-service -a $REDIS_PASSWORD SET test-key "hello"
```

### 5. Test Frontend Cannot Access PostgreSQL or Redis

**Objective**: Verify that frontend pods are blocked from accessing backend services.

**Test Method**:
```bash
# Get frontend pod
FRONTEND_POD=$(kubectl get pods -l app=frontend -o jsonpath='{.items[0].metadata.name}')

# Attempt to access PostgreSQL (should fail)
kubectl exec -it $FRONTEND_POD -- nc -zv postgres-service 5432 &
sleep 3
pkill -P $$ nc
# Expected: Connection refused or timeout after ~3 seconds

# Attempt to access Redis (should fail)
kubectl exec -it $FRONTEND_POD -- nc -zv redis-service 6379 &
sleep 3
pkill -P $$ nc
# Expected: Connection refused or timeout after ~3 seconds
```

### 6. Test Cronjob to PostgreSQL Access

**Objective**: Verify backup cronjobs can access PostgreSQL.

**Test Method**:
```bash
# Get backup cronjob pod
BACKUP_POD=$(kubectl get pods -l job-name=backup-cronjob -o jsonpath='{.items[0].metadata.name}')

# Test connection
kubectl exec -it $BACKUP_POD -- \
  pg_isready -h postgres-service -p 5432 -U postgres

# Test backup execution (if a backup is running)
kubectl exec -it $BACKUP_POD -- \
  pg_dump -h postgres-service -U postgres -d amana --verbose 2>&1 | head -20
```

### 7. Test DNS Egress

**Objective**: Verify pods can resolve DNS names.

**Test Method**:
```bash
# Test DNS from backend
BACKEND_POD=$(kubectl get pods -l app=backend -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it $BACKEND_POD -- nslookup kubernetes.default
kubectl exec -it $BACKEND_POD -- nslookup api.amanavault.com

# Test DNS from frontend
FRONTEND_POD=$(kubectl get pods -l app=frontend -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it $FRONTEND_POD -- nslookup kubernetes.default
```

### 8. Test External Service Access (Backend Egress)

**Objective**: Verify backend can access external services.

**Test Method**:
```bash
# Test external HTTPS access from backend
BACKEND_POD=$(kubectl get pods -l app=backend -o jsonpath='{.items[0].metadata.name}')

# Test connectivity to Stellar testnet
kubectl exec -it $BACKEND_POD -- curl -s -I https://horizon-testnet.stellar.org/ | head -5

# Test connectivity to IPFS (if using Pinata)
kubectl exec -it $BACKEND_POD -- curl -s -I https://gateway.pinata.cloud/ | head -5

# Test connectivity to Supabase
kubectl exec -it $BACKEND_POD -- curl -s -I https://supabase.co/ | head -5
```

### 9. Test Metadata Service Blocking

**Objective**: Verify pods cannot access AWS metadata service (security hardening).

**Test Method**:
```bash
# Attempt to access AWS metadata service (should fail)
BACKEND_POD=$(kubectl get pods -l app=backend -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it $BACKEND_POD -- curl -v http://169.254.169.254/latest/meta-data/ 2>&1 | head -20
# Expected: Connection timeout or refused (not reaching metadata service)
```

### 10. Test Pod-to-Pod Internal Communication

**Objective**: Verify only allowed pod-to-pod communication works.

**Test Method**:
```bash
# Backend to backend (should work - same app label)
BACKEND_POD_1=$(kubectl get pods -l app=backend -o jsonpath='{.items[0].metadata.name}')
BACKEND_POD_2=$(kubectl get pods -l app=backend -o jsonpath='{.items[1].metadata.name}')
kubectl exec -it $BACKEND_POD_1 -- nc -zv $BACKEND_POD_2 4000
# Expected: Success or connection refused (both acceptable, depending on app logic)

# Frontend to frontend (should work - same app label)
FRONTEND_POD_1=$(kubectl get pods -l app=frontend -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it $FRONTEND_POD_1 -- nc -zv frontend-service 3000
# Expected: Success (connection to service)
```

## Automated Testing Script

Create a test script `/workspaces/Amana/tests/network-policy-test.sh`:

```bash
#!/bin/bash
set -e

echo "=== NetworkPolicy Enforcement Tests ==="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

test_passed() {
  echo -e "${GREEN}✓ PASS${NC}: $1"
}

test_failed() {
  echo -e "${RED}✗ FAIL${NC}: $1"
  exit 1
}

test_warning() {
  echo -e "${YELLOW}⚠ WARNING${NC}: $1"
}

# Get pod names
BACKEND_POD=$(kubectl get pods -l app=backend -o jsonpath='{.items[0].metadata.name}')
FRONTEND_POD=$(kubectl get pods -l app=frontend -o jsonpath='{.items[0].metadata.name}')
REDIS_POD=$(kubectl get pods -l app=redis -o jsonpath='{.items[0].metadata.name}')
POSTGRES_POD=$(kubectl get pods -l app=postgres -o jsonpath='{.items[0].metadata.name}')

echo "Backend Pod: $BACKEND_POD"
echo "Frontend Pod: $FRONTEND_POD"
echo "Redis Pod: $REDIS_POD"
echo "PostgreSQL Pod: $POSTGRES_POD"
echo ""

# Test 1: Backend can reach Redis
echo "Test 1: Backend to Redis..."
if kubectl exec -it $BACKEND_POD -- redis-cli -h redis-service -p 6379 ping &>/dev/null; then
  test_passed "Backend can reach Redis"
else
  test_failed "Backend cannot reach Redis (should be allowed)"
fi

# Test 2: Frontend cannot reach Redis (should timeout)
echo "Test 2: Frontend to Redis (should fail)..."
TIMEOUT=3
if timeout $TIMEOUT kubectl exec -it $FRONTEND_POD -- nc -zv redis-service 6379 &>/dev/null; then
  test_failed "Frontend can reach Redis (should be blocked)"
else
  test_passed "Frontend blocked from Redis"
fi

# Test 3: Backend can reach PostgreSQL
echo "Test 3: Backend to PostgreSQL..."
if kubectl exec -it $BACKEND_POD -- pg_isready -h postgres-service &>/dev/null; then
  test_passed "Backend can reach PostgreSQL"
else
  test_failed "Backend cannot reach PostgreSQL (should be allowed)"
fi

# Test 4: Frontend cannot reach PostgreSQL
echo "Test 4: Frontend to PostgreSQL (should fail)..."
if timeout $TIMEOUT kubectl exec -it $FRONTEND_POD -- nc -zv postgres-service 5432 &>/dev/null; then
  test_failed "Frontend can reach PostgreSQL (should be blocked)"
else
  test_passed "Frontend blocked from PostgreSQL"
fi

# Test 5: Backend can access external services
echo "Test 5: Backend external HTTPS access..."
if kubectl exec -it $BACKEND_POD -- curl -s -I --max-time 5 https://horizon-testnet.stellar.org/ | grep -q "HTTP"; then
  test_passed "Backend can access external services"
else
  test_warning "Backend external access test inconclusive (network may be restricted)"
fi

# Test 6: DNS is working
echo "Test 6: DNS resolution..."
if kubectl exec -it $BACKEND_POD -- nslookup kubernetes.default &>/dev/null; then
  test_passed "DNS resolution working"
else
  test_failed "DNS resolution not working"
fi

echo ""
echo "=== All Tests Completed ==="
```

## Viewing NetworkPolicy Status

**Check applied policies**:
```bash
# List all network policies
kubectl get networkpolicies

# Describe a specific policy
kubectl describe networkpolicy allow-backend-to-redis

# Get detailed YAML
kubectl get networkpolicy allow-backend-to-redis -o yaml
```

## Debugging Failed Tests

### Enable Policy Logging

Some CNI plugins (Cilium, etc.) support policy logging:

```bash
# For Cilium, enable debug logging
kubectl set env ds/cilium -n kube-system DEBUG=true

# View Cilium policy logs
kubectl logs -n kube-system -l k8s-app=cilium -f | grep -i policy
```

### Check CNI Plugin

```bash
# Verify the CNI plugin in use
kubectl get pods -n kube-system | grep -i cni

# Check if NetworkPolicy is supported
kubectl api-resources | grep NetworkPolicy
```

### Verify Pod Labels

Ensure pods have the correct labels for policy matching:

```bash
# Check backend pod labels
kubectl get pod $BACKEND_POD --show-labels

# Add label if missing
kubectl label pod $BACKEND_POD app=backend --overwrite
```

## Common Issues and Solutions

### Issue: All tests fail - policies not enforcing

**Solution**:
1. Verify the CNI plugin supports NetworkPolicy
2. Check that `network-policies.yaml` is applied: `kubectl apply -f infra/k8s/network-policies.yaml`
3. Verify policies exist: `kubectl get networkpolicies`

### Issue: Frontend can still access Redis

**Solution**:
1. Check frontend pod labels: `kubectl get pod $FRONTEND_POD --show-labels`
2. Verify "allow-backend-to-redis" policy exists
3. Check for conflicting allow-all policies: `kubectl get networkpolicy -o yaml | grep -A5 -B5 "podSelector: {}"`

### Issue: Backend cannot access external services

**Solution**:
1. Check "allow-backend-external-egress" policy exists
2. Verify IP blocks in egress rules are correct
3. Test without IP block restriction first (remove CIDR except clauses temporarily)
4. Check firewall/security group rules

## Post-Deployment Validation

After applying the policies in staging/production:

1. **Monitor application logs** for connection errors
2. **Check backend health check endpoint** is accessible
3. **Verify trades complete successfully** (end-to-end test)
4. **Monitor Redis connection pool** for issues
5. **Monitor database connections** for issues
6. **Check external service integration** (IPFS, Stellar, Supabase)

## References

- [Kubernetes NetworkPolicy Documentation](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
- [Cilium Network Policy](https://docs.cilium.io/en/stable/policy/language/)
- [Best Practices for Network Policies](https://kubernetes.io/docs/tasks/administer-cluster/network-policy-multi-tool/)
