#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT

mkdir -p \
  "$test_root/repo/scripts" \
  "$test_root/repo/contracts/amana_escrow/target/wasm32-unknown-unknown/release" \
  "$test_root/bin"
cp "$repo_root/scripts/deploy-contract-local.sh" "$test_root/repo/scripts/"

wasm_file="$test_root/repo/contracts/amana_escrow/target/wasm32-unknown-unknown/release/amana_escrow.wasm"
printf 'stale wasm artifact\n' > "$wasm_file"

cat > "$test_root/bin/cargo" <<'MOCK_CARGO'
#!/usr/bin/env bash
echo "mock cargo build failed" >&2
exit 42
MOCK_CARGO

cat > "$test_root/bin/soroban" <<'MOCK_SOROBAN'
#!/usr/bin/env bash
printf 'called\n' >> "$SOROBAN_CALL_MARKER"
MOCK_SOROBAN

chmod +x "$test_root/bin/cargo" "$test_root/bin/soroban"

if PATH="$test_root/bin:$PATH" \
  SOROBAN_CALL_MARKER="$test_root/soroban-called" \
  "$test_root/repo/scripts/deploy-contract-local.sh" \
    --admin test-admin \
    --token-contract test-token \
    --treasury test-treasury \
    > "$test_root/output.log" 2>&1; then
  echo "deployment script succeeded despite a failed cargo build" >&2
  cat "$test_root/output.log" >&2
  exit 1
fi

if [[ -e "$test_root/soroban-called" ]]; then
  echo "deployment script invoked Soroban after a failed cargo build" >&2
  exit 1
fi

echo "deployment stops on cargo build failure even when a stale WASM artifact exists"
