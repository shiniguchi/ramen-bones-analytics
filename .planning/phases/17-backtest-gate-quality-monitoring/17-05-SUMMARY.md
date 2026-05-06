---
phase: 17-backtest-gate-quality-monitoring
plan: "05"
subsystem: forecast-backtest
tags: [python, backtest, rolling-origin-cv, gate, conformal, subprocess, feature-flags]
dependency_graph:
  requires:
    - 17-01  # schema: forecast_quality + feature_flags + data_freshness_v
    - 17-02  # conformal.calibrate_conformal_h35
    - 17-03  # naive_dow_with_holidays_fit.py subprocess target
    - 17-04  # argparse --train-end/--eval-start/--fold-index in all *_fit.py
  provides:
    - scripts/forecast/backtest.py  # rolling-origin CV driver
    - scripts/forecast/tests/test_backtest.py
    - scripts/forecast/tests/test_gate.py
  affects:
    - forecast_quality (upsert rolling_origin_cv rows per fold)
    - feature_flags (enabled=false flips on FAIL verdict)
    - forecast_daily (transient backtest_fold_* rows cleaned post-eval)
    - pipeline_runs (step_name='forecast_backtest' on completion)
tech_stack:
  added: []
  patterns:
    - rolling-origin-cv-with-subprocess-fold-driver
    - forecast-track-scoped-yhat-rows-for-pk-safety
    - gate-verdict-backfill-second-pass
key_files:
  created:
    - scripts/forecast/backtest.py
    - scripts/forecast/tests/test_backtest.py
    - scripts/forecast/tests/test_gate.py
  modified: []
decisions:
  - "R1 resolution: forecast_track='backtest_fold_{N}' discriminator used (option a) — PK already includes forecast_track; fold yhats safely co-exist in forecast_daily. Rows cleaned post-eval."
  - "Migration 0068 constraint compliance: gate_verdict='PENDING' written on fold row insert; updated to final verdict in second pass via .update().gte('evaluated_at', started_at)."
  - "Conformal calibration (BCK-02): signed residuals from h=35 fold windows pooled and passed to calibrate_conformal_h35; result written as a sentinel forecast_quality row (fold_idx=None)."
  - "R7 hard guard: BASELINE_MODELS=('naive_dow','naive_dow_with_holidays') hardcoded; _apply_gate_to_feature_flags skips both unconditionally."
metrics:
  duration: "~25 min"
  completed: "2026-05-06"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 0
---

# Phase 17 Plan 05: Backtest Driver + Gate Tests Summary

Rolling-origin CV driver (`backtest.py`) with conformal calibration at h=35 and feature_flags gate writer. 33 tests passing, all plan success criteria met.

## What Was Built

### `scripts/forecast/backtest.py` (~370 LOC)

Phase 17 BCK-01/BCK-02/BCK-04 orchestrator. Four phases per run:

1. **Fold loop**: For each (kpi, horizon, model, fold_idx), spawns `*_fit.py` subprocess via `_spawn_fit` with FORECAST_TRACK=backtest_fold_{N} and RUN_DATE=eval_start. Reads yhats back from forecast_daily, computes RMSE/MAPE/bias via `compute_metrics`, writes a PENDING forecast_quality row.

2. **Conformal calibration** (BCK-02): After all h=35 folds complete, collects signed residuals per (kpi, model) and calls `calibrate_conformal_h35(folds, alpha=0.05)`. Writes a sentinel quality row with qhat value.

3. **Gate decision** (BCK-04): Computes mean RMSE per model per horizon. Baseline = max(naive_dow_mean, naive_dow_with_holidays_mean). Threshold = baseline * 0.9. Updates gate_verdict on already-written fold rows in a second DB pass. Aggregates per model: FAIL if any evaluable horizon FAILs. Calls `_apply_gate_to_feature_flags` which flips enabled=false for failing non-baseline models.

4. **Cleanup + pipeline_runs**: Deletes `backtest_fold_*` forecast_daily rows. Writes `step_name='forecast_backtest'` success row.

**Key constants:**
```python
HORIZONS = [7, 35, 120, 365]
N_FOLDS = 4
BASELINE_MODELS = ('naive_dow', 'naive_dow_with_holidays')
GATE_THRESHOLD = 0.9
UNCALIBRATED_HORIZONS = (120, 365)
STEP_NAME = 'forecast_backtest'
```

### `scripts/forecast/tests/test_backtest.py` (19 tests)

- `TestFoldCutoffs` (7 tests): fold-cutoff date math, no-overlap invariant, subprocess run_date, N_FOLDS and HORIZONS constants.
- `TestUncalibratedHorizons` (4 tests): 120/365 in UNCALIBRATED_HORIZONS; 7/35 not in it.
- `TestGateDecision` (8 tests): UNCALIBRATED for h=120/365; PASS/FAIL threshold math; baselines always PASS; mean RMSE across folds; KPI filter independence.

### `scripts/forecast/tests/test_gate.py` (14 tests)

- `TestGateBaselines` (5 tests): R7 guard — naive_dow and naive_dow_with_holidays NEVER flipped.
- `TestGateNonBaseline` (5 tests): FAIL→flip, PASS→no flip, PENDING→no flip, UNCALIBRATED→no flip, multiple FAIL→multiple flips.
- `TestGateMixed` (4 tests): mixed verdicts, all-PASS, restaurant_id threading.

## R1 Architectural Decision — forecast_track Discriminator

**Decision adopted: option (a) from RESEARCH §R1** — use `FORECAST_TRACK=backtest_fold_{N}` as the per-fold PK discriminator.

**Rationale:** Migration 0050 confirmed `forecast_track` is column 6 of the PK `(restaurant_id, kpi_name, target_date, model_name, run_date, forecast_track)`. This means each fold's yhats sit in their own PK partition even when eval windows share target_dates with each other or with production BAU rows. No PK collision possible.

**Trade-off vs. option (b) / in-memory:** Writing to forecast_daily is ~192 rows × horizon days transiently during the run. At h=7 that is negligible; at h=365 it is ~1.5K rows per (model, kpi, fold). Total peak: 6 models × 2 KPIs × 4 folds × 365 days ≈ 17.5K rows. Acceptable for nightly runs; cleanup via `LIKE 'backtest_fold_%'` DELETE is O(rows) and runs post-eval.

**Alternative (b.3 sentinel run_date, from PLAN.md action block):** Was considered. The PLAN.md action code used sentinel run_dates (1900-01-01 + fold_idx) and cleaned up with `run_date <= '1901-01-01'`. This plan instead uses the cleaner `forecast_track` discriminator since the PK already supports it. The sentinel-run_date approach would require a different cleanup predicate and could have surprising interactions if the DB ever backfills historical data to those dates. Forecast_track discriminator is cleaner.

## Migration 0068 Constraint Compliance

Migration 0068 adds: `CHECK (evaluation_window != 'rolling_origin_cv' OR gate_verdict IS NOT NULL)`.

**Impact:** Every `rolling_origin_cv` row must have a non-NULL gate_verdict at all times. The plan's original approach (write `gate_verdict=None` on fold rows, update in second pass) would FAIL this constraint.

**Fix applied (Rule 1 — Bug):** Fold rows are written with `gate_verdict='PENDING'` initially. The second-pass DB update then sets the actual verdict (PASS/FAIL/UNCALIBRATED). This satisfies the constraint throughout.

## Pre-flight: `forecast_daily` Run_date Constraint

Checked `supabase/migrations/0050_forecast_daily.sql`:
- `run_date date NOT NULL` — no CHECK constraint on the date range.
- `model_name text NOT NULL` — no CHECK constraint listing allowed values.

No migration needed to allow the fold's `run_date=eval_start` values.

## Verification Output

```
python -m scripts.forecast.backtest --help
usage: backtest.py [-h] [--models MODELS] [--run-date RUN_DATE]

Phase 17 rolling-origin CV backtest driver (BCK-01/BCK-02/BCK-04)

options:
  -h, --help           show this help message and exit
  --models MODELS      Comma-separated model list (default: all 6).
  --run-date RUN_DATE  YYYY-MM-DD. Default = today UTC.
```

```
python3 -m pytest scripts/forecast/tests/test_backtest.py scripts/forecast/tests/test_gate.py -v --tb=short

============================= test session starts ==============================
platform darwin -- Python 3.13.7, pytest-9.0.2, pluggy-1.6.0
collected 33 items

scripts/forecast/tests/test_backtest.py::TestFoldCutoffs::test_fold0_h7_eval_end_is_last_actual PASSED
scripts/forecast/tests/test_backtest.py::TestFoldCutoffs::test_fold0_h7_eval_start PASSED
scripts/forecast/tests/test_backtest.py::TestFoldCutoffs::test_fold0_h7_train_end PASSED
scripts/forecast/tests/test_backtest.py::TestFoldCutoffs::test_folds_do_not_overlap PASSED
scripts/forecast/tests/test_backtest.py::TestFoldCutoffs::test_subprocess_run_date_is_eval_start PASSED
scripts/forecast/tests/test_backtest.py::TestFoldCutoffs::test_fold_count_constant PASSED
scripts/forecast/tests/test_backtest.py::TestFoldCutoffs::test_horizons_constant PASSED
scripts/forecast/tests/test_backtest.py::TestUncalibratedHorizons::test_120_in_uncalibrated PASSED
scripts/forecast/tests/test_backtest.py::TestUncalibratedHorizons::test_365_in_uncalibrated PASSED
scripts/forecast/tests/test_backtest.py::TestUncalibratedHorizons::test_7_not_in_uncalibrated PASSED
scripts/forecast/tests/test_backtest.py::TestUncalibratedHorizons::test_35_not_in_uncalibrated PASSED
scripts/forecast/tests/test_backtest.py::TestGateDecision::test_empty_rows_returns_empty PASSED
scripts/forecast/tests/test_backtest.py::TestGateDecision::test_h120_returns_uncalibrated_for_all_models PASSED
scripts/forecast/tests/test_backtest.py::TestGateDecision::test_h365_returns_uncalibrated_for_all_models PASSED
scripts/forecast/tests/test_backtest.py::TestGateDecision::test_pass_when_rmse_well_below_threshold PASSED
scripts/forecast/tests/test_backtest.py::TestGateDecision::test_fail_when_rmse_over_threshold PASSED
scripts/forecast/tests/test_backtest.py::TestGateDecision::test_baselines_always_pass PASSED
scripts/forecast/tests/test_backtest.py::TestGateDecision::test_gate_threshold_constant_is_0_9 PASSED
scripts/forecast/tests/test_backtest.py::TestGateDecision::test_mean_rmse_aggregated_across_folds PASSED
scripts/forecast/tests/test_backtest.py::TestGateDecision::test_kpi_filter_independent PASSED
scripts/forecast/tests/test_gate.py::TestGateBaselines::test_baseline_models_constant_contains_naive_dow PASSED
scripts/forecast/tests/test_gate.py::TestGateBaselines::test_baseline_models_constant_contains_naive_dow_with_holidays PASSED
scripts/forecast/tests/test_gate.py::TestGateBaselines::test_naive_dow_never_flipped_even_on_fail PASSED
scripts/forecast/tests/test_gate.py::TestGateBaselines::test_naive_dow_with_holidays_never_flipped_even_on_fail PASSED
scripts/forecast/tests/test_gate.py::TestGateBaselines::test_both_baselines_fail_no_update PASSED
scripts/forecast/tests/test_gate.py::TestGateNonBaseline::test_failing_model_flips_enabled_false PASSED
scripts/forecast/tests/test_gate.py::TestGateNonBaseline::test_passing_model_does_not_flip PASSED
scripts/forecast/tests/test_gate.py::TestGateNonBaseline::test_pending_model_does_not_flip PASSED
scripts/forecast/tests/test_gate.py::TestGateNonBaseline::test_uncalibrated_model_does_not_flip PASSED
scripts/forecast/tests/test_gate.py::TestGateNonBaseline::test_multiple_failing_models_all_flip PASSED
scripts/forecast/tests/test_gate.py::TestGateMixed::test_mixed_only_failing_non_baselines_flipped PASSED
scripts/forecast/tests/test_gate.py::TestGateMixed::test_all_pass_no_flips PASSED
scripts/forecast/tests/test_gate.py::TestGateMixed::test_restaurant_id_passed_to_eq PASSED

============================== 33 passed in 0.02s ==============================
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Migration 0068 gate_verdict NOT NULL constraint violation**

- **Found during:** Task 1 implementation (pre-coding review of migration 0068)
- **Issue:** The plan's action code template wrote `gate_verdict=None` on fold row insert, then updated in a second pass. Migration 0068 adds `CHECK (evaluation_window != 'rolling_origin_cv' OR gate_verdict IS NOT NULL)`, which would reject all PENDING/NULL fold rows at insert time.
- **Fix:** Write `gate_verdict='PENDING'` on every fold row insert. The second-pass DB update sets PASS/FAIL/UNCALIBRATED. Satisfies the constraint throughout.
- **Files modified:** `scripts/forecast/backtest.py` (`_write_quality_row` calls always pass gate_verdict)

**2. [Rule 1 - Bug] PLAN.md used sentinel run_date (1900-01-01+fold_idx) but RESEARCH §Open Questions resolved this differently**

- **Found during:** Task 1 design review
- **Issue:** The PLAN.md action code block used sentinel run_dates for R1 mitigation. But RESEARCH §Open Questions (line 1060) explicitly RESOLVED R1 as: "per-fold FORECAST_TRACK='backtest_fold_{N}' discriminator is the chosen approach (forecast_track IS in PK position 6)." The plan body (§behavior) described option (b.3) but the RESEARCH context showed option (a) was the resolved design.
- **Fix:** Implemented option (a) — `FORECAST_TRACK=backtest_fold_{N}` as discriminator, `RUN_DATE=eval_start` (not a sentinel). Cleanup is `LIKE 'backtest_fold_%'` DELETE instead of date-range DELETE.
- **Impact:** Cleaner, no need for 1900-era sentinel dates. The PLAN test for `_fetch_fold_yhats` filtering by `forecast_track` is satisfied.

## Known Stubs

None. All functions are fully implemented and wire to real DB operations.

## Threat Flags

No new network endpoints, auth paths, or file access patterns introduced beyond what the plan's threat model documented.

T-17-02 (subprocess argv injection) — mitigated: argv constructed from internal date math (`train_end.isoformat()`, `eval_start.isoformat()`, `str(fold_idx)`), subprocess.run with list (no shell=True).

T-17-03 (RLS bypass via service_role) — mitigated: every UPDATE/DELETE scoped with `.eq('restaurant_id', restaurant_id)`.

T-17-12 (PK collision) — mitigated: forecast_track discriminator eliminates PK collisions. Cleanup removes all backtest_fold_* rows post-eval.

T-17-14 (R7 baseline flip bypass) — mitigated: `BASELINE_MODELS` tuple constant, `if model in BASELINE_MODELS: continue` literal guard, test_gate.py asserts it for both baselines.

## Self-Check: PASSED

- `scripts/forecast/backtest.py` — FOUND (created, 370 LOC)
- `scripts/forecast/tests/test_backtest.py` — FOUND (19 tests)
- `scripts/forecast/tests/test_gate.py` — FOUND (14 tests)
- Commit 12b0c89 — verified in git log
- All 33 pytest tests passed
- `python -m scripts.forecast.backtest --help` exits 0
- `grep -c "if model in BASELINE_MODELS:" scripts/forecast/backtest.py` = 1
- `grep -E "calibrate_conformal_h35|compute_metrics" scripts/forecast/backtest.py` = 5 matches (import + call sites)
