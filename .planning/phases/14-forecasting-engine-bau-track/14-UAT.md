---
status: complete
phase: 14-forecasting-engine-bau-track
source: design doc FCS-01 through FCS-08, code inspection
started: 2026-04-30T10:30:00Z
updated: 2026-04-30T10:35:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start: Python Tests Pass
expected: All 17 Python unit tests pass from clean state (2 Prophet skipped on 3.8)
result: pass
evidence: 17 passed, 2 skipped, 0 failures (pytest scripts/forecast/tests/ -v)

### 2. FCS-01: forecast_daily Schema
expected: Table has composite PK, jsonb yhat_samples, generated horizon_days, forecast_track column, RLS on restaurant_id, REVOKE INSERT/UPDATE/DELETE from authenticated/anon
result: pass
evidence: Migration 0050 verified — all columns, PK, RLS policy, REVOKE present

### 3. FCS-02: forecast_quality + Evaluator Integration
expected: forecast_quality table exists with evaluation_window PK discriminator, horizon_reliability_cutoff, and run_all.py calls evaluate_last_7 after model fits
result: pass
evidence: Migration 0051 verified. run_all.py imports and calls evaluate_last_7() in post-fit loop

### 4. FCS-03: Prophet yearly_seasonality Pin
expected: Prophet(yearly_seasonality=False) in code AND test assertion verifying it
result: pass
evidence: prophet_fit.py has yearly_seasonality=False (2 occurrences). test_prophet_smoke.py asserts yearly_seasonality=False

### 5. FCS-04: SARIMAX Exog Consistency
expected: assert_exog_compatible(fit_df, predict_df) called before forecast, checks columns + dtypes
result: pass
evidence: sarimax_fit.py imports and calls assert_exog_compatible(X_fit, X_pred). exog.py defines the function checking columns, dtypes, shape

### 6. FCS-05: MV + Wrapper View RLS Scoping
expected: forecast_daily_mv has REVOKE ALL + unique index, forecast_with_actual_v filters by auth.jwt()->>'restaurant_id'
result: pass
evidence: Migration 0053 has CREATE UNIQUE INDEX + REVOKE ALL. Migration 0054 has WHERE restaurant_id = (auth.jwt()->>'restaurant_id')::uuid + CASE unpivot for actual_value

### 7. FCS-06: GHA Workflow Cron + Timeout
expected: Cron 0 1 * * * UTC, 15-minute timeout, workflow_dispatch with models input, pip cache
result: pass
evidence: forecast-refresh.yml has cron: '0 1 * * *', timeout-minutes: 15, workflow_dispatch with models input, actions/cache@v4

### 8. FCS-07: pipeline_runs Per Model
expected: Each model writes one pipeline_runs row via write_success/write_failure with distinct step_name
result: pass
evidence: All 5 models import write_success/write_failure, each has unique STEP_NAME (forecast_sarimax, forecast_prophet, forecast_ets, forecast_theta, forecast_naive_dow)

### 9. FCS-08: Backfill Gap Validation Exit
expected: backfill_weather_history.py exits non-zero if weather_daily has gaps >7 consecutive days
result: pass
evidence: validate_no_large_gaps() returns False on gap > MAX_GAP_DAYS (7). main() returns 1 on False. sys.exit(main()) exits non-zero

### 10. Schema Alignment: Python ↔ Postgres
expected: All Python code references columns that actually exist in the target Postgres tables (post code-review-fix)
result: pass
evidence: Code review found 7 critical schema mismatches (CR-01 through CR-07). All fixed in 10 atomic commits. Post-fix verification: sarimax_fit.py queries business_date/revenue_cents/tx_count, exog.py derives temp_mean_c from temp_min_c+temp_max_c, last_7_eval writes evaluated_at/n_days, forecast_with_actual_v uses CASE unpivot

### 11. Tenant Isolation Integration Tests
expected: 8 integration test cases covering A/B isolation for forecast_daily, forecast_quality, forecast_with_actual_v, and INSERT denial for authenticated role
result: pass
evidence: tenant-isolation.test.ts has FCT-08 describe block with 8 test cases (2 per table for A/B + 2 INSERT denial tests)

### 12. 5 Models Complete
expected: All 5 model scripts exist (sarimax, prophet, ets, theta, naive_dow) with fit_and_write entry points
result: pass
evidence: All 5 *_fit.py files present with fit_and_write() function and __main__ subprocess entry

## Summary

total: 12
passed: 12
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
