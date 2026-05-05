#!/usr/bin/env bash
# tests/ci-guards/test_guard_10.sh
# Red-team test for Guard 10 (Phase 16 D-12 / Plan 09 retirement).
#
# Strategy:
#   1. Copy red-team-campaign-literal.ts into src/lib/__guard10_redteam.ts.
#   2. Run scripts/ci-guards.sh (Guard 10 will fire because the fixture
#      contains the literal '2026-04-14' inside src/).
#   3. Assert non-zero exit AND 'Guard 10 FAILED' in the output.
#   4. trap-on-EXIT removes the copy on every code path.

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

FIXTURE="$HERE/red-team-campaign-literal.ts"
TARGET="$REPO/src/lib/__guard10_redteam.ts"

if [ ! -f "$FIXTURE" ]; then
  echo "FIXTURE not found at $FIXTURE"
  exit 2
fi

cp "$FIXTURE" "$TARGET"
trap 'rm -f "$TARGET"' EXIT

LOG=/tmp/guard10_redteam_output.log
if bash "$REPO/scripts/ci-guards.sh" >"$LOG" 2>&1; then
  echo "FAIL: ci-guards.sh exited 0 with the red-team fixture in place"
  echo "----- output -----"
  cat "$LOG"
  exit 1
fi

if ! grep -q "Guard 10 FAILED" "$LOG"; then
  echo "FAIL: ci-guards.sh exited non-zero but not for Guard 10"
  echo "----- output -----"
  cat "$LOG"
  exit 1
fi

echo "PASS: Guard 10 caught the red-team fixture (2026-04-14 literal under src/)"
exit 0
