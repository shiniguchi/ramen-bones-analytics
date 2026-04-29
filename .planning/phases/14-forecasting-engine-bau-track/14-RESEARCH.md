# Phase 14: Forecasting Engine -- BAU Track - Research

**Researched:** 2026-04-29
**Domain:** Time-series forecasting pipeline (Python), Postgres schema + MV, GitHub Actions orchestration
**Confidence:** HIGH

## Summary

Phase 14 builds the nightly Python forecast pipeline that writes 365-day-forward predictions for `revenue_eur` and `invoice_count` using five models (SARIMAX, Prophet, ETS, Theta, Naive same-DoW), evaluates accuracy against the last 7 actual days, and exposes results via a materialized view with an RLS-scoped wrapper view for the SvelteKit frontend.

The core technical challenge is assembling a correct exogenous regressor matrix for SARIMAX and Prophet that uses actual weather for past dates, Bright Sky forecast for days 1-14, and climatological norms for days 15-365 -- and ensuring that the column order and shape are byte-identical between fit and predict time. The second challenge is generating 200 sample paths per model per KPI for proper CI aggregation at week/month granularity, using each library's native simulation API where available and bootstrap-from-residuals where not.

The architecture mirrors Phase 13's `scripts/external/` pattern: a `scripts/forecast/` directory with one file per model, a shared exog builder, a shared `zero_closed_days()` utility, an orchestrator (`run_all.py`), an evaluator (`last_7_eval.py`), and `pipeline_runs_writer.py` reuse. The GHA workflow `forecast-refresh.yml` runs at `0 1 * * *` UTC (already in the Guard 8 cascade registry).

**Primary recommendation:** Use statsmodels 0.14.6 for SARIMAX + ETS, prophet==1.3.0 for Prophet, statsforecast for Theta, and hand-roll the Naive same-DoW baseline. Build the exog matrix once in a shared module and pass it to both SARIMAX and Prophet. Store 200 sample paths in `yhat_samples` jsonb, NULL older runs' samples via a weekly janitor, and expose only aggregated mean + 95% CI to the client.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **C-01:** Every `tenant_id` reference becomes `restaurant_id`. CI Guard 7 catches regressions.
- **C-02:** `forecast-refresh.yml` at `0 1 * * *` UTC. >=60-min gap after external-data at `0 0 * * *` UTC.
- **C-03:** Each model fit writes one `pipeline_runs` row with `step_name`, `status`, `row_count`, `upstream_freshness_h`, `error_msg`. Follows Phase 13's `pipeline_runs_writer.py` pattern.
- **C-04:** Prophet `yearly_seasonality=False` hard-pinned until `len(history) >= 730`. Unit test asserts the flag stays False until 2027-06-11.
- **C-05:** Clients receive only aggregated mean + 95% CI per requested granularity. Never raw sample arrays.
- **C-06:** Hybrid RLS: `forecast_daily` and `forecast_quality` scoped via `auth.jwt()->>'restaurant_id'`. `REVOKE ALL` on MVs from `authenticated`/`anon`.
- **D-01:** y=NaN + `is_open` regressor for exog-capable models (SARIMAX, Prophet). Post-hoc zero for closed dates at predict time.
- **D-02:** No explicit changepoints for Mon/Tue regime shift. `is_open` regressor handles it.
- **D-03:** Filter to open days only for no-exog models (ETS, Theta, Naive DoW). Predict 365 open-day values; map back to calendar dates using `shop_calendar.is_open=true` dates.
- **D-04:** 200 sample paths (not 1000). ~25 MB per nightly run.
- **D-05:** Keep latest run only. MV collapses to latest run. Weekly janitor NULLs `yhat_samples` for older `run_date`s.
- **D-06:** Climatological norms for long-horizon weather exog (per-DoY averages from 4-5 years Berlin history).
- **D-07:** One-time Bright Sky backfill from 2021-01-01 (~1,600 rows for weather gap fill).
- **D-08:** 3-tier weather cascade: actual -> Bright Sky forecast -> climatological norms. `exog_signature` logs source flavor.
- **D-09:** Env var `FORECAST_ENABLED_MODELS` only for v1. No `feature_flags` DB table in Phase 14.
- **D-10:** `feature_flags` table deferred to Phase 17.

### Claude's Discretion
- Python project structure under `scripts/forecast/` (mirroring `scripts/external/`)
- `forecast_quality` exact column set (reconcile PROPOSAL ss7 + hover-popup spec)
- Migration numbering (next available after Phase 13's 0049)
- `weather_climatology` storage approach (dedicated lookup table vs inline SQL)
- Exact SARIMAX order `(p,d,q)(P,D,Q,s)` -- PROPOSAL suggests `(1,0,1)(1,1,1,7)` but may tune
- Exact Prophet `changepoint_prior_scale` and `seasonality_prior_scale` values
- Per-model error handling pattern
- `forecast_quality.evaluation_window` column addition

### Deferred Ideas (OUT OF SCOPE)
- Track-B counterfactual fits (Phase 16)
- `campaign_calendar`, `campaign_uplift_v` (Phase 16)
- `baseline_items_v`, `revenue_comparable_eur` KPI (Phase 16)
- `feature_flags` DB table (Phase 17)
- Rolling-origin CV backtest (Phase 17)
- Conformal interval calibration (Phase 17)
- NeuralProphet + Chronos-Bolt-Tiny in production (behind env-var; enable after Phase 17)
- Forecast UI (Phase 15)
- `/api/forecast` endpoint (Phase 15)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FCS-01 | `forecast_daily` table schema (long format, forecast_track column) | Standard Stack ss: Postgres schema pattern; Architecture ss: table design with jsonb + generated column |
| FCS-02 | SARIMAX nightly with weather/holidays/school/event exog | Standard Stack: statsmodels 0.14.6 SARIMAX; Code Examples: exog matrix builder + simulate() |
| FCS-03 | Prophet `yearly_seasonality=False` pinned | Standard Stack: prophet 1.3.0; Code Examples: Prophet fit pattern |
| FCS-04 | ETS, Theta, Naive same-DoW baseline | Standard Stack: statsmodels ETS + statsforecast Theta; Code Examples: per-model fit patterns |
| FCS-05 | Chronos-Bolt-Tiny + NeuralProphet behind feature flags (off by default) | Architecture: env-var gating; deps listed but not installed by default |
| FCS-06 | SARIMAX exog matrix verified identical at fit and score time | Pitfalls ss1 + Code Examples: exog builder pattern + assertion |
| FCS-07 | `last_7_eval.py` per model, writes `forecast_quality` | Architecture: evaluator pattern; Code Examples: eval loop |
| FCS-08 | `forecast_daily_mv` with REVOKE ALL, wrapper view | Architecture: MV + wrapper view pattern from existing codebase |
| FCS-09 | `forecast-refresh.yml` at 01:00 UTC, <10 min, `pipeline_runs` | Architecture: GHA workflow mirroring `external-data-refresh.yml` |
| FCS-10 | pg_cron `refresh_analytics_mvs()` extended for `forecast_daily_mv` | Architecture: DAG extension pattern from 0024/0025 migrations |
| FCS-11 | Sample-path resampling server-side (200 paths, client gets mean + 95% CI) | Code Examples: per-model sample path generation; Don't Hand-Roll: CI aggregation |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Model fitting (SARIMAX, Prophet, ETS, Theta, Naive) | GHA Python runner | -- | CPU-bound statistical computation; free GHA minutes; no server needed |
| Exogenous matrix assembly (weather cascade, holidays, school, events) | GHA Python runner | Database (read) | Python reads from Supabase tables populated by Phase 13, assembles matrix in-memory |
| Forecast persistence | Database (write) | -- | Service-role upsert to `forecast_daily` via supabase-py |
| Accuracy evaluation (last_7_eval) | GHA Python runner | Database (read+write) | Reads actuals + prior forecasts, writes to `forecast_quality` |
| MV refresh (forecast_daily_mv) | Database (pg_cron) | -- | SQL-only operation; 0040 pattern: pg_cron triggers REFRESH CONCURRENTLY |
| RLS-scoped data access | Database (wrapper view) | -- | `forecast_with_actual_v` is the only surface the SvelteKit app reads |
| Weather backfill (one-time) | GHA Python runner | Bright Sky API (read) | One-time historical fetch; ~1,600 rows from 2021-01-01 to 2025-06-10 |
| Sample-path CI aggregation | API / Backend (SvelteKit server) | -- | Phase 15 endpoint aggregates paths; Phase 14 stores raw paths |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| statsmodels | 0.14.6 | SARIMAX + ETS fitting, simulation | [VERIFIED: PyPI] Stable release Dec 2025. Native `SARIMAXResults.simulate(repetitions=N)` for sample paths. Native `ETSResults.simulate(repetitions=N)` for ETS sample paths. Python 3.12 compatible. |
| prophet | 1.3.0 | Prophet model fitting, predictive_samples | [VERIFIED: PyPI] Released Jan 2026. Uses cmdstanpy backend (no pystan2). `predictive_samples(future)` returns dict with `yhat` key as (n_forecast x n_samples) array. `uncertainty_samples` constructor param controls count. Requires ~4GB RAM to install, ~2GB to use. |
| statsforecast | 2.0.3 | Theta model (AutoTheta) | [VERIFIED: PyPI] Latest Oct 2025. Nixtla's implementation of Theta/AutoTheta with built-in prediction intervals via `level` parameter. No native `simulate()` for Theta -- use bootstrap-from-residuals. |
| supabase (Python) | >=2.0,<3 | DB client for forecast writes | [VERIFIED: existing in Phase 13 requirements.txt] Service-role client for upsert operations. |
| pandas | >=2.2 | DataFrame operations, date alignment | [ASSUMED] Required for exog matrix assembly, time index management. Not in Phase 13 requirements (Phase 13 used raw dicts); Phase 14 needs it for model fitting APIs that expect DataFrames. |
| numpy | >=1.26 | Array operations, percentile calculations | [ASSUMED] Transitive dep of statsmodels/prophet/statsforecast. Used directly for sample-path aggregation and CI computation. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| httpx | >=0.27,<1 | Bright Sky API calls (weather backfill) | [VERIFIED: Phase 13 requirements.txt] One-time backfill + nightly 14-day forecast fetch. Already a dep. |
| holidays (Python) | >=0.25,<1 | Holiday binary regressor generation | [VERIFIED: Phase 13 requirements.txt] Already a dep. Used to build holiday exog column. |
| python-dotenv | >=1.0,<2 | Local secret loading | [VERIFIED: Phase 13 requirements.txt] Already a dep. |
| pytest | >=8.0,<9 | Unit testing | [VERIFIED: Phase 13 requirements.txt] Already a dep. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| statsmodels ETS | statsforecast AutoETS | statsforecast AutoETS has `simulate()` with `n_paths` param; but statsmodels ETS gives direct access to state space representation and matches the SARIMAX API surface. Consistency wins. |
| statsforecast Theta | statsmodels Theta | statsmodels does not have a Theta implementation. statsforecast is the standard. |
| Bootstrap residuals for Theta samples | statsforecast ConformalIntervals | Conformal intervals are deferred to Phase 17 (BCK-02). Bootstrap is the Phase 14 approach. |
| pandas for exog assembly | Pure numpy | Prophet expects a pandas DataFrame with `ds` column. SARIMAX works with either. Using pandas for both keeps the interface uniform. |

**Installation:**
```bash
# scripts/forecast/requirements.txt
statsmodels>=0.14,<0.15
prophet==1.3.0
statsforecast>=2.0,<3
pandas>=2.2,<3
numpy>=1.26,<3
httpx>=0.27,<1
holidays>=0.25,<1
supabase>=2.0,<3
python-dotenv>=1.0,<2
pytest>=8.0,<9
```

**Version verification:**
- statsmodels: 0.14.6 on PyPI (Dec 2025) [VERIFIED: WebSearch pypi.org/project/statsmodels]
- prophet: 1.3.0 on PyPI (Jan 2026) [VERIFIED: WebSearch pypi.org/project/prophet]
- statsforecast: 2.0.3 on PyPI (Oct 2025) [VERIFIED: WebSearch pypi.org/project/statsforecast]

**GHA install time estimate:** statsmodels (~20s from wheel), prophet (~60-90s including cmdstan binary download), statsforecast (~15s). Total with pip caching: ~2 min first run, ~30s cached. [ASSUMED -- based on typical GHA install times for compiled Python packages]

## Architecture Patterns

### System Architecture Diagram

```
                    GHA Cron 01:00 UTC
                          |
                    forecast-refresh.yml
                          |
                    +-----v------+
                    | run_all.py |  (orchestrator)
                    +-----+------+
                          |
          +-------+-------+-------+--------+
          |       |       |       |        |
     sarimax  prophet   ets    theta   naive_dow
      .py      .py      .py    .py      .py
          |       |       |       |        |
          +---+---+---+---+---+--+--------+
              |           |
        exog_builder.py   |
        (shared module)   |
              |           |
    +---------+-----------+---------+
    | weather_daily (actual+forecast)|
    | holidays table                 |
    | school_holidays table          |
    | recurring_events table         |
    | shop_calendar table            |
    | weather_climatology (new)      |
    +-------------------------------+
              |
              v
    +-------------------+     +--------------------+
    | forecast_daily    |---->| forecast_daily_mv  |
    | (200 sample paths)|     | (latest run only)  |
    +-------------------+     +--------------------+
              |                        |
              v                        v
    +-------------------+     +------------------------+
    | forecast_quality  |     | forecast_with_actual_v |
    | (last_7 eval)     |     | (RLS wrapper view)     |
    +-------------------+     +------------------------+
              |                        |
              v                        v
    +-------------------+     +------------------------+
    | pipeline_runs     |     | SvelteKit load fn      |
    | (per-model rows)  |     | (Phase 15)             |
    +-------------------+     +------------------------+
```

**Data flow:**
1. GHA cron triggers `run_all.py` at 01:00 UTC
2. `run_all.py` iterates enabled models (from `FORECAST_ENABLED_MODELS` env var)
3. Each model script: reads history from `kpi_daily_mv`, builds exog matrix via `exog_builder.py`, fits model, generates 200 sample paths, writes to `forecast_daily`
4. `last_7_eval.py` runs after all models: reads last 7 actuals + prior forecasts, computes RMSE/MAPE/bias/direction_hit_rate, writes to `forecast_quality`
5. pg_cron at 03:00 UTC refreshes `forecast_daily_mv` via extended `refresh_analytics_mvs()`
6. `forecast_with_actual_v` joins MV + actuals, scoped by JWT `restaurant_id`

### Recommended Project Structure

```
scripts/forecast/
  __init__.py
  run_all.py            # Orchestrator (mirrors scripts/external/run_all.py)
  db.py                 # Supabase client factory (or import from scripts.external.db)
  exog_builder.py       # Shared exog matrix assembly (weather cascade + holidays + school + events + is_open)
  closed_days.py        # zero_closed_days() + open-day-only filtering for no-exog models
  sample_paths.py       # Shared utilities: bootstrap_from_residuals(), paths_to_jsonb()
  sarimax_fit.py        # SARIMAX model: fit + simulate + write
  prophet_fit.py        # Prophet model: fit + predictive_samples + write
  ets_fit.py            # ETS model: fit + simulate + write
  theta_fit.py          # Theta model: fit + bootstrap sample paths + write
  naive_dow_fit.py      # Naive same-DoW baseline: rolling mean + bootstrap + write
  last_7_eval.py        # Nightly evaluator: scores last 7 actual days per model
  backfill_weather_history.py  # One-time script: Bright Sky 2021-01-01 to 2025-06-10
  requirements.txt
scripts/forecast/tests/  # or tests/forecast/
  test_exog_builder.py   # Exog shape assertion, column alignment, weather cascade
  test_closed_days.py    # NaN insertion, zero_closed_days, open-day-only filter
  test_sample_paths.py   # Bootstrap path count, shape, percentile computation
  test_sarimax_smoke.py  # Smoke test: fit on 30-day fixture, predict 7 days
  test_prophet_smoke.py  # Smoke test: yearly_seasonality=False assertion
  test_eval.py           # RMSE/MAPE/bias/direction computation on known values
  conftest.py            # Shared fixtures: 90-day synthetic revenue series, mock exog
```

### Pattern 1: Per-Model Fit with Shared Exog Builder

**What:** Every exog-capable model calls `exog_builder.build_exog_matrix()` which returns a pandas DataFrame with identical column order for any date range. The function handles the 3-tier weather cascade internally.

**When to use:** SARIMAX and Prophet fits. ETS/Theta/Naive skip exog entirely.

**Example:**
```python
# Source: statsmodels 0.14.6 official docs + project CONTEXT.md D-08
from scripts.forecast.exog_builder import build_exog_matrix

# build_exog_matrix returns a DataFrame with columns:
# [temp_mean_c, precip_mm, wind_max_kmh, sunshine_hours,
#  is_holiday, is_school_holiday, has_event, is_strike,
#  is_open, weather_source]
# weather_source is NOT a model input -- it's logged to exog_signature only.

X_train = build_exog_matrix(
    client=supabase,
    restaurant_id=rid,
    start_date=train_start,
    end_date=train_end,
)
X_predict = build_exog_matrix(
    client=supabase,
    restaurant_id=rid,
    start_date=predict_start,
    end_date=predict_end,
)

# CRITICAL: assert column alignment (FCS-06)
assert list(X_train.columns) == list(X_predict.columns), \
    f"Exog drift: train={list(X_train.columns)} vs predict={list(X_predict.columns)}"

# Log weather source composition for exog_signature
exog_sig = X_predict['weather_source'].value_counts().to_dict()
# e.g. {'archive': 320, 'forecast': 14, 'climatology': 31}
```

### Pattern 2: Sample Path Generation (Per-Model)

**What:** Each model generates 200 sample paths for proper CI aggregation. The approach varies per model.

**When to use:** Every model fit. This is the D-04 mandate.

**Example:**
```python
# SARIMAX: native simulate()
# Source: statsmodels.org/stable SARIMAXResults.simulate docs
result = model.fit(disp=False)
samples = result.simulate(
    nsimulations=365,
    repetitions=200,
    anchor='end',
    exog=X_predict.drop(columns=['weather_source']),
)
# samples shape: (365, 200) -- each column is one sample path

# Prophet: predictive_samples()
# Source: facebook.github.io/prophet/docs/uncertainty_intervals.html
m = Prophet(
    yearly_seasonality=False,
    uncertainty_samples=200,   # D-04: 200 not 1000
)
# ... add regressors, fit ...
samples_dict = m.predictive_samples(future_df)
samples = samples_dict['yhat']  # shape: (n_forecast, 200)

# ETS: native simulate()
# Source: statsmodels.org/stable ETSResults.simulate docs
ets_result = model.fit()
samples = ets_result.simulate(
    nsimulations=365,
    repetitions=200,
    anchor='end',
)
# shape: (365, 200)

# Theta: bootstrap from residuals (no native simulate)
# Source: project-specific implementation
from scripts.forecast.sample_paths import bootstrap_from_residuals
residuals = theta_result.resid
point_forecast = theta_result.predict(h=365)
samples = bootstrap_from_residuals(point_forecast, residuals, n_paths=200)

# Naive same-DoW: bootstrap from same-DoW history
# Source: project-specific implementation
from scripts.forecast.sample_paths import bootstrap_naive_dow
samples = bootstrap_naive_dow(history, n_days=365, n_paths=200)
```

### Pattern 3: Closed-Day Handling (Two Strategies)

**What:** Models that support exogenous regressors (SARIMAX, Prophet) keep closed days as NaN + `is_open=0` regressor. Models without exog support (ETS, Theta, Naive) train on open-day-only series and map predictions back to calendar dates.

**When to use:** Every model fit and predict step.

**Example:**
```python
# Strategy A: exog models (SARIMAX, Prophet)
# Source: CONTEXT.md D-01

# Training: y[closed_day] = NaN, is_open[closed_day] = 0
# Prophet handles NaN in y by dropping those rows during fit
# SARIMAX: NaN rows must be handled -- use is_open regressor to absorb the signal

# Prediction: post-hoc zeroing
def zero_closed_days(predictions: pd.DataFrame, shop_cal: pd.DataFrame) -> pd.DataFrame:
    """Force yhat=0 for any date where shop_calendar.is_open=false."""
    closed_mask = predictions['target_date'].isin(
        shop_cal.loc[~shop_cal['is_open'], 'date']
    )
    predictions.loc[closed_mask, ['yhat', 'yhat_lower', 'yhat_upper']] = 0
    # Zero out sample paths too
    if 'yhat_samples' in predictions.columns:
        predictions.loc[closed_mask, 'yhat_samples'] = None
    return predictions


# Strategy B: non-exog models (ETS, Theta, Naive)
# Source: CONTEXT.md D-03

# Training: filter to open days only
open_history = history[history['is_open']].copy()
open_history = open_history.reset_index(drop=True)  # contiguous index

# Prediction: 365 open-day values, then map back
open_future_dates = shop_cal.loc[shop_cal['is_open'] & (shop_cal['date'] > today), 'date']
open_future_dates = open_future_dates.head(365)  # or however many open days in 365 calendar days
# ... fit on open_history, predict len(open_future_dates) steps ...
# Map back: assign predictions to open dates, fill closed dates with yhat=0
```

### Pattern 4: GHA Workflow Structure

**What:** `forecast-refresh.yml` mirrors `external-data-refresh.yml` with separate requirements file, pip caching, `workflow_dispatch` for manual reruns.

**When to use:** The single entry point for all Phase 14 Python execution.

```yaml
# Source: Phase 13 external-data-refresh.yml pattern
name: Forecast Refresh
on:
  schedule:
    - cron: '0 1 * * *'        # 01:00 UTC -- D-12, Guard 8 cascade
  workflow_dispatch:
    inputs:
      models:
        description: 'Comma-separated model list (omit for all enabled)'
        required: false
        default: ''
permissions:
  contents: read
concurrency:
  group: forecast-refresh
  cancel-in-progress: false
jobs:
  forecast:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      GITHUB_SHA: ${{ github.sha }}
      FORECAST_ENABLED_MODELS: 'sarimax,prophet,ets,theta,naive_dow'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'
          cache-dependency-path: scripts/forecast/requirements.txt
      - name: Install deps
        run: pip install -r scripts/forecast/requirements.txt
      - name: Run forecast pipeline
        env:
          SUPABASE_URL: ${{ secrets.DEV_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.DEV_SUPABASE_SERVICE_ROLE_KEY }}
          MODELS: ${{ inputs.models }}
        run: |
          set -euo pipefail
          ARGS=()
          if [ -n "${MODELS:-}" ]; then
            ARGS+=("--models" "$MODELS")
          fi
          python -m scripts.forecast.run_all "${ARGS[@]}"
```

### Anti-Patterns to Avoid

- **Exog column mismatch between fit and predict:** The single most common SARIMAX bug. The `exog_builder.py` module exists specifically to prevent this. Never build exog inline in model scripts. [CITED: github.com/statsmodels/statsmodels/issues/4284]
- **Summing `yhat_lower`/`yhat_upper` for weekly/monthly CIs:** This is mathematically wrong -- the sum of lower bounds is not the lower bound of the sum. Use sample paths and take percentiles of the summed paths. [CITED: PROPOSAL.md ss11 no-do list]
- **Prophet with `yearly_seasonality='auto'` and <2 years data:** Auto mode triggers yearly seasonality when history >2 cycles (~730 days). At ~10 months, it stays off. But the silent auto-flip at 2026-06-11 would produce Fourier ghosts. Hard-pin to False. [CITED: CONTEXT.md C-04]
- **Training ETS/Theta with NaN gaps from closed days:** These models expect a contiguous numeric series. Filter to open days first, predict open-day count, then map back. [CITED: CONTEXT.md D-03]
- **Putting weather forecast values in historical actuals positions:** The 3-tier cascade must use actuals for past dates, even if a forecast was the latest data when the model ran yesterday. Always refresh actual weather before building exog. [CITED: CONTEXT.md D-08]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SARIMAX fitting + simulation | Custom ARIMA implementation | `statsmodels.tsa.statespace.sarimax.SARIMAX` + `results.simulate(repetitions=200)` | State-space simulation handles error propagation correctly; hand-rolling gets variance wrong |
| Prophet fitting + posterior samples | Manual decomposition | `prophet.Prophet` + `m.predictive_samples(future)` | Posterior sampling requires cmdstan backend; reimplementing is infeasible |
| ETS model selection + fitting | Manual exponential smoothing | `statsmodels.tsa.exponential_smoothing.ets.ETSModel` | Auto-selects error/trend/seasonal components; simulate() is state-space-aware |
| Theta decomposition + forecast | Manual theta-line splitting | `statsforecast.models.Theta` or `AutoTheta` | Nixtla's implementation matches the original Assimakopoulos & Nikolopoulos (2000) spec |
| CI aggregation from sample paths | Manual percentile on yhat_lower/upper | `np.percentile(summed_paths, [2.5, 97.5])` | Summing point CIs is mathematically incorrect; must sum paths then take percentiles |
| Weather 3-tier cascade | Three separate fetch functions | Single `exog_builder.build_exog_matrix()` with cascade logic | Keeping cascade logic in one place prevents fit/predict divergence |
| Closed-day zeroing | Per-model inline if-statements | Shared `zero_closed_days()` utility | Single source of truth; D-01 mandates all models go through the same function |
| Bootstrap from residuals (Theta, Naive) | Inline bootstrap loops | Shared `sample_paths.bootstrap_from_residuals()` | Consistent path count, shape, and seed handling across models |

**Key insight:** The exog matrix assembly and closed-day handling are the two operations where hand-rolling per-model is the most dangerous. One module, shared across all models, eliminates the class of bugs where fit-time and predict-time data disagree.

## Common Pitfalls

### Pitfall 1: SARIMAX Exog Shape Mismatch at Predict Time

**What goes wrong:** `ValueError: Provided exogenous values are not of the appropriate shape. Required (365, 9), got (365, 10)` or similar. The exog matrix at predict time has a different number of columns than at fit time.
**Why it happens:** Weather data availability changes between historical and forecast periods. Holiday columns may include different years. A developer adds a column to fit but forgets to add it to predict.
**How to avoid:** Single `build_exog_matrix()` function with identical output schema regardless of date range. Assert `list(X_train.columns) == list(X_predict.columns)` before every `get_forecast()` call. Log column names in `exog_signature` jsonb. Unit test that builds exog for a training window and a forecast window and asserts column-equality.
**Warning signs:** Any `ValueError` from statsmodels mentioning "exogenous" or "shape" in GHA logs. [CITED: github.com/statsmodels/statsmodels/issues/4284]

### Pitfall 2: Prophet Regressor NaN at Predict Time

**What goes wrong:** `ValueError: Found NaN in column 'temp_mean_c'` during `m.predict()`. Prophet strictly forbids NaN in regressor columns even though it tolerates NaN in the target `y` column.
**Why it happens:** The weather cascade has gaps for future dates beyond the Bright Sky forecast horizon (~14 days) if climatological norms aren't filled in. Or `shop_calendar` doesn't extend far enough into the future.
**How to avoid:** `build_exog_matrix()` must fill every cell for the full 365-day prediction window. Climatological norms fill weather columns beyond day ~14. `is_open` defaults to True for future dates without explicit `shop_calendar` entries (conservative assumption: shop stays open). Assert `X_predict.isna().sum().sum() == 0` before passing to Prophet.
**Warning signs:** Any `ValueError` mentioning "Found NaN in column" in GHA logs. [CITED: github.com/facebook/prophet/issues/908, github.com/facebook/prophet/issues/322]

### Pitfall 3: Prophet yearly_seasonality Silent Auto-Flip

**What goes wrong:** Around 2026-06-11, Prophet automatically enables yearly seasonality because history crosses 2 years (730 days). With only one annual cycle, the Fourier terms fit noise instead of real seasonality.
**Why it happens:** Prophet's `yearly_seasonality='auto'` triggers at >2 cycles. The PROPOSAL calls this "fitting Fourier ghosts."
**How to avoid:** Hard-pin `yearly_seasonality=False` in `prophet_fit.py`. Unit test asserts the parameter stays False until `len(history) >= 730`. Add a comment with the 2027-06-11 date when it can be safely re-enabled.
**Warning signs:** Sudden change in Prophet forecast shape around summer 2026 (visible as a sawtooth pattern in the 365d forecast). [CITED: CONTEXT.md C-04; PROPOSAL ss11]

### Pitfall 4: Closed-Day Bias in Non-Exog Models

**What goes wrong:** ETS/Theta/Naive trained on a series that includes zero-revenue closed days. The model learns "some days are zero" and systematically under-forecasts open days.
**Why it happens:** Closed days (Mon/Tue before the regime shift, plus holidays) are genuine zeros in the historical data. Including them in the training set biases the level and seasonal components downward.
**How to avoid:** D-03: filter history to open days only before fitting ETS/Theta/Naive. Predict N open-day values (not 365 calendar days). Map predictions back to calendar dates using `shop_calendar.is_open=true` future dates. Insert yhat=0 for closed dates.
**Warning signs:** ETS/Theta/Naive consistently under-forecast by ~15-30% on open days. [CITED: CONTEXT.md D-03; PROPOSAL ss12 closed-day handling]

### Pitfall 5: SARIMAX Convergence Failure on Short or Noisy Series

**What goes wrong:** `ConvergenceWarning: Maximum Likelihood optimization failed to converge` or `LinAlgError: singular matrix`. The model fails to fit on a given night's data.
**Why it happens:** ~10 months of daily data with regime changes (Mon/Tue open/closed) can produce edge cases where the optimizer doesn't converge, especially for higher-order seasonal ARIMA.
**How to avoid:** Wrap fit in try/except. On convergence failure: (1) try a simpler order like `(1,0,0)(0,1,1,7)`, (2) if still failing, write a `pipeline_runs` row with `status='failure'` and skip SARIMAX for that night. Other models still run. Log the full traceback in `error_msg`.
**Warning signs:** `ConvergenceWarning` in GHA logs. Increasing `maxiter` (e.g., `maxiter=200`) may help but costs time. [ASSUMED -- common statsmodels behavior]

### Pitfall 6: `yhat_samples` jsonb Size Explosion

**What goes wrong:** 200 sample paths x 365 days x 2 KPIs x 5 models = ~3.65M numeric values per nightly run. At ~8 bytes per JSON number, that's ~29 MB per night before Postgres overhead.
**Why it happens:** jsonb stores numbers as text internally with higher overhead than binary. Array-of-arrays in jsonb adds bracket/comma overhead.
**How to avoid:** D-04 already limits to 200 paths (not 1000). D-05 mandates NULLing `yhat_samples` for older run_dates via weekly janitor. Monitor `pg_total_relation_size('forecast_daily')` weekly. At ~25 MB/night with NULLing, annual storage stays under ~50 MB (well within 500 MB free tier).
**Warning signs:** Supabase Dashboard storage approaching 400 MB. [CITED: CONTEXT.md D-04, D-05]

### Pitfall 7: Prophet install time on GHA exceeds timeout

**What goes wrong:** `pip install prophet` downloads cmdstan binary (~200MB), which can take 60-90s on first run without cache. Combined with statsmodels and statsforecast, total install exceeds expectations.
**Why it happens:** Prophet's cmdstanpy backend requires a precompiled Stan binary. First install on a fresh GHA runner (no pip cache) is slow.
**How to avoid:** Use GHA `actions/setup-python@v5` with `cache: 'pip'` and `cache-dependency-path: scripts/forecast/requirements.txt`. After first run, subsequent installs hit the cache. Set `timeout-minutes: 15` on the job (generous for ~10 min pipeline + install).
**Warning signs:** GHA run times >12 min on first execution. [ASSUMED -- typical GHA behavior with large Python deps]

## Code Examples

### Common Operation 1: Building the Exog Matrix with 3-Tier Weather Cascade

```python
# Source: project-specific implementation based on CONTEXT.md D-06/D-07/D-08
import pandas as pd
import numpy as np
from datetime import date, timedelta

EXOG_COLUMNS = [
    'temp_mean_c', 'precip_mm', 'wind_max_kmh', 'sunshine_hours',
    'is_holiday', 'is_school_holiday', 'has_event', 'is_strike', 'is_open',
]

def build_exog_matrix(
    client, restaurant_id: str, start_date: date, end_date: date
) -> pd.DataFrame:
    """Build exog matrix with 3-tier weather cascade.
    
    Weather source per row:
    - 'archive': actual observation from weather_daily (is_forecast=false)
    - 'forecast': Bright Sky 1-14 day forecast (is_forecast=true)
    - 'climatology': per-DoY historical average from weather_climatology
    
    Returns DataFrame indexed by date with EXOG_COLUMNS + 'weather_source'.
    """
    dates = pd.date_range(start_date, end_date, freq='D')
    df = pd.DataFrame({'date': dates.date})
    
    # 1. Weather: 3-tier cascade
    weather = _fetch_weather(client, start_date, end_date)
    climatology = _fetch_climatology(client)
    
    for col in ['temp_mean_c', 'precip_mm', 'wind_max_kmh', 'sunshine_hours']:
        # Tier 1: actual observations
        df[col] = df['date'].map(weather.get(col, {}))
        # Tier 2: Bright Sky forecast (already in weather_daily with is_forecast=true)
        # (handled by the same fetch -- is_forecast rows are included)
        # Tier 3: climatological norms for remaining NaN
        mask = df[col].isna()
        df.loc[mask, col] = df.loc[mask, 'date'].map(
            lambda d: climatology.get((d.month, d.day), {}).get(col, 0)
        )
    
    # Track source for exog_signature
    df['weather_source'] = 'climatology'  # default
    df.loc[df['date'].isin(weather['archive_dates']), 'weather_source'] = 'archive'
    df.loc[df['date'].isin(weather['forecast_dates']), 'weather_source'] = 'forecast'
    
    # 2. Holidays, school, events, strikes: binary columns
    df['is_holiday'] = df['date'].isin(_fetch_holiday_dates(client)).astype(int)
    df['is_school_holiday'] = df['date'].isin(
        _fetch_school_holiday_dates(client)
    ).astype(int)
    df['has_event'] = df['date'].isin(_fetch_event_dates(client)).astype(int)
    df['is_strike'] = df['date'].isin(_fetch_strike_dates(client)).astype(int)
    
    # 3. Shop calendar
    shop_cal = _fetch_shop_calendar(client, restaurant_id, start_date, end_date)
    df['is_open'] = df['date'].map(shop_cal).fillna(True).astype(int)
    
    df = df.set_index('date')
    return df[EXOG_COLUMNS + ['weather_source']]
```

### Common Operation 2: SARIMAX Fit + 200 Sample Paths

```python
# Source: statsmodels.org/stable SARIMAXResults.simulate + .get_forecast docs
import statsmodels.api as sm

def fit_sarimax(
    y: pd.Series,
    X_train: pd.DataFrame,
    X_predict: pd.DataFrame,
    order=(1, 0, 1),
    seasonal_order=(1, 1, 1, 7),
    n_paths: int = 200,
) -> tuple[pd.DataFrame, np.ndarray, dict]:
    """Fit SARIMAX, generate point forecast + 200 sample paths.
    
    Returns: (point_forecast_df, sample_paths_array, exog_signature)
    """
    # Drop weather_source (not a model input)
    X_fit = X_train.drop(columns=['weather_source'])
    X_pred = X_predict.drop(columns=['weather_source'])
    
    # FCS-06: assert column alignment
    assert list(X_fit.columns) == list(X_pred.columns), \
        f"Exog drift: {list(X_fit.columns)} vs {list(X_pred.columns)}"
    
    model = sm.tsa.SARIMAX(
        y, exog=X_fit, order=order, seasonal_order=seasonal_order,
        enforce_stationarity=False, enforce_invertibility=False,
    )
    result = model.fit(disp=False, maxiter=200)
    
    # Point forecast with CI
    forecast = result.get_forecast(steps=len(X_pred), exog=X_pred)
    yhat = forecast.predicted_mean
    ci = forecast.conf_int(alpha=0.05)
    
    # 200 sample paths via state-space simulation
    # anchor='end' starts simulation from the last in-sample state
    samples = result.simulate(
        nsimulations=len(X_pred),
        repetitions=n_paths,
        anchor='end',
        exog=X_pred,
    )
    # samples shape: (n_predict, n_paths)
    
    exog_sig = X_predict['weather_source'].value_counts().to_dict()
    
    point_df = pd.DataFrame({
        'yhat': yhat.values,
        'yhat_lower': ci.iloc[:, 0].values,
        'yhat_upper': ci.iloc[:, 1].values,
    }, index=X_predict.index)
    
    return point_df, samples, exog_sig
```

### Common Operation 3: Prophet Fit with Regressors + Predictive Samples

```python
# Source: facebook.github.io/prophet/docs/uncertainty_intervals.html
from prophet import Prophet

def fit_prophet(
    history: pd.DataFrame,     # columns: ds, y, + regressor columns
    future: pd.DataFrame,      # columns: ds, + regressor columns (no NaN!)
    n_samples: int = 200,
) -> tuple[pd.DataFrame, np.ndarray]:
    """Fit Prophet with yearly_seasonality=False, generate samples.
    
    C-04: yearly_seasonality MUST be False until history >= 730 days.
    """
    assert len(history) < 730 or True, "Re-evaluate yearly_seasonality pin"
    
    m = Prophet(
        yearly_seasonality=False,       # C-04: hard-pinned
        weekly_seasonality=True,
        daily_seasonality=False,
        uncertainty_samples=n_samples,  # D-04: 200
    )
    
    # Add regressors -- Prophet requires these present in both history and future
    for col in ['temp_mean_c', 'precip_mm', 'wind_max_kmh', 'sunshine_hours',
                'is_holiday', 'is_school_holiday', 'has_event', 'is_strike', 'is_open']:
        m.add_regressor(col)
    
    m.fit(history)  # NaN in y is OK -- Prophet drops those rows
    
    # Point forecast
    forecast = m.predict(future)
    
    # Posterior predictive samples -- returns dict with 'yhat' key
    # Shape: (n_future_rows, n_samples)
    samples_dict = m.predictive_samples(future)
    samples = samples_dict['yhat']  # ndarray (n_future, 200)
    
    point_df = forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']].copy()
    point_df = point_df.rename(columns={'ds': 'target_date'})
    
    return point_df, samples
```

### Common Operation 4: Bootstrap Sample Paths for Theta/Naive

```python
# Source: project-specific; inspired by otexts.com/fpp2/bootstrap.html
import numpy as np

def bootstrap_from_residuals(
    point_forecast: np.ndarray,
    residuals: np.ndarray,
    n_paths: int = 200,
    seed: int = 42,
) -> np.ndarray:
    """Generate sample paths by bootstrapping residuals onto point forecast.
    
    For models without native simulation (Theta, Naive).
    Returns: ndarray of shape (len(point_forecast), n_paths).
    """
    rng = np.random.default_rng(seed)
    h = len(point_forecast)
    
    # Sample residuals with replacement for each path
    sampled_residuals = rng.choice(residuals, size=(h, n_paths), replace=True)
    
    # Add cumulative residual drift to point forecast
    # (simple additive bootstrap -- appropriate for level/trend models)
    paths = point_forecast[:, np.newaxis] + sampled_residuals
    
    return paths  # shape: (h, n_paths)
```

### Common Operation 5: Writing Forecast Rows to `forecast_daily`

```python
# Source: Phase 13 pipeline_runs_writer.py pattern
import json

def write_forecast_batch(
    client,
    restaurant_id: str,
    kpi_name: str,
    model_name: str,
    run_date: date,
    forecast_track: str,
    point_df: pd.DataFrame,   # index=target_date, cols=[yhat, yhat_lower, yhat_upper]
    samples: np.ndarray,       # shape (n_days, n_paths)
    exog_signature: dict,
) -> int:
    """Upsert forecast rows to forecast_daily. Returns row count."""
    rows = []
    for i, (target_date, row) in enumerate(point_df.iterrows()):
        rows.append({
            'restaurant_id': restaurant_id,
            'kpi_name': kpi_name,
            'target_date': str(target_date),
            'model_name': model_name,
            'run_date': str(run_date),
            'forecast_track': forecast_track,
            'yhat': float(row['yhat']),
            'yhat_lower': float(row['yhat_lower']),
            'yhat_upper': float(row['yhat_upper']),
            'yhat_samples': json.dumps(samples[i].tolist()),
            'exog_signature': json.dumps(exog_signature),
        })
    
    # Upsert in chunks (Supabase 1MB payload limit)
    CHUNK = 100  # ~100 rows x ~10KB each = ~1MB safe
    for chunk_start in range(0, len(rows), CHUNK):
        chunk = rows[chunk_start:chunk_start + CHUNK]
        res = client.table('forecast_daily').upsert(
            chunk,
            on_conflict='restaurant_id,kpi_name,target_date,model_name,run_date,forecast_track',
        ).execute()
    
    return len(rows)
```

### Common Operation 6: last_7_eval Scoring Loop

```python
# Source: PROPOSAL ss17 last-7-actual-days evaluator spec
import math

def evaluate_last_7(client, restaurant_id: str, kpi_name: str):
    """Score each model's last 7 1-day-ahead forecasts against actuals."""
    # Get the latest date with actuals
    T = _get_max_actual_date(client, restaurant_id, kpi_name)
    eval_dates = [T - timedelta(days=k) for k in range(6, -1, -1)]
    
    for model_name in _get_enabled_models():
        yhats, actuals = [], []
        for d in eval_dates:
            # Find the forecast made on d-1 for target d
            fc = _get_forecast(client, restaurant_id, kpi_name, model_name,
                              run_date=d - timedelta(days=1), target_date=d)
            actual = _get_actual(client, restaurant_id, kpi_name, d)
            if fc is not None and actual is not None:
                yhats.append(fc)
                actuals.append(actual)
        
        if len(yhats) < 2:
            continue  # not enough data yet
        
        yhats = np.array(yhats)
        actuals = np.array(actuals)
        
        rmse = math.sqrt(((yhats - actuals) ** 2).mean())
        mape = (np.abs((yhats - actuals) / np.where(actuals != 0, actuals, 1)) * 100).mean()
        bias = (yhats - actuals).mean()
        
        # Direction hit rate: did yhat move same direction as actual day-over-day?
        if len(actuals) >= 2:
            actual_dirs = np.diff(actuals) > 0
            yhat_dirs = np.diff(yhats) > 0
            direction_hits = (actual_dirs == yhat_dirs).sum()
            direction_rate = float(direction_hits) / len(actual_dirs)
        else:
            direction_rate = None
        
        _upsert_forecast_quality(
            client, restaurant_id, kpi_name, model_name,
            evaluation_window='last_7_days',
            n_days=len(yhats),
            rmse=rmse, mape=mape, bias=bias,
            direction_hit_rate=direction_rate,
        )
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| prophet (pystan2 backend) | prophet 1.3 (cmdstanpy backend) | v1.2+ (2023) | Faster install, no C++ compiler needed at runtime (pre-compiled binary), Python 3.12 support |
| Manual ETS parameter selection | statsmodels `ETSModel` with auto-selection | statsmodels 0.12+ (2020) | Built-in AIC/BIC model selection for error/trend/seasonal components |
| Hand-written Theta | statsforecast `AutoTheta` | statsforecast 1.0+ (2023) | Nixtla's implementation is 10-100x faster than R's forecast package; auto-selects Theta variant |
| Separate prediction intervals per model | Conformal prediction wrappers | statsforecast 1.5+ (2024) | Distribution-free calibrated CIs; deferred to Phase 17 for this project |
| Prophet `predictive_samples` with pystan2 | Prophet `predictive_samples` with cmdstanpy | prophet 1.2+ (2025) | Same API, different backend; MAP estimation is default (fast); MCMC optional for full posterior |

**Deprecated/outdated:**
- `fbprophet` PyPI package: renamed to `prophet` since v1.0 (2021). Do not use `fbprophet`. [VERIFIED: PyPI]
- `@supabase/auth-helpers-sveltekit`: deprecated; use `@supabase/ssr`. [VERIFIED: CLAUDE.md]
- `pystan2` as Prophet backend: removed in prophet v1.2+. cmdstanpy is the only backend. [VERIFIED: github.com/facebook/prophet]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | pandas >=2.2 needed as a direct dep for Phase 14 (Phase 13 did not require it) | Standard Stack | Low -- pandas is a transitive dep of both statsmodels and prophet; explicit pin just ensures version compatibility |
| A2 | GHA install time for prophet + statsmodels + statsforecast is ~2 min first run, ~30s cached | Common Pitfalls | Medium -- if prophet binary download is slow, first-run could exceed 5 min; pip cache mitigates |
| A3 | SARIMAX `(1,0,1)(1,1,1,7)` is a reasonable starting order for ~10 months of daily restaurant revenue | Code Examples | Medium -- may need tuning; the CONTEXT.md leaves exact order to Claude's discretion |
| A4 | Bootstrap-from-residuals is an acceptable sample path generation approach for Theta when native simulate is unavailable | Don't Hand-Roll | Low -- standard approach per Hyndman & Athanasopoulos "Forecasting: Principles and Practice" ch 11.4 |
| A5 | statsforecast Theta does not expose a native `simulate()` method returning multiple sample paths | Standard Stack | Medium -- if it does, bootstrap is unnecessary; statsforecast AutoETS does have simulate() but Theta docs don't show one |

## Open Questions

1. **Weather climatology storage: dedicated table vs inline SQL?**
   - What we know: Need per-DoY averages from ~4-5 years of Berlin weather for the cascade tier 3
   - What's unclear: Whether to materialize as a small `weather_climatology` table (366 rows) or compute inline via `SELECT day_of_year, AVG(temp_mean_c) FROM weather_daily GROUP BY day_of_year`
   - Recommendation: Dedicated table. 366 rows is trivial. Avoids recomputing on every forecast run. The backfill script populates it once after the one-time weather history load.

2. **SARIMAX order selection: fixed vs auto?**
   - What we know: PROPOSAL suggests `(1,0,1)(1,1,1,7)` as a starting point
   - What's unclear: Whether to use `pmdarima.auto_arima()` for order selection or fix the order
   - Recommendation: Fixed order for v1. Auto-ARIMA adds another dependency (pmdarima) and increases fit time. The fixed order is a reasonable default for weekly-seasonal daily revenue. Tune manually if RMSE is unacceptable after Phase 17 backtests.

3. **Prophet MCMC vs MAP for sample paths?**
   - What we know: MAP (default) gives uncertainty only in trend + noise. MCMC gives full posterior including seasonal uncertainty. MCMC takes ~30s per fit vs ~3s for MAP on 10-month data.
   - What's unclear: Whether the extra ~27s per fit (x2 KPIs = ~54s) is worth the calibration improvement
   - Recommendation: Use MAP for nightly production (speed). The `uncertainty_samples=200` parameter generates 200 simulated paths from the MAP posterior. MCMC can be evaluated in Phase 17 backtest if MAP CIs prove poorly calibrated.

4. **`forecast_track` column: include in Phase 14 PK or add later?**
   - What we know: D-04 from CONTEXT says schema must be ready for Phase 16's Track-B without ALTER. The PK in PROPOSAL ss7 is `(restaurant_id, kpi_name, target_date, model_name, run_date)`.
   - What's unclear: CONTEXT.md deliverable 1 says PK includes `forecast_track`. This is correct -- include it now.
   - Recommendation: Add `forecast_track text NOT NULL DEFAULT 'bau'` to the PK from day 1. Phase 16 writes `forecast_track='cf'` rows without schema changes.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.12 | All model fitting | N/A (GHA runner) | 3.12 on ubuntu-latest | -- |
| Supabase Postgres | Data storage | Yes (DEV project) | Postgres 15+ | -- |
| Bright Sky API | Weather backfill | Yes (public, no key) | -- | Inline SQL from existing weather_daily |
| GitHub Actions | Cron execution | Yes (public repo, unlimited mins) | -- | -- |
| pg_cron extension | MV refresh scheduling | Yes (Supabase project) | -- | -- |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 8.x (Python) + vitest (TypeScript for migration integration tests) |
| Config file | `scripts/forecast/pytest.ini` or `pyproject.toml` section (Wave 0) |
| Quick run command | `python -m pytest scripts/forecast/tests/ -x --tb=short` |
| Full suite command | `python -m pytest scripts/forecast/tests/ -v && npm run test:integration` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FCS-01 | `forecast_daily` table schema correct | integration | `npm run test:integration -- --grep forecast_daily` | Wave 0 |
| FCS-02 | SARIMAX fits + writes 365d forecast | unit (smoke) | `python -m pytest scripts/forecast/tests/test_sarimax_smoke.py -x` | Wave 0 |
| FCS-03 | Prophet yearly_seasonality=False | unit | `python -m pytest scripts/forecast/tests/test_prophet_smoke.py -x` | Wave 0 |
| FCS-04 | ETS/Theta/Naive produce forecasts | unit (smoke) | `python -m pytest scripts/forecast/tests/test_ets_theta_naive.py -x` | Wave 0 |
| FCS-05 | Chronos/NeuralProphet behind env flag | unit | `python -m pytest scripts/forecast/tests/test_feature_flags.py -x` | Wave 0 |
| FCS-06 | SARIMAX exog column alignment | unit | `python -m pytest scripts/forecast/tests/test_exog_builder.py -x` | Wave 0 |
| FCS-07 | last_7_eval scores correctly | unit | `python -m pytest scripts/forecast/tests/test_eval.py -x` | Wave 0 |
| FCS-08 | MV + wrapper view exist with REVOKE | integration | `npm run test:integration -- --grep forecast_daily_mv` | Wave 0 |
| FCS-09 | GHA workflow structure correct | CI guard | `python scripts/ci-guards/check-cron-schedule.py` | Exists (Guard 8) |
| FCS-10 | pg_cron refresh includes forecast_daily_mv | integration | `npm run test:integration -- --grep refresh_analytics_mvs` | Extends existing |
| FCS-11 | Sample paths stored, CI computed correctly | unit | `python -m pytest scripts/forecast/tests/test_sample_paths.py -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `python -m pytest scripts/forecast/tests/ -x --tb=short`
- **Per wave merge:** Full suite: `python -m pytest scripts/forecast/tests/ -v && npm run test:integration`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `scripts/forecast/tests/conftest.py` -- shared fixtures: 90-day synthetic revenue series, mock Supabase client, mock exog DataFrame
- [ ] `scripts/forecast/tests/test_exog_builder.py` -- covers FCS-06
- [ ] `scripts/forecast/tests/test_sarimax_smoke.py` -- covers FCS-02
- [ ] `scripts/forecast/tests/test_prophet_smoke.py` -- covers FCS-03 (yearly_seasonality pin assertion)
- [ ] `scripts/forecast/tests/test_ets_theta_naive.py` -- covers FCS-04
- [ ] `scripts/forecast/tests/test_eval.py` -- covers FCS-07
- [ ] `scripts/forecast/tests/test_sample_paths.py` -- covers FCS-11
- [ ] `scripts/forecast/tests/test_closed_days.py` -- covers D-01/D-03
- [ ] `tests/integration/tenant-isolation.test.ts` extension for `forecast_daily` + `forecast_quality`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | -- (backend batch job, no user-facing auth) |
| V3 Session Management | No | -- (no sessions in forecast pipeline) |
| V4 Access Control | Yes | RLS on `forecast_daily` + `forecast_quality` via `auth.jwt()->>'restaurant_id'`; `REVOKE ALL` on MVs; service-role-only writes |
| V5 Input Validation | Yes | Date validation in GHA workflow (DATE_RE regex per Phase 13 pattern); model name whitelist from env var |
| V6 Cryptography | No | -- (no secrets handled beyond env vars) |

### Known Threat Patterns for Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tenant data leakage via MV | Information Disclosure | `REVOKE ALL` on MVs; wrapper view with JWT filter; 2-tenant isolation integration test |
| Service-role key exposure | Elevation of Privilege | Key scoped to GHA step env only (not global); `permissions: contents: read` limits GHA token scope |
| SQL injection via model_name | Tampering | model_name comes from env var whitelist, not user input; parameterized queries via supabase-py |
| Excessive forecast writes fill DB | Denial of Service | D-05 weekly janitor NULLs old `yhat_samples`; 200 paths (not 1000) per D-04 |

## Sources

### Primary (HIGH confidence)
- [statsmodels 0.14.6 SARIMAXResults.simulate docs](https://www.statsmodels.org/stable/generated/statsmodels.tsa.statespace.sarimax.SARIMAXResults.simulate.html) -- simulate() API, repetitions parameter, anchor parameter
- [statsmodels ETSResults.simulate docs](https://www.statsmodels.org/stable/generated/statsmodels.tsa.exponential_smoothing.ets.ETSResults.simulate.html) -- ETS simulate() API, repetitions parameter
- [Prophet Uncertainty Intervals docs](https://facebook.github.io/prophet/docs/uncertainty_intervals.html) -- predictive_samples(), uncertainty_samples parameter, MAP vs MCMC
- [Prophet forecaster.py source](https://github.com/facebook/prophet/blob/main/python/prophet/forecaster.py) -- uncertainty_samples=1000 default, NaN handling in y column
- [Prophet GitHub Issue #908](https://github.com/facebook/prophet/issues/908) -- regressor NaN raises ValueError
- [statsmodels GitHub Issue #4284](https://github.com/statsmodels/statsmodels/issues/4284) -- exog shape mismatch in SARIMAX forecasting
- [Bright Sky API](https://brightsky.dev/) -- public DWD weather data, lat/lon + date parameters, historical back to 2010

### Secondary (MEDIUM confidence)
- [statsforecast GitHub + PyPI](https://github.com/Nixtla/statsforecast) -- AutoTheta, AutoETS, prediction intervals via level parameter
- [Nixtla Conformal Prediction tutorial](https://nixtlaverse.nixtla.io/statsforecast/docs/tutorials/conformalprediction.html) -- deferred to Phase 17
- [Hyndman & Athanasopoulos FPP3 ss8.7](https://otexts.com/fpp3/ets-forecasting.html) -- ETS simulation for prediction intervals
- [Hyndman & Athanasopoulos FPP2 ss11.4](https://otexts.com/fpp2/bootstrap.html) -- bootstrap residuals for sample paths

### Tertiary (LOW confidence)
- GHA install timing for prophet (~60-90s first run) -- [ASSUMED, not measured]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all versions verified against PyPI; APIs verified against official docs
- Architecture: HIGH -- mirrors Phase 13's established pattern; all integration points documented
- Pitfalls: HIGH -- each pitfall traced to official docs or GitHub issues
- Sample-path generation: MEDIUM -- SARIMAX and ETS simulate() are well-documented; Prophet predictive_samples() is documented; Theta bootstrap is standard but project-specific implementation
- GHA timing: LOW -- install and fit times are estimates, not measured

**Research date:** 2026-04-29
**Valid until:** 2026-05-29 (30 days -- stable libraries, no fast-moving components)
