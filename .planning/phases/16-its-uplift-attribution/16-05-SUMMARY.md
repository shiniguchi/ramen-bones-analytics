---
phase: 16
plan: 05
title: counterfactual_fit.py + run_all.py --track flag (Track-B fits)
subsystem: forecast-pipeline
tags: [phase-16, plan-05, track-b, counterfactual, uplift, its]
requires:
  - 16-04  # pipeline_runs.fit_train_end column (UPL-02 audit)
  - 16-03  # kpi_daily_with_comparable_v view (D-04 source)
  - 16-01  # campaign_calendar table (TRAIN_END source)
provides:
  - cf-orchestrator: scripts/forecast/counterfactual_fit.py
  - cf-track-flag: scripts/forecast/run_all.py --track={bau,cf,both}
  - cf-fit-modules: 5 BAU per-model fits gain track + train_end kwargs
affects:
  - scripts/forecast/run_all.py
  - scripts/forecast/sarimax_fit.py
  - scripts/forecast/prophet_fit.py
  - scripts/forecast/ets_fit.py
  - scripts/forecast/theta_fit.py
  - scripts/forecast/naive_dow_fit.py
  - scripts/external/pipeline_runs_writer.py
tech-stack:
  added: []
  patterns:
    - "Track flag at orchestrator + per-module dispatch (KISS over parallel orchestrator per CONTEXT.md D-06)"
    - "_load_comparable_history helper duplicated across 5 modules — explicit copy over premature shared abstraction"
    - "Per-model failure isolation in main_cf via try/except + write_failure"
key-files:
  created:
    - scripts/forecast/counterfactual_fit.py
    - tests/forecast/test_counterfactual_fit.py
  modified:
    - scripts/forecast/run_all.py
    - scripts/forecast/sarimax_fit.py
    - scripts/forecast/prophet_fit.py
    - scripts/forecast/ets_fit.py
    - scripts/forecast/theta_fit.py
    - scripts/forecast/naive_dow_fit.py
    - scripts/external/pipeline_runs_writer.py
decisions:
  - "Per-model fit_and_write extended in-place rather than introducing fit_track_b wrapper functions — KISS, fewer surface symbols"
  - "_load_comparable_history copy-pasted into all 5 modules (4 lines + kpi_name guard) rather than extracted to scripts/forecast/cf_loader.py — copy is small and stable; planning doc explicitly suggested this option"
  - "CF kpi_name guard raises RuntimeError on revenue_eur (Guard 9 belt-and-suspenders even though counterfactual_fit.CF_KPIS already filters)"
  - "main_cf catches per-model exceptions and continues — partial success (4/5 models) is the D-06 contract"
  - "run_all.py CF dispatch is in-process (not subprocess) — counterfactual_fit.main_cf already isolates per-model failure; no second process layer needed"
metrics:
  tasks_completed: 5
  tasks_total: 5
  files_created: 2
  files_modified: 7
  duration_minutes: ~22
  completed_date: 2026-05-02
---

# Phase 16 Plan 05: Track-B Counterfactual Fit Orchestrator — Summary

Track-B (counterfactual) forecast fits land for all 5 BAU models via a new `--track={bau,cf,both}` flag on `scripts/forecast/run_all.py`, with the per-model fits sourcing from `kpi_daily_with_comparable_v.revenue_comparable_eur` capped at `min(campaign_calendar.start_date) − 7 days` per Phase 16 C-04 / D-01.

## What was built

| Component | File | Notes |
|---|---|---|
| CF orchestrator | `scripts/forecast/counterfactual_fit.py` (new) | `main_cf` + `get_train_end` + `fit_one_model` + `__main__` debug entry |
| Track flag | `scripts/forecast/run_all.py` | `--track={bau,cf,both}` (default `both`); `--train-end-offset` int (default `-7`) |
| Track-aware fits | `sarimax_fit.py`, `prophet_fit.py`, `ets_fit.py`, `theta_fit.py`, `naive_dow_fit.py` | new kwargs `track='bau'` and `train_end=None`; `_load_comparable_history` helper |
| Audit kwarg | `scripts/external/pipeline_runs_writer.py` | `fit_train_end: Optional[date]` on `write_success` / `write_failure` / `write_fallback` |
| Tests | `tests/forecast/test_counterfactual_fit.py` (new) | 6 tests: T-16-03 leak invariant, Guard 9 kpi_name guard, partial-failure resilience |

## Acceptance — must_haves.truths verification

All 6 frontmatter truths verified:

1. **`run_all.py supports --track={bau,cf,both} flag with default 'both'`** — argparse `choices=['bau','cf','both'], default='both'`; `main()` signature accepts `track='both', train_end_offset=-7`.
2. **Track-B fits write `forecast_track='cf'` rows for all 5 BAU models** — every per-model row builder now uses `'forecast_track': track` (replacing hardcoded `'bau'`). Confirmed via `grep -l "'forecast_track': track" scripts/forecast/*_fit.py` → 5 files.
3. **Every `cf_<model>` run writes a pipeline_runs row with `step_name='cf_<model>'` and `fit_train_end` populated** — `main_cf` calls `write_success(..., step_name=f'cf_{model}', fit_train_end=train_end)` on success and `write_failure(..., step_name=f'cf_{model}', fit_train_end=train_end)` on failure.
4. **`fit_train_end < min(campaign_calendar.start_date)` for every CF row** — `get_train_end` returns `earliest + timedelta(days=train_end_offset)` with default offset `-7`. CI test `test_no_campaign_era_leak` asserts `train_end < min(campaign_start)` for all 10 fit_one_model calls.
5. **CF sources from `kpi_daily_with_comparable_v.revenue_comparable_eur`, NEVER from raw `kpi_daily_mv.revenue_cents`** — each `_load_comparable_history` reads from `kpi_daily_with_comparable_v` only; the `kpi_name` guard raises RuntimeError if anyone passes `'revenue_eur'`. `CF_KPIS = ['revenue_comparable_eur', 'invoice_count']` excludes raw revenue.
6. **CF granularity is 'day' only (D-07)** — `CF_GRANULARITY = 'day'` in counterfactual_fit; per-module assertion `assert granularity == 'day'` when `track == 'cf'`.

## Tests

| Test | Result | Mitigates |
|---|---|---|
| `test_get_train_end_subtracts_default_seven_days` | PASS | C-04 / D-01 cutoff |
| `test_get_train_end_returns_none_when_no_campaign` | PASS | edge case (no campaign rows) |
| `test_no_campaign_era_leak` | PASS | **T-16-03** |
| `test_all_models_write_cf` | PASS | Guard 9 / D-04 |
| `test_cf_skipped_when_no_campaign` | PASS | D-06 graceful skip |
| `test_partial_failure_resilience` | PASS | **T-16-07** |
| `scripts/forecast/tests/test_run_all_grain_loop.py::test_run_all_loops_over_three_granularities` | PASS | BAU regression |
| `scripts/forecast/tests/test_run_all_grain_loop.py::test_freshness_gate_aborts_on_stale_data` | PASS | BAU regression |

`pytest scripts/forecast/tests/test_run_all_grain_loop.py tests/forecast/test_counterfactual_fit.py -x` → **8 passed**.

## Threat-register coverage (from plan frontmatter)

- **T-16-03** (Tampering — campaign-era leak): mitigated by `get_train_end` cutoff math + per-module `assert granularity == 'day'` + per-module SQL `lte('business_date', train_end.isoformat())`. Tested by `test_no_campaign_era_leak`.
- **T-16-07** (DoS / SARIMAX low-variance fallback): mitigated structurally by `main_cf`'s try/except + `write_failure(error_msg=traceback.format_exc())`. The smoke-test variant from the plan (#5) was deferred — `test_partial_failure_resilience` covers the resilience path generically (any model can raise; orchestrator continues), which is sufficient for the contract Plan 06 (`cumulative_uplift.py`) consumes.

## Deviations from plan

### Auto-fixed / KISS choices (Rule 2 / 3)

**1. [Rule 2 — Defensive] kpi_name guard inside `_load_comparable_history`**
- **Found during:** Task 4
- **Issue:** `counterfactual_fit.CF_KPIS` already constrains the kpi_name set, but a future caller (or a debug-time CLI invocation) could pass `'revenue_eur'` and silently produce a CF row sourced from raw revenue.
- **Fix:** Each `_load_comparable_history` raises `RuntimeError` on any kpi_name not in `{'revenue_comparable_eur', 'invoice_count'}`, citing Guard 9.
- **Files modified:** all 5 `*_fit.py` modules.
- **Commit:** `561a8b9`

**2. [Plan recommendation taken] `_load_comparable_history` copied per-module rather than extracted**
- **Found during:** Task 4
- **Reason:** The plan explicitly recommended copy-paste for the 4-line loader logic. Confirmed: extracting would introduce a new module dependency for a stable, terse helper. KISS preserved.

**3. [Rule 3 — Blocking workaround] Local Python env can't import supabase due to broken pydantic install**
- **Found during:** Task 3 verification of `python -m scripts.forecast.counterfactual_fit --help`
- **Issue:** Module import fails at `from supabase import create_client, Client` in `scripts/forecast/db.py` due to a system-pydantic install issue (pre-existing — affects `run_all.py --help` too).
- **Resolution:** Tests use the established supabase stub pattern from `test_run_all_grain_loop.py` to inject a fake `supabase` module; CI / DEV environment has a working supabase install. No code change needed.

### Test #5 (`test_sarimax_low_variance_fallback_logged`) — deliberately omitted

The plan listed this as a smoke test "skip-marked as a manual smoke test if too brittle." We omitted the test entirely:

- **Why:** Mocking SARIMAX's internal LinAlgError fallback would be brittle and stub-heavy (mocking `statsmodels.tsa.SARIMAX` constructor + `.fit()` + `.simulate()`). The fallback path is already exercised in production by Phase 14 BAU runs (different convergence inputs) and the failure-isolation behavior is covered by `test_partial_failure_resilience` (which proves: if any model raises, write_failure fires with `fit_train_end` populated and the orchestrator continues).
- **What's still covered:** The error-msg surfacing contract (`error_msg=traceback.format_exc()` → `pipeline_runs.error_msg`) is asserted by the partial-failure test (write_failure invoked with kwargs we control).
- **What Plan 06 needs:** Plan 06's `cumulative_uplift.py` reads `pipeline_runs.status` to decide whether a model contributed to the uplift estimate. That contract holds regardless of whether the SARIMAX-specific (0,1,0) fallback log is in `error_msg`.

If Plan 06 surfaces a need for the smoke test, a 1-test follow-up commit can add it without touching the contract.

## Auth gates

None — autonomous Python module changes only; no DB migration in this plan (Plan 04 already shipped `pipeline_runs.fit_train_end` and the comparable view).

## Known stubs

None — all helpers and assertions are wired end-to-end. The only behaviorally-empty branch is the `models not in CF_MODELS: continue` filter in `main_cf`, which is intentional (caller may pass extractor-side names that have no CF variant).

## Self-Check: PASSED

- [x] `scripts/forecast/counterfactual_fit.py` exists (created)
- [x] `tests/forecast/test_counterfactual_fit.py` exists (created)
- [x] `scripts/forecast/run_all.py` modified (track + train_end_offset args)
- [x] `scripts/external/pipeline_runs_writer.py` modified (fit_train_end kwarg on 3 writers)
- [x] All 5 `*_fit.py` modified (track + train_end kwargs + comparable-view loader)
- [x] All commits exist in `git log`: `448086f`, `561a8b9`, `7c3d809`, `413c8be`, `6abd883`
- [x] `pytest scripts/forecast/tests/test_run_all_grain_loop.py tests/forecast/test_counterfactual_fit.py -x` → **8 passed**
- [x] No `Co-authored-by` lines in this plan's commit messages
