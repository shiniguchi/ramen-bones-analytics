---
phase: 14-forecasting-engine-bau-track
reviewed: 2026-04-30T10:00:00Z
depth: standard
files_reviewed: 31
files_reviewed_list:
  - .github/workflows/forecast-refresh.yml
  - scripts/forecast/__init__.py
  - scripts/forecast/backfill_weather_history.py
  - scripts/forecast/closed_days.py
  - scripts/forecast/db.py
  - scripts/forecast/ets_fit.py
  - scripts/forecast/exog.py
  - scripts/forecast/last_7_eval.py
  - scripts/forecast/naive_dow_fit.py
  - scripts/forecast/prophet_fit.py
  - scripts/forecast/requirements.txt
  - scripts/forecast/run_all.py
  - scripts/forecast/sample_paths.py
  - scripts/forecast/sarimax_fit.py
  - scripts/forecast/tests/__init__.py
  - scripts/forecast/tests/conftest.py
  - scripts/forecast/tests/test_closed_days.py
  - scripts/forecast/tests/test_eval.py
  - scripts/forecast/tests/test_exog.py
  - scripts/forecast/tests/test_prophet_smoke.py
  - scripts/forecast/tests/test_sample_paths.py
  - scripts/forecast/tests/test_sarimax_smoke.py
  - scripts/forecast/theta_fit.py
  - supabase/migrations/0050_forecast_daily.sql
  - supabase/migrations/0051_forecast_quality.sql
  - supabase/migrations/0052_weather_climatology.sql
  - supabase/migrations/0053_forecast_daily_mv.sql
  - supabase/migrations/0054_forecast_with_actual_v.sql
  - supabase/migrations/0055_refresh_forecast_mvs.sql
  - supabase/migrations/0056_forecast_janitor.sql
  - tests/integration/tenant-isolation.test.ts
findings:
  critical: 7
  warning: 5
  info: 3
  total: 15
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-04-30T10:00:00Z
**Depth:** standard
**Files Reviewed:** 31
**Status:** issues_found

## Summary

Phase 14 implements a nightly forecasting pipeline with 5 statistical models writing to `forecast_daily`. The code structure is well-organized with consistent patterns across model scripts, proper subprocess isolation, and good RLS + REVOKE security on new tables. However, the implementation has multiple **critical schema mismatch bugs** between Python code and the actual Postgres table definitions. These mismatches mean the pipeline will fail at runtime with column-not-found errors or write to nonexistent columns. The `forecast_with_actual_v` view will also fail to create during migration because it references columns that do not exist on `kpi_daily_mv`.

## Critical Issues

### CR-01: forecast_with_actual_v references nonexistent columns on kpi_daily_mv

**File:** `supabase/migrations/0054_forecast_with_actual_v.sql:7-10`
**Issue:** The view joins `kpi_daily_mv k` and references `k.kpi_name`, `k.date`, and `k.value`. The actual `kpi_daily_mv` (defined in migration 0011) has columns `restaurant_id`, `business_date`, `revenue_cents`, `tx_count`, `avg_ticket_cents`. There is no `kpi_name`, `date`, or `value` column. This migration will fail on apply with a "column does not exist" error.
**Fix:** The view must be redesigned to match the actual MV schema. Since `kpi_daily_mv` stores wide-form columns (revenue_cents, tx_count), the join needs to unpivot or the MV needs to be redesigned. Example fix using CASE:
```sql
CREATE OR REPLACE VIEW public.forecast_with_actual_v AS
SELECT
    f.restaurant_id, f.kpi_name, f.target_date, f.model_name, f.forecast_track,
    f.run_date, f.yhat, f.yhat_lower, f.yhat_upper, f.horizon_days, f.exog_signature,
    CASE f.kpi_name
        WHEN 'revenue_eur' THEN k.revenue_cents / 100.0
        WHEN 'invoice_count' THEN k.tx_count::double precision
    END AS actual_value
FROM public.forecast_daily_mv f
LEFT JOIN public.kpi_daily_mv k
    ON k.restaurant_id = f.restaurant_id
    AND k.business_date = f.target_date
WHERE f.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid;
```

### CR-02: All model scripts query kpi_daily_mv with wrong column names

**File:** `scripts/forecast/sarimax_fit.py:44-59`, `scripts/forecast/prophet_fit.py:39-55`, `scripts/forecast/ets_fit.py:38-56`, `scripts/forecast/theta_fit.py:39-57`, `scripts/forecast/naive_dow_fit.py:38-56`
**Issue:** Every `_fetch_history()` function queries `kpi_daily_mv` for columns `date`, `revenue_eur`, `invoice_count`, and `is_open`. The actual MV has `business_date`, `revenue_cents`, `tx_count`, `avg_ticket_cents`. There is no `is_open` column. The Supabase client will return empty data or error because these columns do not exist.
**Fix:** Either add a new migration to rebuild `kpi_daily_mv` with the expected column names (aliased), or update all Python code to use the actual column names. Example for _fetch_history:
```python
resp = (
    client.table('kpi_daily_mv')
    .select('business_date,revenue_cents,tx_count')
    .eq('restaurant_id', restaurant_id)
    .order('business_date')
    .execute()
)
# Then rename columns in the DataFrame:
df.rename(columns={'business_date': 'date'}, inplace=True)
df['revenue_eur'] = df['revenue_cents'] / 100.0
df['invoice_count'] = df['tx_count']
```
The `is_open` column must be sourced from `shop_calendar` via a separate query or by joining at the DB level.

### CR-03: exog.py weather columns do not match weather_daily table schema

**File:** `scripts/forecast/exog.py:10-14`
**Issue:** `EXOG_COLUMNS` and `WEATHER_COLS` reference `temp_mean_c`, `precip_mm`, `wind_max_kmh`, `sunshine_hours`. The actual `weather_daily` table (migration 0041) has columns `temp_min_c`, `temp_max_c`, `precip_mm`, `wind_kph`, `cloud_cover`. Missing: `temp_mean_c` (needs computed from min/max), `wind_max_kmh` (table has `wind_kph`), `sunshine_hours` (table has `cloud_cover` instead). The `select('*')` on line 98 will return the actual columns, and the exog builder will silently fall back to climatology norms for every date because the expected column names never match.
**Fix:** Either alter `weather_daily` to add the expected columns, or update the Python code to map from the actual schema:
```python
WEATHER_COL_MAP = {
    'temp_mean_c': lambda df: (df['temp_min_c'] + df['temp_max_c']) / 2,
    'precip_mm': lambda df: df['precip_mm'],
    'wind_max_kmh': lambda df: df['wind_kph'],  # or apply unit conversion
    'sunshine_hours': lambda df: ...,  # derive from cloud_cover or add column
}
```

### CR-04: backfill_weather_history.py writes columns that do not exist on weather_daily

**File:** `scripts/forecast/backfill_weather_history.py:105-113`
**Issue:** The backfill upserts rows with columns `temp_mean_c`, `sunshine_min`, and `is_forecast` into `weather_daily`. The table has `temp_min_c`, `temp_max_c`, `cloud_cover`, `provider`, `location` (all NOT NULL). It does not have `temp_mean_c`, `sunshine_min`, or `is_forecast`. The upsert will fail with "column does not exist" or NOT NULL constraint violations for missing `location` and `provider`.
Additionally, `on_conflict="date"` on line 125 is wrong -- the PK is `(date, location)`, so the conflict target must include both columns.
**Fix:** Rewrite the upsert payload to match the actual table schema, and include `location` and `provider`:
```python
rows.append({
    "date": day_str,
    "location": "berlin",
    "temp_min_c": ...,
    "temp_max_c": ...,
    "precip_mm": round(d["precip_sum"], 2),
    "wind_kph": ...,
    "cloud_cover": ...,
    "provider": "brightsky",
})
# ...
client.table("weather_daily").upsert(rows, on_conflict="date,location").execute()
```

### CR-05: backfill_weather_history.py writes wrong column name to weather_climatology

**File:** `scripts/forecast/backfill_weather_history.py:176-197`
**Issue:** The climatology upsert writes column `doy` (line 178) and uses `on_conflict="doy"` (line 197). The actual `weather_climatology` table (migration 0052) uses `day_of_year` as the PK column name. Also writes `sunshine_min` but the table expects `sunshine_hours`. And the table requires `sample_years integer NOT NULL` but the backfill never writes this column, causing a NOT NULL constraint violation.
**Fix:**
```python
clim_rows.append({
    "day_of_year": doy,           # not "doy"
    "temp_mean_c": ...,
    "precip_mm": ...,
    "wind_max_kmh": ...,
    "sunshine_hours": ...,        # not "sunshine_min"
    "sample_years": b["temp_count"],  # or appropriate count
})
# ...
client.table("weather_climatology").upsert(clim_rows, on_conflict="day_of_year").execute()
```

### CR-06: last_7_eval.py writes wrong column names to forecast_quality

**File:** `scripts/forecast/last_7_eval.py:178-192`
**Issue:** The `quality_row` dict uses keys `eval_date`, `window_start`, `window_end`, and `n_obs`. The `forecast_quality` table (migration 0051) has `evaluated_at` (timestamptz), `n_days` (integer), and no `window_start`/`window_end` columns. Also `eval_date` is written as a date string but `evaluated_at` is timestamptz. The upsert will either fail or silently drop these columns. The table's PK includes `evaluated_at` which defaults to `now()`, so if `eval_date` is silently ignored, the upsert might succeed but with wrong semantics.
**Fix:**
```python
quality_row = {
    'restaurant_id': restaurant_id,
    'kpi_name': kpi_name,
    'model_name': model_name,
    'evaluated_at': datetime.now(timezone.utc).isoformat(),  # not 'eval_date'
    'n_days': len(aligned_actuals),  # not 'n_obs'
    'rmse': round(metrics['rmse'], 4),
    'mape': round(metrics['mape'], 4),
    'mean_bias': round(metrics['mean_bias'], 4),
    'direction_hit_rate': round(metrics['direction_hit_rate'], 4),
    'horizon_reliability_cutoff': horizon_cutoff,
    # Remove window_start and window_end -- not in schema
}
```

### CR-07: Prophet sample paths shape assumption may be inverted

**File:** `scripts/forecast/prophet_fit.py:221-225`
**Issue:** The code assumes `m.predictive_samples(future_df)['yhat']` returns shape `(N_PATHS, HORIZON)` and transposes it to `(HORIZON, N_PATHS)`. However, Prophet's `predictive_samples()` actually returns shape `(HORIZON, N_PATHS)` -- each row is a forecast date, each column is a sample path. Transposing would produce `(N_PATHS, HORIZON)` which reverses the intended axis. The assertion on line 225 would then fail in production. The smoke test on line 45-49 of `test_prophet_smoke.py` also assumes the wrong shape convention (transposes `yhat.T`), so the test would pass with the same wrong assumption, but both test and production code would produce incorrect forecasts if the actual Prophet output shape differs from assumption.
**Fix:** Verify the actual Prophet `predictive_samples` output shape empirically and remove the transpose if it already returns `(HORIZON, N_PATHS)`:
```python
yhat_samples = raw['yhat']
# Prophet predictive_samples returns (n_forecast_dates, n_samples)
# which is already (HORIZON, N_PATHS) -- no transpose needed
samples = yhat_samples
assert samples.shape == (HORIZON, N_PATHS), f'Unexpected samples shape: {samples.shape}'
```

## Warnings

### WR-01: GHA workflow MODELS input not validated before passing to subprocess

**File:** `.github/workflows/forecast-refresh.yml:44-60`
**Issue:** The comment on line 46 says "Validate models input against a safe pattern before forwarding to argparse" but no validation is performed. `DATE_RE` is defined on line 55 but never used. The `MODELS` env var from `workflow_dispatch` input is passed directly to argparse via `--models "$MODELS"`. While argparse itself provides some protection, the comment promises validation that does not exist. A malicious `workflow_dispatch` caller could inject unexpected model names that would be passed as `python -m scripts.forecast.{model}_fit`, potentially causing unexpected module imports.
**Fix:** Add regex validation:
```bash
if [ -n "${MODELS:-}" ]; then
    if ! echo "$MODELS" | grep -qE '^[a-z_]+(,[a-z_]+)*$'; then
        echo "ERROR: MODELS must be comma-separated lowercase identifiers" >&2
        exit 1
    fi
    ARGS+=("--models" "$MODELS")
fi
```

### WR-02: run_all.py does not invoke last_7_eval -- forecast_quality is never populated

**File:** `scripts/forecast/run_all.py`
**Issue:** The orchestrator iterates models x KPIs and spawns fit subprocesses, but never calls `last_7_eval.evaluate_last_7()`. The `forecast_quality` table will remain empty permanently. The GHA workflow also does not invoke `last_7_eval` as a separate step. This means the forecast accuracy tracking system is implemented but inert.
**Fix:** Add an evaluation pass after all models complete:
```python
from scripts.forecast.last_7_eval import evaluate_last_7

# After the model loop:
for model in models:
    for kpi in KPIS:
        try:
            evaluate_last_7(client, restaurant_id=restaurant_id,
                           kpi_name=kpi, model_name=model)
        except Exception as e:
            print(f'[run_all] eval {model}/{kpi} failed: {e}', file=sys.stderr)
```

### WR-03: forecast_daily_mv omits yhat_samples -- janitor's NULL-cleanup is redundant for MV consumers

**File:** `supabase/migrations/0053_forecast_daily_mv.sql:1-6`
**Issue:** The MV intentionally omits `yhat_samples` (the largest column), but `forecast_with_actual_v` (which sits on top of this MV) also inherits this omission. If the frontend ever needs sample paths for CI band rendering, it would need to query `forecast_daily` directly, bypassing the RLS-enforced MV. Meanwhile the janitor (0056) NULLs out `yhat_samples` on the raw table for old run_dates, which is good for storage, but the MV already strips them -- the janitor only helps direct `forecast_daily` queries that also need sample paths from the latest run. The lack of GRANT on the MV (line 11 `REVOKE ALL`) means authenticated users cannot query it at all -- they must go through `forecast_with_actual_v`. But that view itself will fail (see CR-01).
**Fix:** Verify intended access path. If `forecast_with_actual_v` is the sole read path, ensure it works (fix CR-01). If sample paths are needed for CI bands, add them to the MV or create a separate thin view on `forecast_daily` with RLS.

### WR-04: Supabase query pagination may silently truncate kpi_daily_mv history

**File:** `scripts/forecast/sarimax_fit.py:43-50` (same pattern in all 5 model files and `last_7_eval.py:107-115`)
**Issue:** Supabase's PostgREST client defaults to returning at most 1000 rows per query (configurable but default). If a restaurant has >1000 days of history, `_fetch_history()` will silently return only the first 1000 rows without error. The training data will be truncated, leading to subtly wrong model fits. The same issue affects weather_daily queries in `exog.py` line 96-102 (could exceed 1000 rows over a 365-day predict window + multi-year history).
**Fix:** Add `.limit(100000)` or paginate with `.range()`:
```python
resp = (
    client.table('kpi_daily_mv')
    .select('...')
    .eq('restaurant_id', restaurant_id)
    .order('date')
    .limit(10000)  # explicit limit beyond expected max
    .execute()
)
```

### WR-05: backfill_weather_history validate_no_large_gaps fetches all dates without limit

**File:** `scripts/forecast/backfill_weather_history.py:210-215`
**Issue:** The validation query fetches all dates from `weather_daily` without a filter for `is_forecast` or date range. If there are forecast rows (which the backfill writes with `is_forecast=False` but other parts of the system may write with `True`), gaps between historical and forecast rows could create false positives. Additionally, this query is subject to the Supabase 1000-row default limit (same issue as WR-04), which would cause the validation to miss gaps beyond the first 1000 dates.
**Fix:** Filter to historical rows only and add explicit limit:
```python
resp = (
    client.table("weather_daily")
    .select("date")
    .eq("is_forecast", False)
    .order("date")
    .limit(10000)
    .execute()
)
```
(This fix itself depends on the `is_forecast` column existing, which is blocked by CR-04.)

## Info

### IN-01: Dead variable DATE_RE in GHA workflow

**File:** `.github/workflows/forecast-refresh.yml:55`
**Issue:** `DATE_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}$'` is defined but never referenced anywhere in the script. This is dead code.
**Fix:** Either remove the variable or implement the validation it was intended for.

### IN-02: Extensive code duplication across model fit scripts

**File:** `scripts/forecast/sarimax_fit.py`, `ets_fit.py`, `theta_fit.py`, `naive_dow_fit.py`, `prophet_fit.py`
**Issue:** `_fetch_history()`, `_fetch_shop_calendar()`, `_upsert_rows()`, `_open_future_dates()`, and `_build_forecast_rows()` are copy-pasted across all 5 model scripts with near-identical implementations. The `__main__` block (env var parsing, error handling, write_success/write_failure) is also duplicated verbatim. This increases maintenance burden and the risk of inconsistent fixes.
**Fix:** Extract shared functions into a `scripts/forecast/common.py` module and have each model script import them. The `__main__` template could be a shared `run_model_main(fit_and_write_fn, step_name)` helper.

### IN-03: weather_climatology columns in weather_daily table require schema alignment

**File:** `supabase/migrations/0052_weather_climatology.sql` vs `supabase/migrations/0041_weather_daily.sql`
**Issue:** `weather_climatology` has `wind_max_kmh` and `sunshine_hours`, while `weather_daily` has `wind_kph` and `cloud_cover`. These represent the same semantic concepts (wind speed, solar exposure) but with different column names and potentially different units/metrics. The exog cascade in `exog.py` tries to fall back from `weather_daily` to `weather_climatology`, but the column name differences mean these two tables are not interchangeable even conceptually.
**Fix:** Harmonize column naming across both tables. If `weather_daily` predates phase 14, add a migration to add the missing columns (`temp_mean_c`, `wind_max_kmh`, `sunshine_hours`) or create a view that computes them.

---

_Reviewed: 2026-04-30T10:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
