#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
contract_dir="$repo_root/contracts/amana_escrow"
manifest="$contract_dir/Cargo.toml"
contract_src="$contract_dir/src/lib.rs"

fail() {
  echo "contract deployment safety check failed: $*" >&2
  exit 1
}

require_file() {
  local path="$1"
  [[ -f "$path" ]] || fail "missing required file: ${path#$repo_root/}"
}

require_file "$manifest"
require_file "$contract_src"
require_file "$contract_dir/tests/storage_golden_tests.rs"
require_file "$contract_dir/tests/auth_matrix_tests.rs"
require_file "$contract_dir/src/tests/migration_tests.rs"

grep -Eq '^wasm = \[\][[:space:]]*$' "$manifest" \
  || fail "Cargo.toml must expose the explicit wasm feature used for deployment builds"

grep -Eq '^crate-type = \["rlib"\][[:space:]]*$' "$manifest" \
  || fail "native test crate-type must stay rlib unless CI deployment build steps are updated"

grep -q '#!\[no_std\]' "$contract_src" \
  || fail "contract must remain no_std-compatible for Soroban deployment"

grep -q 'DataKey::Initialized' "$contract_src" \
  || fail "initialize must preserve the single-initialize storage guard"

grep -q 'AlreadyInitialized' "$contract_src" \
  || fail "initialize must reject repeat deployment initialization"

grep -q 'admin.require_auth()' "$contract_src" \
  || fail "admin-controlled deployment setup must require admin authorization"

grep -qE 'DataKey::(CngnContract|SourceToken)' "$contract_src" \
  || fail "token contract storage key must remain explicit and migration-safe (CngnContract or SourceToken)"

if grep -RInE '(SECRET_KEY|PRIVATE_KEY|MNEMONIC|SEED_PHRASE|S[A-Z0-9]{55})' "$contract_dir" \
  --exclude-dir target \
  --exclude 'Cargo.lock' \
  --exclude '*.json'; then
  fail "potential secret or live key material found under contracts/"
fi

(
  cd "$contract_dir"
  cargo metadata --locked --format-version 1 --no-deps >/dev/null
)

echo "contract deployment safety checks passed"
