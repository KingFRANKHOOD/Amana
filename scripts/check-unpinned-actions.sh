#!/usr/bin/env bash
# Pre-commit check for unpinned GitHub Actions
# Scans .github/workflows/ for uses: references that are not pinned to a commit SHA

set -euo pipefail

WORKFLOWS_DIR=".github/workflows"
PATTERN='uses: [^@]+@[^#0-9a-f]'
SHA_PATTERN='^[0-9a-f]{40}$'

echo "Checking for unpinned GitHub Actions in $WORKFLOWS_DIR..."

unpinned_found=0

for workflow in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
  [ -f "$workflow" ] || continue

  while IFS= read -r line; do
    # Skip comments and already pinned actions
    if [[ "$line" =~ ^[[:space:]]*# ]]; then
      continue
    fi

    # Check for uses: with tag/branch ref (not SHA)
    if [[ "$line" =~ uses:[[:space:]]*([^@]+)@([^#[:space:]]+) ]]; then
      action="${BASH_REMATCH[1]}"
      ref="${BASH_REMATCH[2]}"

      # Skip if it's already a SHA (40 hex chars)
      if [[ "$ref" =~ $SHA_PATTERN ]]; then
        continue
      fi

      # Skip if it's a local action (./path)
      if [[ "$action" =~ ^\./ ]]; then
        continue
      fi

      # Skip if it's a docker action (docker://)
      if [[ "$action" =~ ^docker:// ]]; then
        continue
      fi

      echo "UNPINNED ACTION: $workflow"
      echo "  $line"
      echo "  Action: $action@$ref"
      echo "  Please pin to a commit SHA (e.g., $action@abc123... # $ref)"
      unpinned_found=1
    fi
  done < "$workflow"
done

if [ $unpinned_found -eq 1 ]; then
  echo ""
  echo "ERROR: Unpinned GitHub Actions detected!"
  echo "Please pin all actions to commit SHAs for supply chain security."
  exit 1
else
  echo "All GitHub Actions are properly pinned to commit SHAs."
  exit 0
fi