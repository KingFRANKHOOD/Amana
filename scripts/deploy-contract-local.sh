#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Local Soroban Contract Deployment Script
#
# Deploys the Amana escrow contract to a local Soroban network for development
# and testing. Supports both fresh deployments and contract upgrades.
#
# Usage:
#   ./scripts/deploy-contract-local.sh [OPTIONS]
#
# Options:
#   --network NAME          Network name (default: standalone)
#   --admin PUBKEY          Admin public key (required)
#   --token-contract ID     Token contract ID (required)
#   --treasury PUBKEY       Treasury address (required)
#   --fee-bps BPS           Platform fee in basis points (default: 100)
#   --source-token ID       Source token for path payments (optional)
#   --upgrade               Upgrade existing contract instead of deploying new
#   --help                  Show this help message
#
# Example:
#   ./scripts/deploy-contract-local.sh \
#     --network standalone \
#     --admin GDZST3XVCDTUJ76ZAV2HA72KYQM4YQQ5DQJP4YOWQ56OOKLVTOITLBX \
#     --token-contract CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4 \
#     --treasury GDZST3XVCDTUJ76ZAV2HA72KYQM4YQQ5DQJP4YOWQ56OOKLVTOITLBX \
#     --fee-bps 100
# ─────────────────────────────────────────────────────────────────────────────

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
contract_dir="$repo_root/contracts/amana_escrow"

# Defaults
NETWORK="standalone"
ADMIN=""
TOKEN_CONTRACT=""
TREASURY=""
FEE_BPS="100"
SOURCE_TOKEN=""
UPGRADE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --network)
      NETWORK="$2"
      shift 2
      ;;
    --admin)
      ADMIN="$2"
      shift 2
      ;;
    --token-contract)
      TOKEN_CONTRACT="$2"
      shift 2
      ;;
    --treasury)
      TREASURY="$2"
      shift 2
      ;;
    --fee-bps)
      FEE_BPS="$2"
      shift 2
      ;;
    --source-token)
      SOURCE_TOKEN="$2"
      shift 2
      ;;
    --upgrade)
      UPGRADE=true
      shift
      ;;
    --help)
      grep '^#' "$0" | tail -n +2 | sed 's/^# //'
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# Validate required arguments
if [[ -z "$ADMIN" ]]; then
  echo "Error: --admin is required" >&2
  exit 1
fi

if [[ -z "$TOKEN_CONTRACT" ]]; then
  echo "Error: --token-contract is required" >&2
  exit 1
fi

if [[ -z "$TREASURY" ]]; then
  echo "Error: --treasury is required" >&2
  exit 1
fi

# Use token contract as source token if not specified
SOURCE_TOKEN="${SOURCE_TOKEN:-$TOKEN_CONTRACT}"

echo "🚀 Deploying Amana Escrow Contract to Local Network"
echo ""
echo "Configuration:"
echo "  Network:        $NETWORK"
echo "  Admin:          $ADMIN"
echo "  Token Contract: $TOKEN_CONTRACT"
echo "  Treasury:       $TREASURY"
echo "  Fee (bps):      $FEE_BPS"
echo "  Source Token:   $SOURCE_TOKEN"
echo "  Mode:           $([ "$UPGRADE" = true ] && echo "UPGRADE" || echo "DEPLOY")"
echo ""

# Build WASM artifact
echo "📦 Building WASM artifact..."
cd "$contract_dir"
cargo build --target wasm32-unknown-unknown --features wasm --release 2>&1 | grep -E "Compiling|Finished|error" || true

WASM_FILE="target/wasm32-unknown-unknown/release/amana_escrow.wasm"
if [[ ! -f "$WASM_FILE" ]]; then
  echo "❌ WASM build failed: $WASM_FILE not found" >&2
  exit 1
fi

echo "✓ WASM artifact built: $(du -h "$WASM_FILE" | cut -f1)"
echo ""

# Deploy or upgrade contract
if [ "$UPGRADE" = true ]; then
  echo "🔄 Upgrading contract..."
  soroban contract upgrade \
    --network "$NETWORK" \
    --wasm "$WASM_FILE" \
    2>&1 | tail -5
else
  echo "📝 Deploying contract..."
  CONTRACT_ID=$(soroban contract deploy \
    --network "$NETWORK" \
    --wasm "$WASM_FILE" \
    2>&1 | tail -1)
  
  echo "✓ Contract deployed: $CONTRACT_ID"
  echo ""
  
  # Initialize contract
  echo "⚙️  Initializing contract..."
  soroban contract invoke \
    --network "$NETWORK" \
    --id "$CONTRACT_ID" \
    -- initialize \
    --admin "$ADMIN" \
    --cngn_contract "$TOKEN_CONTRACT" \
    --treasury "$TREASURY" \
    --fee_bps "$FEE_BPS" \
    --source_token "$SOURCE_TOKEN" \
    2>&1 | tail -5
  
  echo ""
  echo "✅ Contract deployment complete!"
  echo ""
  echo "Contract ID: $CONTRACT_ID"
  echo ""
  echo "Next steps:"
  echo "  1. Update backend .env with CONTRACT_ID=$CONTRACT_ID"
  echo "  2. Run backend tests: cd backend && npm test"
  echo "  3. Verify contract state: soroban contract read --network $NETWORK --id $CONTRACT_ID"
fi

echo ""
echo "✓ Deployment safety checks passed"
