---
phase: 17-backtest-gate-quality-monitoring
plan: "08"
subsystem: forecast-ci-gate
tags: [github-actions, pull-request, ci-gate, db-read, python, tdd]
dependency_graph:
  requires: ["17-01", "17-05"]
  provides: ["forecast-quality-gate.yml", "quality_gate_check.py"]
  affects: ["scripts/forecast/**", ".github/workflows/"]
tech_stack:
  added: []
  patterns: ["read-only DB gate via service_role", "TDD red-green", "supabase mock chain"]
key_files:
  created:
    - .github/workflows/forecast-quality-gate.yml
    - scripts/forecast/quality_gate_check.py
    - scripts/forecast/tests/test_quality_gate_check.py
  modified: []
decisions:
  - "Python 3.8 compat: str.startswith/slice replaces str.removeprefix (3.9+ only)"
  - "Defense-in-depth: enabled field re-checked in Python set comprehension (not just DB filter)"
  - "test_workflow_yaml.py activation deferred: file created by parallel plan 17-07; gate tests activate post-merge"
metrics:
  duration: "~3 minutes"
  completed: "2026-05-06"
  tasks_completed: 2
  files_created: 3
---

# Phase 17 Plan 08: Forecast Quality Gate (PR-time CI) Summary

PR-time CI gate that exits 1 when any enabled model has a FAIL verdict on its latest rolling-origin CV evaluation, read-only DB check via service_role, <5 min hard cap.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for _find_enabled_failures | e61f3af | scripts/forecast/tests/test_quality_gate_check.py |
| 1 (GREEN) | quality_gate_check.py implementation | 3cc43ec | scripts/forecast/quality_gate_check.py |
| 2 | forecast-quality-gate.yml workflow | ea6f532 | .github/workflows/forecast-quality-gate.yml |

## Final Artifacts

### .github/workflows/forecast-quality-gate.yml

```yaml
name: Forecast Quality Gate (Phase 17 BCK-06)
on:
  pull_request:
    paths:
      - 'scripts/forecast/**'

permissions:
  contents: read

concurrency:
  group: forecast-quality-gate-${{ github.ref }}
  cancel-in-progress: true

jobs:
  gate:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'
      - name: Install minimal deps (no cmdstan — read-only check)
        run: pip install supabase python-dotenv

      - name: Check gate verdicts on enabled models
        env:
          SUPABASE_URL: ${{ secrets.DEV_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.DEV_SUPABASE_SERVICE_ROLE_KEY }}
        run: |
          set -euo pipefail
          python -m scripts.forecast.quality_gate_check
```

### scripts/forecast/quality_gate_check.py (key logic)

```python
def _find_enabled_failures(client) -> list[tuple[str, int, str]]:
    # 1. Query enabled model flags (model_% prefix, enabled=True)
    # 2. Cold-start safety: empty rows -> return []
    # 3. Query forecast_quality rolling_origin_cv, latest per (model, horizon)
    # 4. Return (model, horizon, FAIL) for enabled models with FAIL verdict

def main() -> int:
    failures = _find_enabled_failures(make_client())
    if failures: print to stderr + return 1
    print PASS to stdout + return 0
```

## Pytest Output

```
============================= test session info ==============================
platform darwin -- Python 3.8.5, pytest-6.1.1

9 passed in 0.05s
```

Tests:
- `test_empty_enabled_models_returns_no_failures` PASSED
- `test_cold_start_no_rolling_origin_rows_returns_no_failures` PASSED
- `test_enabled_fail_returns_failure` PASSED
- `test_enabled_pass_returns_no_failures` PASSED
- `test_disabled_fail_does_not_block` PASSED
- `test_pending_does_not_block` PASSED
- `test_uncalibrated_does_not_block` PASSED
- `test_latest_verdict_wins_when_multiple_per_model_horizon` PASSED
- `test_multiple_enabled_models_one_fails` PASSED

## Cold-Start Safety

When DEV has no `rolling_origin_cv` rows yet (Phase 17 just deployed; first Tuesday cron hasn't fired), `_find_enabled_failures()` returns `[]` and `main()` exits 0 with message:

```
[quality_gate_check] PASS — all enabled models have PASS / PENDING / UNCALIBRATED verdicts (or no rolling_origin_cv rows yet).
```

Two cold-start paths both exit 0:
1. `enabled_models` is empty (feature_flags not seeded yet)
2. `verdict_rows` is empty (backtest cron hasn't run yet)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Python 3.8 compatibility — str.removeprefix not available**
- **Found during:** Task 1 GREEN phase execution
- **Issue:** `str.removeprefix()` was introduced in Python 3.9; local environment runs Python 3.8.5. All 8 tests with non-empty flags failed with `AttributeError`.
- **Fix:** Replaced `row['flag_key'].removeprefix('model_')` with `row['flag_key'][len('model_'):]` using `str.startswith()` guard.
- **Files modified:** scripts/forecast/quality_gate_check.py
- **Commit:** 3cc43ec (inline fix before commit)

**2. [Rule 2 - Missing critical functionality] Defense-in-depth enabled check**
- **Found during:** Task 1 GREEN phase — `test_disabled_fail_does_not_block` failed
- **Issue:** The test mock bypasses DB-level `.eq('enabled', True)` filter, returning disabled rows. The implementation only relied on the DB filter, so disabled models' verdicts would block in edge cases where the DB filter is bypassed (mock, future refactor, etc.).
- **Fix:** Added `if row.get('enabled', True)` to the set comprehension so the `enabled` field is checked defensively in Python.
- **Files modified:** scripts/forecast/quality_gate_check.py
- **Commit:** 3cc43ec (inline fix before commit)

**3. [Informational - Not a deviation] test_workflow_yaml.py gate tests deferred**
- Plan 17-08 Task 2 expected `test_workflow_yaml.py` from plan 17-07 (parallel wave 3) to exist and show the 4 gate tests activating from "skipped" to "passed". Plan 17-07 had not yet committed this file (parallel execution). The gate workflow was created and verified against yaml.safe_load + grep checks; the 4 test_workflow_yaml.py assertions will activate automatically when plan 17-07 merges (they use `skipif(not GATE_YML.exists())`).

## Known Stubs

None — the gate check script has no UI stubs. It reads live DB or returns cold-start PASS.

## Threat Flags

No new threat surface beyond what the plan's threat model covers:
- T-17-01b: Fork PRs receive empty secrets → `make_client()` raises RuntimeError fast (fail-safe)
- T-17-03b: service_role bypasses RLS by design — v1 single-tenant, multi-tenant audit Phase 18+

## Self-Check

### Files Created

- [x] `.github/workflows/forecast-quality-gate.yml` — EXISTS
- [x] `scripts/forecast/quality_gate_check.py` — EXISTS
- [x] `scripts/forecast/tests/test_quality_gate_check.py` — EXISTS

### Commits

- e61f3af — test(17-08): add failing tests for quality_gate_check._find_enabled_failures
- 3cc43ec — feat(17-08): quality_gate_check.py — read-only DB gate for enabled model FAIL verdicts
- ea6f532 — feat(17-08): forecast-quality-gate.yml — PR-time CI gate for forecast engine changes

## Self-Check: PASSED
