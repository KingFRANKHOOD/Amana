#!/usr/bin/env bash
# Runs all security scanners and generates a report in $REPORT_DIR (default: security-reports/).
# Exit code: 0 = clean, 1 = vulnerabilities found.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR="${REPORT_DIR:-$REPO_ROOT/security-reports}"
mkdir -p "$REPORT_DIR"

FAILED=0

echo "=== Amana Security Scan ===" | tee "$REPORT_DIR/summary.txt"
date | tee -a "$REPORT_DIR/summary.txt"
echo "" | tee -a "$REPORT_DIR/summary.txt"

run_step() {
  local label="$1"; shift
  echo "--- $label ---"
  if "$@" 2>&1 | tee "$REPORT_DIR/${label// /-}.txt"; then
    echo "PASS: $label" | tee -a "$REPORT_DIR/summary.txt"
  else
    echo "FAIL: $label" | tee -a "$REPORT_DIR/summary.txt"
    FAILED=1
  fi
  echo ""
}

# npm audit — frontend
run_step "frontend npm audit" \
  sh -c "cd '$REPO_ROOT/frontend' && npm audit --audit-level=high"

# npm audit — backend
run_step "backend npm audit" \
  sh -c "cd '$REPO_ROOT/backend' && npm audit --audit-level=high"

# cargo audit — contracts
if command -v cargo-audit &>/dev/null || cargo audit --version &>/dev/null 2>&1; then
  run_step "contracts cargo audit" \
    sh -c "cd '$REPO_ROOT/contracts' && cargo audit"
else
  echo "SKIP: cargo-audit not installed (run: cargo install cargo-audit)" | tee -a "$REPORT_DIR/summary.txt"
fi

# Trivy filesystem scan (optional — only if trivy is installed)
if command -v trivy &>/dev/null; then
  run_step "trivy filesystem scan" \
    trivy fs --exit-code 1 --severity HIGH,CRITICAL "$REPO_ROOT"
else
  echo "SKIP: trivy not installed (https://aquasecurity.github.io/trivy/)" | tee -a "$REPORT_DIR/summary.txt"
fi

# Trivy Docker image scan (optional — only if images are built)
if command -v trivy &>/dev/null && command -v docker &>/dev/null; then
  for image in $(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E '^amana' || true); do
    run_step "trivy image $image" \
      trivy image --exit-code 1 --severity HIGH,CRITICAL "$image"
  done
fi

echo ""
echo "Reports written to: $REPORT_DIR"

if [ "$FAILED" -eq 1 ]; then
  echo "Security scan FAILED — critical or high-severity vulnerabilities found."
  exit 1
fi

echo "Security scan PASSED."
