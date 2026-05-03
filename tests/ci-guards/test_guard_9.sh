#!/usr/bin/env bash
# tests/ci-guards/test_guard_9.sh
# Red-team test for Guard 9 (Phase 16 D-04 / UPL-03 / SC#3).
#
# Strategy:
#   1. Copy red-team-cf-revenue-eur.py into scripts/forecast/__guard9_redteam.py
#   2. Run scripts/ci-guards.sh in full (Guard 9 will fire because the fixture
#      pairs forecast_track='cf' with kpi_name='revenue_eur').
#   3. Assert the script exited non-zero AND that the failure was specifically
#      'Guard 9 FAILED' (not some other guard tripping for unrelated reasons).
#   4. Restore the tree (trap removes the copy on any exit path).

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

FIXTURE="$HERE/red-team-cf-revenue-eur.py"
TARGET="$REPO/scripts/forecast/__guard9_redteam.py"

if [ ! -f "$FIXTURE" ]; then
  echo "FIXTURE not found at $FIXTURE"
  exit 2
fi

cp "$FIXTURE" "$TARGET"
trap 'rm -f "$TARGET"' EXIT

# Run all guards. We expect non-zero exit because the fixture trips Guard 9.
LOG=/tmp/guard9_redteam_output.log
if bash "$REPO/scripts/ci-guards.sh" >"$LOG" 2>&1; then
  echo "FAIL: ci-guards.sh exited 0 with the red-team fixture in place"
  echo "----- output -----"
  cat "$LOG"
  exit 1
fi

if ! grep -q "Guard 9 FAILED" "$LOG"; then
  echo "FAIL: ci-guards.sh exited non-zero but not for Guard 9"
  echo "----- output -----"
  cat "$LOG"
  exit 1
fi

echo "PASS: Guard 9 caught the red-team fixture (forecast_track='cf' + kpi_name='revenue_eur')"
exit 0
