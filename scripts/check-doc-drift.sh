#!/usr/bin/env bash
# Fails when docs repeat claims known to contradict the repo's actual behaviour.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
check() { # <file> <regex> <message>
  if grep -nE "$2" "$1"; then
    echo "::error file=$1::$3"
    fail=1
  fi
}

check docs/CONTRIBUTOR_ONBOARDING.md '^- (Supabase|Jaeger|Prometheus|Grafana) \(port' \
  'dev-up.sh only starts postgres + redis (see docs/docker-profiles.md)'
check CONTRIBUTING.md 'pnpm --dir routes-d' \
  'routes-d is npm-managed; use npm inside routes-d'
check routes-d/README.md '^npm test +#.*80%' \
  'plain npm test does not collect coverage; the 80% threshold needs --coverage'

exit "$fail"
