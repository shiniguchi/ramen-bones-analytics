#!/usr/bin/env bash
# scripts/fork-dryrun.sh
# Smoke-test the forker walkthrough from a clean clone.
# Runs the README Phase 1 → Ship checklist in non-interactive mode and asserts
# every referenced file + env var + migration exists.
#
# INS-05 / INS-06 / 05-05 completion gate.
# Currently RED (exit 1) — 05-05 will implement the checks.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "fork-dryrun.sh: NOT YET IMPLEMENTED (Plan 05-05 closes this gap)" >&2
exit 1
