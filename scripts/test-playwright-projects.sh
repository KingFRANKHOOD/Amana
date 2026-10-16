#!/usr/bin/env bash
# test-playwright-projects.sh — Fails when .github/workflows/ci.yml asks
# Playwright to run a project that is not defined in
# frontend/playwright.config.ts.
#
# Regression guard for issues #1483 and #1484: CI ran
#   playwright test --project=chromium-desktop
#   playwright test --project=visual-regression
# while playwright.config.ts defined only `chromium`, so every run aborted
# with `Project(s) "..." not found` before a single test executed — the e2e
# and visual-regression suites silently never ran.
#
# Usage:
#   ./scripts/test-playwright-projects.sh
set -euo pipefail
cd "$(dirname "$0")/.."

WORKFLOW=".github/workflows/ci.yml"
CONFIG="frontend/playwright.config.ts"

for file in "$WORKFLOW" "$CONFIG"; do
  if [[ ! -f "$file" ]]; then
    echo "::error::$file not found"
    exit 1
  fi
done

# Project names referenced by `--project=<name>` anywhere in the workflow.
referenced="$(
  grep -oE -- '--project=[A-Za-z0-9_-]+' "$WORKFLOW" \
    | sed -E 's/^--project=//' \
    | sort -u || true
)"

if [[ -z "$referenced" ]]; then
  echo "No --project= references found in $WORKFLOW (nothing to validate)."
  exit 0
fi

# Project names defined in the Playwright config (`name: '<value>'`).
defined="$(
  grep -oE "name:[[:space:]]*['\"][A-Za-z0-9_-]+['\"]" "$CONFIG" \
    | sed -E "s/name:[[:space:]]*['\"]//; s/['\"]//" \
    | sort -u || true
)"

missing=0
while IFS= read -r project; do
  [[ -z "$project" ]] && continue
  if grep -qxF "$project" <<< "$defined"; then
    echo "  ✓ Playwright project '$project' referenced by CI is defined in $CONFIG"
  else
    echo "::error file=$WORKFLOW::CI references Playwright project '$project', which is not defined in $CONFIG"
    ((missing++)) || true
  fi
done <<< "$referenced"

if (( missing > 0 )); then
  echo ""
  echo "Defined projects in $CONFIG:"
  sed 's/^/    /' <<< "$defined"
  echo ""
  echo "✗ $missing CI Playwright project reference(s) are undefined"
  exit 1
fi

echo "✓ All CI Playwright project references are defined"
