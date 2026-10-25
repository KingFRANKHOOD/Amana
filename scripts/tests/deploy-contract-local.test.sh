#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/scripts/lib/contract-id.sh"

expected_id="C$(printf 'A%.0s' {1..55})"
stderr_file="$(mktemp)"
trap 'rm -f "$stderr_file"' EXIT

soroban() {
  printf '%s\n' "$expected_id"
  printf '%s\n' "warning: deployment diagnostic" >&2
}

deploy_output=$(soroban contract deploy 2>"$stderr_file")
actual_id=$(extract_contract_id "$deploy_output")

[[ "$actual_id" == "$expected_id" ]]
grep -q "warning: deployment diagnostic" "$stderr_file"

if extract_contract_id "no contract ID here" >/dev/null 2>&1; then
  echo "Expected invalid deployment output to fail" >&2
  exit 1
fi

if extract_contract_id "$expected_id"$'\n'"$expected_id" >/dev/null 2>&1; then
  echo "Expected multiple contract IDs to fail" >&2
  exit 1
fi

echo "deploy contract output tests passed"
