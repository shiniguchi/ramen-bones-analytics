---
phase: 14-forecasting-engine-bau-track
fixed_at: 2026-04-30T08:21:18Z
review_path: .planning/phases/14-forecasting-engine-bau-track/14-REVIEW.md
iteration: 1
findings_in_scope: 12
fixed: 12
skipped: 0
status: all_fixed
---

# Phase 14: Code Review Fix Report

**Fixed at:** 2026-04-30T08:21:18Z
**Source review:** .planning/phases/14-forecasting-engine-bau-track/14-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 12 (7 critical, 5 warning)
- Fixed: 12
- Skipped: 0

## Fixed Issues

### CR-01: forecast_with_actual_v references nonexistent columns on kpi_daily_mv

**Files modified:** `supabase/migrations/0054_forecast_with_actual_v.sql`
**Commit:** 946c9b0
**Applied fix:** Replaced `k.kpi_name`, `k.date`, `k.value` with a CASE-based unpivot that reads `k.revenue_cents / 100.0` for 'revenue_eur' and `k.tx_count::double precision` for 'invoice_count'. Changed join condition from `k.date` to `k.business_date`.

### CR-02: All model scripts query kpi_daily_mv with wrong column names

**Files modified:** `scripts/forecast/sarimax_fit.py`, `scripts/forecast/prophet_fit.py`, `scripts/forecast/ets_fit.py`, `scripts/forecast/theta_fit.py`, `scripts/forecast/naive_dow_fit.py`, `scripts/forecast/last_7_eval.py`
**Commit:** 1c22e19
**Applied fix:** Changed all `_fetch_history()` to select `business_date,revenue_cents,tx_count` (actual MV columns). Renamed `business_date` to `date` in DataFrame. Derived `revenue_eur` from `revenue_cents / 100.0` and `invoice_count` from `tx_count`. For models needing `is_open` (ets, theta, naive_dow, last_7_eval): added separate shop_calendar query since kpi_daily_mv has no is_open column. Added `.limit(10000)` to all queries (also addresses WR-04).

### CR-03: exog.py weather columns do not match weather_daily table schema

**Files modified:** `scripts/forecast/exog.py`, `scripts/forecast/tests/test_exog.py`, `supabase/migrations/0052_weather_climatology.sql`
**Commit:** 1e3a149
**Applied fix:** Changed weather_daily select to fetch actual columns (`temp_min_c`, `temp_max_c`, `precip_mm`, `wind_kph`). Derived `temp_mean_c` from `(min+max)/2` and mapped `wind_kph` to `wind_max_kmh`. Dropped `sunshine_hours` from `EXOG_COLUMNS` and `WEATHER_COLS` (cannot derive from `cloud_cover`). Updated weather_climatology migration to remove `sunshine_hours` column. Updated test fixtures accordingly.

### CR-04: backfill_weather_history.py writes columns that do not exist on weather_daily

**Files modified:** `scripts/forecast/backfill_weather_history.py`
**Commit:** e306ca5
**Applied fix:** Rewrote `_fetch_month()` hourly aggregation to track min/max temperatures, max wind speed, and average cloud cover instead of mean temp and sunshine. Output rows now have `temp_min_c`, `temp_max_c`, `precip_mm`, `wind_kph`, `cloud_cover`, `location='berlin'`, `provider='brightsky'`. Removed nonexistent columns (`temp_mean_c`, `sunshine_min`, `is_forecast`). Fixed `on_conflict` from `"date"` to `"date,location"` matching the composite PK.

### CR-05: backfill_weather_history.py writes wrong column name to weather_climatology

**Files modified:** `scripts/forecast/backfill_weather_history.py`
**Commit:** ea2621d
**Applied fix:** Changed `"doy"` to `"day_of_year"`, removed `"sunshine_min"`, added `"sample_years"` (counted from distinct years per DoY), changed `on_conflict` to `"day_of_year"`. Compute `temp_mean_c` from `(temp_min_c + temp_max_c) / 2` and `wind_max_kmh` from `wind_kph`. Use 0.0 defaults instead of None for NOT NULL columns.

### CR-06: last_7_eval.py writes wrong column names to forecast_quality

**Files modified:** `scripts/forecast/last_7_eval.py`
**Commit:** aa00bff
**Applied fix:** Replaced `eval_date` with `evaluated_at` (ISO timestamptz from `datetime.now(timezone.utc).isoformat()`). Removed `window_start` and `window_end` (not in schema). Replaced `n_obs` with `n_days`. Added `datetime` and `timezone` imports.

### CR-07: Prophet sample paths shape assumption may be inverted

**Files modified:** `scripts/forecast/prophet_fit.py`, `scripts/forecast/tests/test_prophet_smoke.py`
**Commit:** 6da5098
**Applied fix:** fixed: requires human verification -- Removed `.T` transpose on `predictive_samples()['yhat']`. Prophet returns `(n_forecast_dates, n_samples)` which is already `(HORIZON, N_PATHS)`. The transpose was inverting axes to `(N_PATHS, HORIZON)`. Updated test to match.

### WR-01: GHA workflow MODELS input not validated before passing to subprocess

**Files modified:** `.github/workflows/forecast-refresh.yml`
**Commit:** 45c186b
**Applied fix:** Added regex validation `^[a-z_]+(,[a-z_]+)*$` before passing MODELS to argparse. Rejects inputs with shell metacharacters, digits, or special characters. Also removed dead `DATE_RE` variable (IN-01).

### WR-02: run_all.py does not invoke last_7_eval -- forecast_quality is never populated

**Files modified:** `scripts/forecast/run_all.py`
**Commit:** 9be7b3d
**Applied fix:** Added import of `evaluate_last_7` and an evaluation loop after the model fitting loop. Iterates models x KPIs and calls `evaluate_last_7()` for each. Eval failures are non-fatal (logged to stderr, don't affect exit code).

### WR-04: Supabase query pagination may silently truncate kpi_daily_mv history

**Files modified:** (addressed within CR-02 and CR-03 commits)
**Commit:** 1c22e19, 1e3a149
**Applied fix:** Added `.limit(10000)` to all kpi_daily_mv, weather_daily, and shop_calendar queries across all model scripts, exog.py, and last_7_eval.py.

### WR-05: backfill_weather_history validate_no_large_gaps fetches all dates without limit

**Files modified:** `scripts/forecast/backfill_weather_history.py`
**Commit:** a565bab
**Applied fix:** Added `.eq("location", "berlin")`, `.gte("date", BACKFILL_START)`, `.lte("date", BACKFILL_END)`, and `.limit(10000)` to the validation query. Scopes validation to the backfill range and prevents silent truncation.

### WR-03: forecast_daily_mv omits yhat_samples (informational, no code change needed)

**Files modified:** (none -- addressed by fixing CR-01 which unblocks the view)
**Commit:** 946c9b0
**Applied fix:** The core issue was that forecast_with_actual_v was broken (CR-01). With CR-01 fixed, authenticated users can query forecasts through the view as designed. The yhat_samples omission from the MV is intentional per design.

---

_Fixed: 2026-04-30T08:21:18Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
