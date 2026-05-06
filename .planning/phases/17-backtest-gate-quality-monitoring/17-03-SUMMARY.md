---
phase: 17-backtest-gate-quality-monitoring
plan: "03"
subsystem: forecasting
tags: [python, forecasting, naive-baseline, regressors, holidays, bcr-03]
dependency_graph:
  requires: []
  provides:
    - scripts/forecast/naive_dow_with_holidays.py
    - scripts/forecast/tests/test_naive_dow_with_holidays.py
  affects:
    - scripts/forecast/backtest.py  # Wave 2 plan 17-05 will subprocess-spawn this
tech_stack:
  added: []
  patterns:
    - "copy-and-adapt from naive_dow_fit.py per D-05 (original unchanged)"
    - "multiplicative holiday multiplier from per-combo residual ratios"
    - "supabase stub pattern for pure-function test imports"
key_files:
  created:
    - scripts/forecast/naive_dow_with_holidays.py
    - scripts/forecast/tests/test_naive_dow_with_holidays.py
  modified: []
decisions:
  - "_build_forecast_rows_daily copied locally (not imported) because the original hardcodes 'naive_dow'; local copy substitutes MODEL_NAME with source citation"
  - "build_exog_matrix returns (df, sig) tuple — unpacked at call site"
  - "6 tests written (4 from plan + 2 extra: model_name_constant, holiday_flags_tuple)"
metrics:
  duration: "~12 minutes"
  completed_date: "2026-05-06"
  tasks_completed: 2
  files_created: 2
---

# Phase 17 Plan 03: naive_dow_with_holidays — Regressor-Aware Naive Baseline

**One-liner:** Holiday-multiplier naive baseline (BCK-03 gate reference model) using per-flag-combo residual ratios from exog.py, written as a new standalone script without touching naive_dow_fit.py.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | naive_dow_with_holidays.py | `80d5ed0` | `scripts/forecast/naive_dow_with_holidays.py` |
| 2 | test_naive_dow_with_holidays.py | `6838275` | `scripts/forecast/tests/test_naive_dow_with_holidays.py` |

## pytest Output (last 15 lines)

```
platform darwin -- Python 3.13.7, pytest-9.0.2, pluggy-1.6.0 -- /usr/local/bin/python3
cachedir: .pytest_cache
Fugue tests will be initialized with options:
rootdir: /Users/shiniguchi/development/ramen-bones-analytics/.claude/worktrees/agent-ac7e1a071d317eabb
plugins: anyio-4.magic.1, fugue-0.9.7
collecting ... collected 6 items

scripts/forecast/tests/test_naive_dow_with_holidays.py::test_holiday_multiplier_higher_on_holiday PASSED [ 16%]
scripts/forecast/tests/test_naive_dow_with_holidays.py::test_no_holiday_combo_falls_back_to_1 PASSED [ 33%]
scripts/forecast/tests/test_naive_dow_with_holidays.py::test_yhat_equals_dow_mean_when_combo_multiplier_is_1 PASSED [ 50%]
scripts/forecast/tests/test_naive_dow_with_holidays.py::test_strike_day_pushes_yhat_down PASSED [ 66%]
scripts/forecast/tests/test_naive_dow_with_holidays.py::test_model_name_constant PASSED [ 83%]
scripts/forecast/tests/test_naive_dow_with_holidays.py::test_holiday_flags_tuple [100%]

============================== 6 passed in 0.02s ===============================
```

## D-05 Lock Proof (git diff naive_dow_fit.py)

```
(empty — no diff; naive_dow_fit.py is byte-identical to pre-plan state)
```

## CLI Smoke Test (--help)

```
usage: naive_dow_with_holidays.py [-h] [--train-end TRAIN_END]
                                  [--eval-start EVAL_START]
                                  [--fold-index FOLD_INDEX]

Phase 17 BCK-03 naive_dow_with_holidays fit

options:
  -h, --help            show this help message and exit
  --train-end TRAIN_END
                        YYYY-MM-DD. Override default train_end_for_grain. Used
                        by backtest.py per fold.
  --eval-start EVAL_START
                        YYYY-MM-DD. First date of the evaluation window
                        (recorded only).
  --fold-index FOLD_INDEX
                        0-indexed fold number. Optional — used by backtest.py
                        for traceability.
```

## Implementation Notes

### _build_forecast_rows_daily: copy-paste path chosen

`_build_forecast_rows_daily` in `naive_dow_fit.py` hardcodes `model_name: 'naive_dow'` in the row dict (line 266) and also in the `exog_signature` json (line 274). Importing and calling it would silently write the wrong model_name, corrupting the backtest gate comparison.

**Decision:** Copied the function body into the new file as `_build_forecast_rows_daily_holidays` with:
- `model_name: MODEL_NAME` substitution (resolves to `'naive_dow_with_holidays'`)
- Source citation comment: `# Source: naive_dow_fit.py:233-276 [VERIFIED 2026-05-06]`
- Added `exog_signature` kwarg so the caller can pass the enriched signature dict

This is the correct path per the plan's NOTE: "copy-paste its body... with a `# Source: naive_dow_fit.py:NN-MM [VERIFIED]` comment."

### build_exog_matrix returns (df, sig) tuple

The plan's `<interfaces>` block showed `build_exog_matrix` returning a plain DataFrame. The actual signature returns `(df, exog_signature)` — verified by reading `exog.py:93`. The new file unpacks this correctly:

```python
exog_df, exog_sig = build_exog_matrix(client, restaurant_id=..., start_date=..., end_date=...)
```

### Extra tests added (Rule 2 — completeness)

The plan specified 4 tests. Two extra tests were added:
- `test_model_name_constant` — verifies `MODEL_NAME == 'naive_dow_with_holidays'` (was in plan body, just separated)
- `test_holiday_flags_tuple` — verifies HOLIDAY_FLAGS is the exact 4-column tuple from BCK-03 spec

Both align with plan intent and add guard rails against future regressions.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Adaptations (not deviations)

1. **_build_forecast_rows_daily copy-paste** — anticipated by plan NOTE. Documented above.
2. **build_exog_matrix tuple return** — actual signature differs from plan `<interfaces>` doc. Fixed at call site, not a bug in the new file.
3. **6 tests instead of 4** — two extra tests (model_name, flags) added per completeness. All 6 pass.

## Known Stubs

None. This plan creates Python scripts only; no UI components, no data fetching stubs.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes. The new file writes to `forecast_daily` using the same service_role pattern as all existing fit scripts (T-17-03 mitigated per threat register).

## Self-Check: PASSED

- `scripts/forecast/naive_dow_with_holidays.py` exists: FOUND
- `scripts/forecast/tests/test_naive_dow_with_holidays.py` exists: FOUND
- Commit `80d5ed0` exists: FOUND
- Commit `6838275` exists: FOUND
- `MODEL_NAME = 'naive_dow_with_holidays'` count: 1
- `STEP_NAME = 'forecast_naive_dow_with_holidays'` count: 1
- `git diff naive_dow_fit.py`: empty (D-05 PASS)
- 6 pytest tests: all PASS
- `--help` CLI: shows --train-end / --eval-start / --fold-index flags
