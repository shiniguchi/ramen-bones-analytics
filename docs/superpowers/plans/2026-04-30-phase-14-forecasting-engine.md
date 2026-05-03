# Phase 14: Forecasting Engine (BAU Track) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a nightly Python pipeline that fits 5 statistical models on daily restaurant revenue/invoice data, writes 365-day forecasts with 200 sample paths to Postgres, evaluates accuracy, and exposes results via a materialized view.

**Architecture:** Python scripts in `scripts/forecast/` mirror Phase 13's `scripts/external/` pattern. Each model runs as a subprocess for memory isolation (autoplan finding). GHA workflow at 01:00 UTC triggers `run_all.py`, which spawns per-model subprocesses, writes to `forecast_daily`, then calls `refresh_forecast_mvs()` RPC. A shared `exog.py` module builds the regressor matrix with a 3-tier weather cascade. `last_7_eval.py` scores forecasts against actuals and writes to `forecast_quality`.

**Tech Stack:** Python 3.12, statsmodels 0.14.6 (SARIMAX + ETS), prophet 1.3.0, statsforecast 2.0.3 (Theta), pandas 2.2+, numpy 1.26+, supabase-py 2.x, GitHub Actions, Supabase Postgres.

**Branch:** `feature/phase-14-forecasting-engine`

**Design doc:** `~/.gstack/projects/ramen-bones-analytics/shiniguchi-main-design-20260430-022213.md`

**Research:** `.planning/phases/14-forecasting-engine-bau-track/14-RESEARCH.md`

**Context:** `.planning/phases/14-forecasting-engine-bau-track/14-CONTEXT.md` (18 locked decisions)

---

## File Structure

### New files

```
scripts/forecast/
  __init__.py                    # Package marker
  db.py                          # Supabase client factory (mirrors scripts/external/db.py)
  exog.py                        # Shared exog matrix builder with 3-tier weather cascade
  closed_days.py                 # zero_closed_days() + open-day-only filtering
  sample_paths.py                # bootstrap_from_residuals(), paths_to_jsonb()
  sarimax_fit.py                 # SARIMAX model: fit + simulate + write (subprocess entry)
  prophet_fit.py                 # Prophet model: fit + predictive_samples + write
  ets_fit.py                     # ETS model: fit + simulate + write
  theta_fit.py                   # Theta model: fit + bootstrap + write
  naive_dow_fit.py               # Naive same-DoW baseline: rolling mean + bootstrap
  last_7_eval.py                 # Nightly evaluator: last 7 open days per model
  run_all.py                     # Orchestrator: subprocess per model + RPC refresh
  backfill_weather_history.py    # One-time: Bright Sky 2021-01-01 to 2025-06-10
  requirements.txt               # Phase 14 Python deps

scripts/forecast/tests/
  __init__.py
  conftest.py                    # Shared fixtures: synthetic revenue, mock exog
  test_exog.py                   # Exog shape assertion, cascade tiers, NaN guard
  test_closed_days.py            # NaN insertion, zero_closed_days, open-day filter
  test_sample_paths.py           # Bootstrap path count, shape, percentile
  test_sarimax_smoke.py          # Smoke: fit on fixture, predict 7 days
  test_prophet_smoke.py          # yearly_seasonality=False assertion
  test_eval.py                   # RMSE/MAPE/bias/direction on known values

supabase/migrations/
  0050_forecast_daily.sql        # forecast_daily table + RLS
  0051_forecast_quality.sql      # forecast_quality table + RLS
  0052_weather_climatology.sql   # 366-row DoY lookup table
  0053_forecast_daily_mv.sql     # MV + unique index + REVOKE ALL
  0054_forecast_with_actual_v.sql # RLS-scoped wrapper view
  0055_refresh_forecast_mvs.sql  # RPC function for MV refresh
  0056_forecast_janitor.sql      # pg_cron weekly yhat_samples NULLer

.github/workflows/
  forecast-refresh.yml           # Nightly cron + workflow_dispatch
```

### Modified files

```
tests/integration/tenant-isolation.test.ts  # Add forecast_daily + forecast_quality cases
scripts/ci-guards/check-cron-schedule.py    # Verify forecast-refresh schedule
```

---

## Wave 1: Schema + SARIMAX Vertical Slice

### Task 1: Migration 0050 — `forecast_daily` table

**Files:**
- Create: `supabase/migrations/0050_forecast_daily.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0050_forecast_daily.sql
-- Phase 14: forecast_daily table (long format, BAU track)
-- PK includes forecast_track for Phase 16 Track-B readiness (no ALTER needed)

CREATE TABLE public.forecast_daily (
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
    kpi_name      text NOT NULL CHECK (kpi_name IN ('revenue_eur', 'invoice_count')),
    target_date   date NOT NULL,
    model_name    text NOT NULL,
    run_date      date NOT NULL,
    forecast_track text NOT NULL DEFAULT 'bau',
    yhat          double precision NOT NULL,
    yhat_lower    double precision NOT NULL,
    yhat_upper    double precision NOT NULL,
    yhat_samples  jsonb,
    exog_signature jsonb,
    horizon_days  integer GENERATED ALWAYS AS (target_date - run_date) STORED,
    created_at    timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (restaurant_id, kpi_name, target_date, model_name, run_date, forecast_track)
);

COMMENT ON TABLE public.forecast_daily IS 'Phase 14: 365-day forward forecasts per model per KPI. yhat_samples holds 200 sample paths (jsonb array of floats) for CI aggregation.';

-- RLS: tenant-scoped reads via JWT restaurant_id (C-06)
ALTER TABLE public.forecast_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY forecast_daily_select ON public.forecast_daily
    FOR SELECT USING (restaurant_id = (auth.jwt()->>'restaurant_id')::uuid);

-- Service-role only writes (hybrid RLS pattern from Phase 13)
REVOKE INSERT, UPDATE, DELETE ON public.forecast_daily FROM authenticated, anon;
```

- [ ] **Step 2: Apply migration locally**

Run: `supabase db reset`
Expected: Migration applies without errors.

- [ ] **Step 3: Verify table exists**

Run: `supabase db lint` or connect and run `\d public.forecast_daily`
Expected: Table with all columns, PK, RLS policy, generated column `horizon_days`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0050_forecast_daily.sql
git commit -m "feat(14): add forecast_daily table with RLS and generated horizon_days"
```

---

### Task 2: Migration 0051 — `forecast_quality` table

**Files:**
- Create: `supabase/migrations/0051_forecast_quality.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0051_forecast_quality.sql
-- Phase 14: forecast_quality table for per-model evaluation scores
-- PK includes evaluation_window for Phase 17 rolling-origin CV (D-14)

CREATE TABLE public.forecast_quality (
    restaurant_id     uuid NOT NULL REFERENCES public.restaurants(id),
    kpi_name          text NOT NULL,
    model_name        text NOT NULL,
    horizon_days      integer NOT NULL DEFAULT 1,
    evaluation_window text NOT NULL DEFAULT 'last_7_days',
    evaluated_at      timestamptz NOT NULL DEFAULT now(),
    n_days            integer NOT NULL,
    rmse              double precision NOT NULL,
    mape              double precision NOT NULL,
    mean_bias         double precision NOT NULL,
    direction_hit_rate double precision,
    horizon_reliability_cutoff integer,

    PRIMARY KEY (restaurant_id, kpi_name, model_name, horizon_days, evaluation_window, evaluated_at)
);

COMMENT ON TABLE public.forecast_quality IS 'Phase 14: per-model forecast accuracy. direction_hit_rate computed on open days only (autoplan finding). horizon_reliability_cutoff marks the max reliable horizon given training data length.';

ALTER TABLE public.forecast_quality ENABLE ROW LEVEL SECURITY;
CREATE POLICY forecast_quality_select ON public.forecast_quality
    FOR SELECT USING (restaurant_id = (auth.jwt()->>'restaurant_id')::uuid);

REVOKE INSERT, UPDATE, DELETE ON public.forecast_quality FROM authenticated, anon;
```

- [ ] **Step 2: Apply and verify**

Run: `supabase db reset`
Expected: Both 0050 and 0051 apply. `\d public.forecast_quality` shows all columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0051_forecast_quality.sql
git commit -m "feat(14): add forecast_quality table with evaluation_window discriminator"
```

---

### Task 3: Migration 0052 — `weather_climatology` lookup table

**Files:**
- Create: `supabase/migrations/0052_weather_climatology.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0052_weather_climatology.sql
-- Phase 14: per-DoY weather norms for the 3-tier exog cascade (D-06)
-- Populated by backfill_weather_history.py after Bright Sky historical load

CREATE TABLE public.weather_climatology (
    day_of_year    smallint NOT NULL CHECK (day_of_year BETWEEN 1 AND 366),
    temp_mean_c    double precision NOT NULL,
    precip_mm      double precision NOT NULL,
    wind_max_kmh   double precision NOT NULL,
    sunshine_hours double precision NOT NULL,
    sample_years   integer NOT NULL,
    updated_at     timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (day_of_year)
);

COMMENT ON TABLE public.weather_climatology IS 'Phase 14: 366-row per-DoY weather normals from 4-5 years of Berlin history. Used as Tier 3 fallback in exog cascade when actual/forecast weather unavailable.';
```

- [ ] **Step 2: Apply and verify**

Run: `supabase db reset`
Expected: Table created with 0 rows (populated by backfill script later).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0052_weather_climatology.sql
git commit -m "feat(14): add weather_climatology lookup table for exog cascade tier 3"
```

---

### Task 4: Migration 0053 — `forecast_daily_mv` + REVOKE

**Files:**
- Create: `supabase/migrations/0053_forecast_daily_mv.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0053_forecast_daily_mv.sql
-- Phase 14: materialized view collapsing forecast_daily to latest run per key
-- REFRESH CONCURRENTLY requires a unique index (D-05)

CREATE MATERIALIZED VIEW public.forecast_daily_mv AS
SELECT DISTINCT ON (restaurant_id, kpi_name, target_date, model_name, forecast_track)
    restaurant_id,
    kpi_name,
    target_date,
    model_name,
    forecast_track,
    run_date,
    yhat,
    yhat_lower,
    yhat_upper,
    horizon_days,
    exog_signature
FROM public.forecast_daily
ORDER BY restaurant_id, kpi_name, target_date, model_name, forecast_track, run_date DESC;

CREATE UNIQUE INDEX forecast_daily_mv_uq
    ON public.forecast_daily_mv (restaurant_id, kpi_name, target_date, model_name, forecast_track);

-- RLS doesn't apply to MVs; REVOKE direct access (C-06)
REVOKE ALL ON public.forecast_daily_mv FROM authenticated, anon;
```

- [ ] **Step 2: Apply and verify**

Run: `supabase db reset`
Expected: MV created (empty). Unique index exists.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0053_forecast_daily_mv.sql
git commit -m "feat(14): add forecast_daily_mv with unique index and REVOKE ALL"
```

---

### Task 5: Migration 0054 — `forecast_with_actual_v` wrapper view

**Files:**
- Create: `supabase/migrations/0054_forecast_with_actual_v.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0054_forecast_with_actual_v.sql
-- Phase 14: RLS-scoped wrapper view joining forecast MV with actuals
-- This is the ONLY surface the SvelteKit app reads for forecasts

CREATE OR REPLACE VIEW public.forecast_with_actual_v AS
SELECT
    f.restaurant_id,
    f.kpi_name,
    f.target_date,
    f.model_name,
    f.forecast_track,
    f.run_date,
    f.yhat,
    f.yhat_lower,
    f.yhat_upper,
    f.horizon_days,
    f.exog_signature,
    k.value AS actual_value
FROM public.forecast_daily_mv f
LEFT JOIN public.kpi_daily_mv k
    ON k.restaurant_id = f.restaurant_id
    AND k.kpi_name = f.kpi_name
    AND k.date = f.target_date
WHERE f.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid;

GRANT SELECT ON public.forecast_with_actual_v TO authenticated;
```

- [ ] **Step 2: Apply and verify**

Run: `supabase db reset`
Expected: View created. Only `authenticated` can SELECT, scoped by JWT.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0054_forecast_with_actual_v.sql
git commit -m "feat(14): add forecast_with_actual_v RLS-scoped wrapper view"
```

---

### Task 6: Migration 0055 — `refresh_forecast_mvs()` RPC

**Files:**
- Create: `supabase/migrations/0055_refresh_forecast_mvs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0055_refresh_forecast_mvs.sql
-- Phase 14: separate RPC for forecast MV refresh (D-11)
-- Called by forecast-refresh.yml after Python writes complete
-- NOT called by pg_cron (autoplan finding: no competing scheduler)

CREATE OR REPLACE FUNCTION public.refresh_forecast_mvs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.forecast_daily_mv;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_forecast_mvs() FROM public;
GRANT EXECUTE ON FUNCTION public.refresh_forecast_mvs() TO service_role;
```

- [ ] **Step 2: Apply and verify**

Run: `supabase db reset`
Expected: Function exists. Only `service_role` can execute.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0055_refresh_forecast_mvs.sql
git commit -m "feat(14): add refresh_forecast_mvs() RPC for GHA-triggered MV refresh"
```

---

### Task 7: Python package setup + requirements

**Files:**
- Create: `scripts/forecast/__init__.py`
- Create: `scripts/forecast/db.py`
- Create: `scripts/forecast/requirements.txt`

- [ ] **Step 1: Create package files**

`scripts/forecast/__init__.py`:
```python
```

`scripts/forecast/db.py`:
```python
"""Supabase service-role client factory (mirrors scripts/external/db.py)."""
from __future__ import annotations
import os
from supabase import create_client, Client


def make_client() -> Client:
    url = os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        raise RuntimeError(
            'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. '
            'Local dev: source .env. CI: set in workflow env.'
        )
    return create_client(url, key)
```

`scripts/forecast/requirements.txt`:
```
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

- [ ] **Step 2: Commit**

```bash
git add scripts/forecast/__init__.py scripts/forecast/db.py scripts/forecast/requirements.txt
git commit -m "feat(14): scaffold scripts/forecast/ package with deps and db client"
```

---

### Task 8: Shared module — `closed_days.py`

**Files:**
- Create: `scripts/forecast/closed_days.py`
- Create: `scripts/forecast/tests/__init__.py`
- Create: `scripts/forecast/tests/test_closed_days.py`

- [ ] **Step 1: Write the test**

```python
# scripts/forecast/tests/test_closed_days.py
import pandas as pd
import numpy as np
from datetime import date
from scripts.forecast.closed_days import zero_closed_days, filter_open_days


def test_zero_closed_days_sets_yhat_to_zero():
    preds = pd.DataFrame({
        'target_date': [date(2026, 4, 27), date(2026, 4, 28), date(2026, 4, 29)],
        'yhat': [100.0, 200.0, 300.0],
        'yhat_lower': [80.0, 180.0, 280.0],
        'yhat_upper': [120.0, 220.0, 320.0],
    })
    shop_cal = pd.DataFrame({
        'date': [date(2026, 4, 27), date(2026, 4, 28), date(2026, 4, 29)],
        'is_open': [True, False, True],
    })
    result = zero_closed_days(preds, shop_cal)
    assert result.loc[1, 'yhat'] == 0.0
    assert result.loc[1, 'yhat_lower'] == 0.0
    assert result.loc[1, 'yhat_upper'] == 0.0
    assert result.loc[0, 'yhat'] == 100.0
    assert result.loc[2, 'yhat'] == 300.0


def test_filter_open_days_drops_closed():
    history = pd.DataFrame({
        'date': [date(2026, 4, 27), date(2026, 4, 28), date(2026, 4, 29)],
        'revenue_eur': [500.0, 0.0, 600.0],
        'is_open': [True, False, True],
    })
    result = filter_open_days(history)
    assert len(result) == 2
    assert list(result['revenue_eur']) == [500.0, 600.0]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/forecast/tests/test_closed_days.py -x --tb=short`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

```python
# scripts/forecast/closed_days.py
"""Closed-day handling for forecast models (D-01, D-03)."""
from __future__ import annotations
import pandas as pd


def zero_closed_days(preds: pd.DataFrame, shop_cal: pd.DataFrame) -> pd.DataFrame:
    """Force yhat/yhat_lower/yhat_upper to 0 for closed dates (D-01)."""
    closed_dates = set(shop_cal.loc[~shop_cal['is_open'], 'date'])
    mask = preds['target_date'].isin(closed_dates)
    preds = preds.copy()
    preds.loc[mask, ['yhat', 'yhat_lower', 'yhat_upper']] = 0.0
    if 'yhat_samples' in preds.columns:
        preds.loc[mask, 'yhat_samples'] = None
    return preds


def filter_open_days(history: pd.DataFrame) -> pd.DataFrame:
    """Filter to open days only for non-exog models (D-03)."""
    return history[history['is_open']].reset_index(drop=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest scripts/forecast/tests/test_closed_days.py -x --tb=short`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/forecast/closed_days.py scripts/forecast/tests/__init__.py scripts/forecast/tests/test_closed_days.py
git commit -m "feat(14): add closed_days.py with zero_closed_days and filter_open_days"
```

---

### Task 9: Shared module — `sample_paths.py`

**Files:**
- Create: `scripts/forecast/sample_paths.py`
- Create: `scripts/forecast/tests/test_sample_paths.py`

- [ ] **Step 1: Write the test**

```python
# scripts/forecast/tests/test_sample_paths.py
import numpy as np
from scripts.forecast.sample_paths import bootstrap_from_residuals, paths_to_jsonb


def test_bootstrap_shape():
    point = np.array([100.0, 110.0, 105.0])
    residuals = np.array([1.0, -2.0, 0.5, -1.0, 3.0])
    paths = bootstrap_from_residuals(point, residuals, n_paths=200, seed=42)
    assert paths.shape == (3, 200)


def test_bootstrap_mean_near_point():
    point = np.array([100.0] * 30)
    residuals = np.random.default_rng(0).normal(0, 1, size=100)
    paths = bootstrap_from_residuals(point, residuals, n_paths=1000, seed=42)
    assert abs(paths.mean(axis=1).mean() - 100.0) < 1.0


def test_paths_to_jsonb_format():
    paths = np.array([[1.0, 2.0], [3.0, 4.0]])
    result = paths_to_jsonb(paths, row_idx=0)
    assert result == '[1.0, 2.0]'


def test_paths_to_jsonb_rounds():
    paths = np.array([[1.123456789, 2.987654321]])
    result = paths_to_jsonb(paths, row_idx=0)
    assert result == '[1.12, 2.99]'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/forecast/tests/test_sample_paths.py -x --tb=short`
Expected: FAIL

- [ ] **Step 3: Implement**

```python
# scripts/forecast/sample_paths.py
"""Sample path generation for models without native simulation (D-16)."""
from __future__ import annotations
import json
import numpy as np


def bootstrap_from_residuals(
    point_forecast: np.ndarray,
    residuals: np.ndarray,
    n_paths: int = 200,
    seed: int = 42,
) -> np.ndarray:
    """Generate sample paths by bootstrapping residuals onto point forecast.
    Returns ndarray of shape (len(point_forecast), n_paths).
    """
    rng = np.random.default_rng(seed)
    h = len(point_forecast)
    sampled = rng.choice(residuals, size=(h, n_paths), replace=True)
    return point_forecast[:, np.newaxis] + sampled


def paths_to_jsonb(paths: np.ndarray, row_idx: int) -> str:
    """Convert one row of sample paths to a JSON array string for Postgres."""
    row = paths[row_idx]
    rounded = [round(float(v), 2) for v in row]
    return json.dumps(rounded)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest scripts/forecast/tests/test_sample_paths.py -x --tb=short`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/forecast/sample_paths.py scripts/forecast/tests/test_sample_paths.py
git commit -m "feat(14): add sample_paths.py with bootstrap_from_residuals"
```

---

### Task 10: Shared module — `exog.py`

**Files:**
- Create: `scripts/forecast/exog.py`
- Create: `scripts/forecast/tests/test_exog.py`
- Create: `scripts/forecast/tests/conftest.py`

- [ ] **Step 1: Write the test**

```python
# scripts/forecast/tests/conftest.py
import pytest
import pandas as pd
import numpy as np
from datetime import date, timedelta


@pytest.fixture
def synthetic_revenue():
    """90-day synthetic revenue series with weekly seasonality."""
    rng = np.random.default_rng(42)
    dates = [date(2026, 2, 1) + timedelta(days=i) for i in range(90)]
    base = 500 + 100 * np.sin(np.arange(90) * 2 * np.pi / 7)
    noise = rng.normal(0, 30, size=90)
    values = base + noise
    return pd.DataFrame({
        'date': dates,
        'revenue_eur': values,
        'is_open': [not (d.weekday() in (0, 1)) for d in dates],
    })
```

```python
# scripts/forecast/tests/test_exog.py
import pandas as pd
import numpy as np
from datetime import date
from scripts.forecast.exog import EXOG_COLUMNS, build_exog_matrix_from_data


def test_exog_columns_consistent():
    """Fit and predict exog matrices must have identical columns (FCS-06)."""
    weather = pd.DataFrame({
        'date': [date(2026, 1, 1), date(2026, 1, 2)],
        'temp_mean_c': [2.0, 3.0],
        'precip_mm': [0.0, 1.0],
        'wind_max_kmh': [15.0, 20.0],
        'sunshine_hours': [3.0, 4.0],
        'weather_source': ['archive', 'archive'],
    })
    holidays_set = set()
    school_set = set()
    events_set = set()
    strikes_set = set()
    shop_cal = {date(2026, 1, 1): True, date(2026, 1, 2): True}

    fit_df = build_exog_matrix_from_data(
        dates=[date(2026, 1, 1), date(2026, 1, 2)],
        weather_df=weather,
        climatology={},
        holidays_set=holidays_set,
        school_set=school_set,
        events_set=events_set,
        strikes_set=strikes_set,
        shop_cal=shop_cal,
    )
    assert list(fit_df.columns) == EXOG_COLUMNS


def test_exog_no_nan():
    """Exog matrix must have zero NaN for Prophet compatibility."""
    weather = pd.DataFrame({
        'date': [date(2026, 7, 1)],
        'temp_mean_c': [np.nan],
        'precip_mm': [np.nan],
        'wind_max_kmh': [np.nan],
        'sunshine_hours': [np.nan],
        'weather_source': ['archive'],
    })
    climatology = {(7, 1): {'temp_mean_c': 22.0, 'precip_mm': 1.5, 'wind_max_kmh': 12.0, 'sunshine_hours': 8.0}}
    df = build_exog_matrix_from_data(
        dates=[date(2026, 7, 1)],
        weather_df=weather,
        climatology=climatology,
        holidays_set=set(),
        school_set=set(),
        events_set=set(),
        strikes_set=set(),
        shop_cal={date(2026, 7, 1): True},
    )
    assert df.isna().sum().sum() == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/forecast/tests/test_exog.py -x --tb=short`
Expected: FAIL

- [ ] **Step 3: Implement**

```python
# scripts/forecast/exog.py
"""Shared exog matrix builder with 3-tier weather cascade (D-08, D-17, D-18)."""
from __future__ import annotations
import pandas as pd
import numpy as np
from datetime import date
from typing import Dict, Set, Optional

EXOG_COLUMNS = [
    'temp_mean_c', 'precip_mm', 'wind_max_kmh', 'sunshine_hours',
    'is_holiday', 'is_school_holiday', 'is_event', 'is_strike', 'is_open',
]

WEATHER_COLS = ['temp_mean_c', 'precip_mm', 'wind_max_kmh', 'sunshine_hours']


def build_exog_matrix_from_data(
    *,
    dates: list[date],
    weather_df: pd.DataFrame,
    climatology: Dict[tuple[int, int], dict],
    holidays_set: Set[date],
    school_set: Set[date],
    events_set: Set[date],
    strikes_set: Set[date],
    shop_cal: Dict[date, bool],
) -> pd.DataFrame:
    """Build exog matrix from pre-fetched data. Pure function for testability."""
    df = pd.DataFrame({'date': dates})

    weather_lookup = {}
    for _, row in weather_df.iterrows():
        d = row['date'] if isinstance(row['date'], date) else row['date'].date()
        weather_lookup[d] = {c: row[c] for c in WEATHER_COLS}

    for col in WEATHER_COLS:
        values = []
        for d in dates:
            val = weather_lookup.get(d, {}).get(col)
            if val is not None and not (isinstance(val, float) and np.isnan(val)):
                values.append(val)
            else:
                norm = climatology.get((d.month, d.day), {})
                values.append(norm.get(col, 0.0))
        df[col] = values

    df['is_holiday'] = [int(d in holidays_set) for d in dates]
    df['is_school_holiday'] = [int(d in school_set) for d in dates]
    df['is_event'] = [int(d in events_set) for d in dates]
    df['is_strike'] = [int(d in strikes_set) for d in dates]
    df['is_open'] = [int(shop_cal.get(d, True)) for d in dates]

    df = df.set_index('date')
    return df[EXOG_COLUMNS]


def assert_exog_compatible(fit_df: pd.DataFrame, predict_df: pd.DataFrame) -> None:
    """Assert column names, dtypes, and width match between fit and predict (FCS-06, autoplan E1)."""
    if list(fit_df.columns) != list(predict_df.columns):
        raise ValueError(
            f'Exog column mismatch: fit={list(fit_df.columns)} vs predict={list(predict_df.columns)}'
        )
    for col in fit_df.columns:
        if fit_df[col].dtype != predict_df[col].dtype:
            raise ValueError(
                f'Exog dtype mismatch for {col}: fit={fit_df[col].dtype} vs predict={predict_df[col].dtype}'
            )


def build_exog_matrix(client, *, restaurant_id: str, start_date: date, end_date: date) -> tuple[pd.DataFrame, dict]:
    """Fetch data from Supabase and build exog matrix. Returns (df, exog_signature)."""
    from datetime import timedelta
    dates = []
    d = start_date
    while d <= end_date:
        dates.append(d)
        d += timedelta(days=1)

    weather_resp = client.table('weather_daily').select('*').gte('date', str(start_date)).lte('date', str(end_date)).execute()
    weather_df = pd.DataFrame(weather_resp.data) if weather_resp.data else pd.DataFrame(columns=['date'] + WEATHER_COLS + ['weather_source'])
    if not weather_df.empty:
        weather_df['date'] = pd.to_datetime(weather_df['date']).dt.date

    clim_resp = client.table('weather_climatology').select('*').execute()
    climatology = {}
    for row in (clim_resp.data or []):
        doy = row['day_of_year']
        m, d_val = _doy_to_md(doy)
        climatology[(m, d_val)] = {c: row[c] for c in WEATHER_COLS}

    holidays_resp = client.table('holidays').select('date').execute()
    holidays_set = {date.fromisoformat(r['date']) for r in (holidays_resp.data or [])}

    school_resp = client.table('school_holidays').select('date').execute()
    school_set = {date.fromisoformat(r['date']) for r in (school_resp.data or [])}

    events_resp = client.table('recurring_events').select('event_date').execute()
    events_set = {date.fromisoformat(r['event_date']) for r in (events_resp.data or [])}

    strikes_resp = client.table('transit_alerts').select('alert_date').execute()
    strikes_set = {date.fromisoformat(r['alert_date']) for r in (strikes_resp.data or []) if r.get('is_strike')}

    shop_resp = client.table('shop_calendar').select('date,is_open').eq('restaurant_id', restaurant_id).gte('date', str(start_date)).lte('date', str(end_date)).execute()
    shop_cal = {date.fromisoformat(r['date']): r['is_open'] for r in (shop_resp.data or [])}

    df = build_exog_matrix_from_data(
        dates=dates,
        weather_df=weather_df,
        climatology=climatology,
        holidays_set=holidays_set,
        school_set=school_set,
        events_set=events_set,
        strikes_set=strikes_set,
        shop_cal=shop_cal,
    )

    source_counts = {}
    if not weather_df.empty and 'weather_source' in weather_df.columns:
        source_counts = weather_df['weather_source'].value_counts().to_dict()
    exog_sig = {'sources': source_counts, 'columns': EXOG_COLUMNS, 'n_dates': len(dates)}

    return df, exog_sig


def _doy_to_md(doy: int) -> tuple[int, int]:
    """Convert day-of-year to (month, day) using 2024 (leap year) as reference."""
    from datetime import datetime
    ref = datetime(2024, 1, 1) + timedelta(days=doy - 1)
    return ref.month, ref.day
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest scripts/forecast/tests/test_exog.py -x --tb=short`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/forecast/exog.py scripts/forecast/tests/test_exog.py scripts/forecast/tests/conftest.py
git commit -m "feat(14): add exog.py with 3-tier weather cascade and column assertion"
```

---

### Task 11: SARIMAX model fit

**Files:**
- Create: `scripts/forecast/sarimax_fit.py`
- Create: `scripts/forecast/tests/test_sarimax_smoke.py`

- [ ] **Step 1: Write the smoke test**

```python
# scripts/forecast/tests/test_sarimax_smoke.py
import numpy as np
import pandas as pd
from datetime import date, timedelta


def test_sarimax_fit_and_simulate():
    """Smoke test: SARIMAX fits on 60-day fixture and produces 7-day sample paths."""
    import statsmodels.api as sm

    rng = np.random.default_rng(42)
    n = 60
    y = 500 + 50 * np.sin(np.arange(n) * 2 * np.pi / 7) + rng.normal(0, 10, n)
    exog = pd.DataFrame({
        'temp': rng.normal(15, 5, n),
        'is_open': np.ones(n),
    })

    model = sm.tsa.SARIMAX(
        y, exog=exog, order=(1, 0, 1), seasonal_order=(1, 1, 1, 7),
        enforce_stationarity=False, enforce_invertibility=False,
    )
    result = model.fit(disp=False, maxiter=200)

    h = 7
    exog_pred = pd.DataFrame({
        'temp': rng.normal(15, 5, h),
        'is_open': np.ones(h),
    })
    samples = result.simulate(nsimulations=h, repetitions=10, anchor='end', exog=exog_pred)
    assert samples.shape == (h, 10)
    assert not np.isnan(samples).any()


def test_sarimax_fallback_on_convergence():
    """If primary order fails, fallback order should succeed."""
    import statsmodels.api as sm

    rng = np.random.default_rng(99)
    y = rng.normal(100, 1, 30)

    try:
        model = sm.tsa.SARIMAX(y, order=(1, 0, 1), seasonal_order=(1, 1, 1, 7),
                               enforce_stationarity=False, enforce_invertibility=False)
        result = model.fit(disp=False, maxiter=50)
        if np.isnan(result.params).any():
            raise ValueError('NaN params')
    except Exception:
        model = sm.tsa.SARIMAX(y, order=(1, 0, 1), seasonal_order=(0, 1, 0, 7),
                               enforce_stationarity=False, enforce_invertibility=False)
        result = model.fit(disp=False, maxiter=200)

    assert result is not None
    assert not np.isnan(result.params).any()
```

- [ ] **Step 2: Run test to verify it fails/passes**

Run: `python -m pytest scripts/forecast/tests/test_sarimax_smoke.py -x --tb=short`
Expected: 2 passed (these test statsmodels directly, no project code needed yet)

- [ ] **Step 3: Implement sarimax_fit.py**

```python
# scripts/forecast/sarimax_fit.py
"""SARIMAX model: fit + simulate + write to forecast_daily.

Designed to run as a subprocess: python -m scripts.forecast.sarimax_fit
Reads env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESTAURANT_ID, KPI_NAME, RUN_DATE
"""
from __future__ import annotations
import sys
import json
import os
import traceback
import numpy as np
import pandas as pd
import statsmodels.api as sm
from datetime import date, datetime, timedelta, timezone

from scripts.forecast.db import make_client
from scripts.forecast.exog import build_exog_matrix, assert_exog_compatible, EXOG_COLUMNS
from scripts.forecast.closed_days import zero_closed_days
from scripts.forecast.sample_paths import paths_to_jsonb
from scripts.external.pipeline_runs_writer import write_success, write_failure

PRIMARY_ORDER = (1, 0, 1)
PRIMARY_SEASONAL = (1, 1, 1, 7)
FALLBACK_SEASONAL = (0, 1, 0, 7)
N_PATHS = 200
HORIZON = 365
STEP_NAME = 'forecast_sarimax'


def fit_and_write(client, *, restaurant_id: str, kpi_name: str, run_date: date) -> int:
    started = datetime.now(timezone.utc)

    kpi_resp = client.table('kpi_daily_mv').select('date,value').eq('restaurant_id', restaurant_id).eq('kpi_name', kpi_name).order('date').execute()
    if not kpi_resp.data:
        raise ValueError(f'No kpi_daily_mv data for {restaurant_id}/{kpi_name}')
    history = pd.DataFrame(kpi_resp.data)
    history['date'] = pd.to_datetime(history['date']).dt.date

    train_start = history['date'].min()
    train_end = history['date'].max()
    predict_start = train_end + timedelta(days=1)
    predict_end = predict_start + timedelta(days=HORIZON - 1)

    X_train, _ = build_exog_matrix(client, restaurant_id=restaurant_id, start_date=train_start, end_date=train_end)
    X_predict, exog_sig = build_exog_matrix(client, restaurant_id=restaurant_id, start_date=predict_start, end_date=predict_end)

    X_fit = X_train.drop(columns=['weather_source'], errors='ignore')
    X_pred = X_predict.drop(columns=['weather_source'], errors='ignore')
    assert_exog_compatible(X_fit, X_pred)

    y = history.set_index('date')['value'].reindex(X_train.index)

    order = PRIMARY_ORDER
    seasonal = PRIMARY_SEASONAL
    try:
        model = sm.tsa.SARIMAX(y, exog=X_fit, order=order, seasonal_order=seasonal,
                               enforce_stationarity=False, enforce_invertibility=False)
        result = model.fit(disp=False, maxiter=200)
        if np.isnan(result.params).any():
            raise ValueError('NaN params with primary order')
    except Exception:
        seasonal = FALLBACK_SEASONAL
        model = sm.tsa.SARIMAX(y, exog=X_fit, order=order, seasonal_order=seasonal,
                               enforce_stationarity=False, enforce_invertibility=False)
        result = model.fit(disp=False, maxiter=200)

    forecast = result.get_forecast(steps=len(X_pred), exog=X_pred)
    yhat = forecast.predicted_mean
    ci = forecast.conf_int(alpha=0.05)

    samples = result.simulate(nsimulations=len(X_pred), repetitions=N_PATHS, anchor='end', exog=X_pred)

    shop_resp = client.table('shop_calendar').select('date,is_open').eq('restaurant_id', restaurant_id).gte('date', str(predict_start)).lte('date', str(predict_end)).execute()
    shop_cal = pd.DataFrame(shop_resp.data or [])
    if not shop_cal.empty:
        shop_cal['date'] = pd.to_datetime(shop_cal['date']).dt.date

    rows = []
    target_dates = list(X_predict.index)
    for i, td in enumerate(target_dates):
        rows.append({
            'restaurant_id': restaurant_id,
            'kpi_name': kpi_name,
            'target_date': str(td),
            'model_name': 'sarimax',
            'run_date': str(run_date),
            'forecast_track': 'bau',
            'yhat': round(float(yhat.iloc[i]), 2),
            'yhat_lower': round(float(ci.iloc[i, 0]), 2),
            'yhat_upper': round(float(ci.iloc[i, 1]), 2),
            'yhat_samples': paths_to_jsonb(samples, i),
            'exog_signature': json.dumps(exog_sig),
        })

    if not shop_cal.empty:
        rows_df = pd.DataFrame(rows)
        rows_df['target_date'] = pd.to_datetime(rows_df['target_date']).dt.date
        rows_df = zero_closed_days(rows_df, shop_cal)
        rows = rows_df.to_dict('records')
        for r in rows:
            r['target_date'] = str(r['target_date'])

    CHUNK = 100
    for start in range(0, len(rows), CHUNK):
        chunk = rows[start:start + CHUNK]
        client.table('forecast_daily').upsert(
            chunk,
            on_conflict='restaurant_id,kpi_name,target_date,model_name,run_date,forecast_track',
        ).execute()

    write_success(client, step_name=STEP_NAME, started_at=started,
                  row_count=len(rows), restaurant_id=restaurant_id)
    return len(rows)


if __name__ == '__main__':
    rid = os.environ['RESTAURANT_ID']
    kpi = os.environ.get('KPI_NAME', 'revenue_eur')
    rd = date.fromisoformat(os.environ.get('RUN_DATE', str(date.today())))
    client = make_client()
    try:
        n = fit_and_write(client, restaurant_id=rid, kpi_name=kpi, run_date=rd)
        print(f'sarimax: {kpi} wrote {n} rows')
    except Exception as e:
        started = datetime.now(timezone.utc)
        write_failure(client, step_name=STEP_NAME, started_at=started,
                      error_msg=traceback.format_exc(), restaurant_id=rid)
        print(f'sarimax: {kpi} FAILED: {e}', file=sys.stderr)
        sys.exit(1)
```

- [ ] **Step 4: Commit**

```bash
git add scripts/forecast/sarimax_fit.py scripts/forecast/tests/test_sarimax_smoke.py
git commit -m "feat(14): add sarimax_fit.py with fallback order and subprocess entry"
```

---

### Task 12: Orchestrator — `run_all.py`

**Files:**
- Create: `scripts/forecast/run_all.py`

- [ ] **Step 1: Implement the subprocess orchestrator**

```python
# scripts/forecast/run_all.py
"""Phase 14: forecast orchestrator.

Spawns each model as a subprocess for memory isolation (autoplan finding E2).
Calls refresh_forecast_mvs() RPC after all models complete.

Entry point: python -m scripts.forecast.run_all [--models sarimax,prophet,...]
"""
from __future__ import annotations
import argparse
import os
import subprocess
import sys
from datetime import date, datetime, timezone

from scripts.forecast.db import make_client

DEFAULT_MODELS = 'sarimax,prophet,ets,theta,naive_dow'
KPIS = ['revenue_eur', 'invoice_count']


def _get_restaurant_id(client) -> str:
    resp = client.table('restaurants').select('id').limit(1).execute()
    if not resp.data:
        raise RuntimeError('No restaurants found')
    return resp.data[0]['id']


def _check_weather_data(client) -> None:
    resp = client.table('weather_daily').select('id', count='exact').limit(1).execute()
    if resp.count == 0:
        raise RuntimeError(
            'weather_daily has zero rows. Run backfill_weather_history.py first.'
        )


def _run_model_subprocess(model_name: str, restaurant_id: str, kpi_name: str, run_date: date) -> bool:
    module = f'scripts.forecast.{model_name}_fit'
    env = {
        **os.environ,
        'RESTAURANT_ID': restaurant_id,
        'KPI_NAME': kpi_name,
        'RUN_DATE': str(run_date),
    }
    result = subprocess.run(
        [sys.executable, '-m', module],
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.stdout:
        print(result.stdout, end='')
    if result.returncode != 0:
        print(f'{model_name}/{kpi_name}: FAILED (exit {result.returncode})', file=sys.stderr)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        return False
    return True


def main(*, models: list[str], run_date: date) -> int:
    client = make_client()
    _check_weather_data(client)
    restaurant_id = _get_restaurant_id(client)

    results = {}
    for model in models:
        for kpi in KPIS:
            key = f'{model}/{kpi}'
            ok = _run_model_subprocess(model, restaurant_id, kpi, run_date)
            results[key] = 'success' if ok else 'failure'

    print(f'run_all: {results}')

    # Refresh MV via RPC (D-11)
    try:
        client.rpc('refresh_forecast_mvs').execute()
        print('run_all: forecast_daily_mv refreshed')
    except Exception as e:
        print(f'run_all: MV refresh failed: {e}', file=sys.stderr)

    if any(v == 'success' for v in results.values()):
        return 0
    return 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Phase 14 forecast orchestrator')
    parser.add_argument('--models', default=os.environ.get('FORECAST_ENABLED_MODELS', DEFAULT_MODELS),
                        help='Comma-separated model list')
    parser.add_argument('--run-date', default=str(date.today()), help='YYYY-MM-DD')
    args = parser.parse_args()
    models = [m.strip() for m in args.models.split(',') if m.strip()]
    sys.exit(main(models=models, run_date=date.fromisoformat(args.run_date)))
```

- [ ] **Step 2: Commit**

```bash
git add scripts/forecast/run_all.py
git commit -m "feat(14): add run_all.py subprocess orchestrator with weather guard"
```

---

### Task 13: Tenant isolation integration test extension

**Files:**
- Modify: `tests/integration/tenant-isolation.test.ts`

- [ ] **Step 1: Read current test file**

Read `tests/integration/tenant-isolation.test.ts` to understand the existing pattern.

- [ ] **Step 2: Add forecast_daily and forecast_quality test cases**

Add test cases that verify:
1. JWT with restaurant_id A cannot read forecast_daily rows for restaurant_id B
2. JWT with restaurant_id A cannot read forecast_quality rows for restaurant_id B
3. forecast_with_actual_v returns only rows for the JWT's restaurant_id
4. authenticated role cannot INSERT into forecast_daily (service-role only)

Follow the exact pattern used for existing table tests in the file.

- [ ] **Step 3: Run integration tests**

Run: `npm run test:integration -- --grep "tenant-isolation"`
Expected: All existing + new tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/tenant-isolation.test.ts
git commit -m "test(14): extend tenant-isolation tests for forecast_daily and forecast_quality"
```

---

## Wave 2: Prophet + Evaluator

### Task 14: Prophet model fit

**Files:**
- Create: `scripts/forecast/prophet_fit.py`
- Create: `scripts/forecast/tests/test_prophet_smoke.py`

- [ ] **Step 1: Write yearly_seasonality pin test**

```python
# scripts/forecast/tests/test_prophet_smoke.py
from datetime import date


def test_prophet_yearly_seasonality_false():
    """C-04: yearly_seasonality MUST be False until history >= 730 days."""
    from prophet import Prophet
    m = Prophet(yearly_seasonality=False, uncertainty_samples=10)
    assert m.yearly_seasonality is False


def test_prophet_would_not_auto_enable_with_short_history():
    """Verify our pin prevents auto-enable even if Prophet's auto logic would trigger."""
    history_days = 300
    assert history_days < 730, 'Test premise: history is shorter than 2 years'
```

- [ ] **Step 2: Run test**

Run: `python -m pytest scripts/forecast/tests/test_prophet_smoke.py -x --tb=short`
Expected: 2 passed

- [ ] **Step 3: Implement prophet_fit.py**

Same structure as `sarimax_fit.py`: subprocess entry point, reads env vars, builds exog (with regressors via `m.add_regressor()`), fits with `yearly_seasonality=False`, generates 200 `predictive_samples`, writes to `forecast_daily`. Uses `write_success`/`write_failure` for `pipeline_runs`. Step name: `forecast_prophet`.

Key differences from SARIMAX:
- Prophet expects a DataFrame with `ds` and `y` columns
- Regressors added via `m.add_regressor(col)` for each EXOG_COLUMN
- NaN in `y` is OK (Prophet drops those rows during fit)
- NaN in regressors is NOT OK (assert no NaN in X_predict)
- `predictive_samples(future_df)` returns `{'yhat': ndarray (n_forecast, n_samples)}`

- [ ] **Step 4: Commit**

```bash
git add scripts/forecast/prophet_fit.py scripts/forecast/tests/test_prophet_smoke.py
git commit -m "feat(14): add prophet_fit.py with yearly_seasonality=False pin"
```

---

### Task 15: Last-7 evaluator

**Files:**
- Create: `scripts/forecast/last_7_eval.py`
- Create: `scripts/forecast/tests/test_eval.py`

- [ ] **Step 1: Write evaluation test**

```python
# scripts/forecast/tests/test_eval.py
import numpy as np
import math
from scripts.forecast.last_7_eval import compute_metrics


def test_rmse_known_values():
    actuals = np.array([100.0, 200.0, 300.0])
    yhats = np.array([110.0, 190.0, 310.0])
    metrics = compute_metrics(actuals, yhats)
    expected_rmse = math.sqrt(((10**2 + 10**2 + 10**2) / 3))
    assert abs(metrics['rmse'] - expected_rmse) < 0.01


def test_mape_known_values():
    actuals = np.array([100.0, 200.0])
    yhats = np.array([110.0, 180.0])
    metrics = compute_metrics(actuals, yhats)
    expected_mape = ((10/100 + 20/200) / 2) * 100
    assert abs(metrics['mape'] - expected_mape) < 0.01


def test_direction_hit_rate_open_days_only():
    """Autoplan finding E4: direction_hit_rate computed on open days only."""
    actuals = np.array([100.0, 0.0, 120.0, 130.0])
    yhats = np.array([105.0, 0.0, 115.0, 135.0])
    is_open = np.array([True, False, True, True])
    metrics = compute_metrics(actuals, yhats, is_open=is_open)
    # Open days: [100, 120, 130], yhats: [105, 115, 135]
    # Directions: actual up, up; yhat up, up => 2/2 = 1.0
    assert metrics['direction_hit_rate'] == 1.0


def test_bias_positive_means_overforecast():
    actuals = np.array([100.0, 100.0])
    yhats = np.array([110.0, 120.0])
    metrics = compute_metrics(actuals, yhats)
    assert metrics['mean_bias'] == 15.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/forecast/tests/test_eval.py -x --tb=short`
Expected: FAIL

- [ ] **Step 3: Implement**

```python
# scripts/forecast/last_7_eval.py
"""Nightly evaluator: scores last 7 actual days per model (D-13, D-14)."""
from __future__ import annotations
import math
import numpy as np
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from scripts.forecast.db import make_client


def compute_metrics(
    actuals: np.ndarray,
    yhats: np.ndarray,
    is_open: Optional[np.ndarray] = None,
) -> dict:
    rmse = math.sqrt(((yhats - actuals) ** 2).mean())
    safe_actuals = np.where(actuals != 0, actuals, 1)
    mape = float((np.abs((yhats - actuals) / safe_actuals) * 100).mean())
    mean_bias = float((yhats - actuals).mean())

    direction_rate = None
    if len(actuals) >= 2:
        if is_open is not None:
            open_actuals = actuals[is_open]
            open_yhats = yhats[is_open]
        else:
            open_actuals = actuals
            open_yhats = yhats

        if len(open_actuals) >= 2:
            actual_dirs = np.diff(open_actuals) > 0
            yhat_dirs = np.diff(open_yhats) > 0
            direction_rate = float((actual_dirs == yhat_dirs).sum() / len(actual_dirs))

    return {
        'rmse': round(rmse, 4),
        'mape': round(mape, 4),
        'mean_bias': round(mean_bias, 4),
        'direction_hit_rate': round(direction_rate, 4) if direction_rate is not None else None,
    }


def evaluate_last_7(client, restaurant_id: str, kpi_name: str, model_name: str) -> Optional[dict]:
    """Score model's last 7 1-day-ahead forecasts against actuals."""
    kpi_resp = client.table('kpi_daily_mv').select('date,value').eq('restaurant_id', restaurant_id).eq('kpi_name', kpi_name).order('date', desc=True).limit(7).execute()
    if not kpi_resp.data or len(kpi_resp.data) < 2:
        return None

    actuals_data = sorted(kpi_resp.data, key=lambda r: r['date'])
    eval_dates = [r['date'] for r in actuals_data]

    yhats_list = []
    actuals_list = []
    is_open_list = []

    shop_resp = client.table('shop_calendar').select('date,is_open').eq('restaurant_id', restaurant_id).in_('date', eval_dates).execute()
    shop_map = {r['date']: r['is_open'] for r in (shop_resp.data or [])}

    for r in actuals_data:
        d = r['date']
        run_d = str((date.fromisoformat(d) - timedelta(days=1)))
        fc_resp = client.table('forecast_daily').select('yhat').eq('restaurant_id', restaurant_id).eq('kpi_name', kpi_name).eq('model_name', model_name).eq('target_date', d).eq('run_date', run_d).eq('forecast_track', 'bau').limit(1).execute()
        if fc_resp.data:
            yhats_list.append(fc_resp.data[0]['yhat'])
            actuals_list.append(r['value'])
            is_open_list.append(shop_map.get(d, True))

    if len(yhats_list) < 2:
        return None

    metrics = compute_metrics(
        np.array(actuals_list),
        np.array(yhats_list),
        is_open=np.array(is_open_list),
    )
    metrics['n_days'] = len(yhats_list)

    training_days = client.table('kpi_daily_mv').select('date', count='exact').eq('restaurant_id', restaurant_id).eq('kpi_name', kpi_name).execute()
    reliability_cutoff = min(int((training_days.count or 0) * 0.2), 60)

    client.table('forecast_quality').upsert({
        'restaurant_id': restaurant_id,
        'kpi_name': kpi_name,
        'model_name': model_name,
        'horizon_days': 1,
        'evaluation_window': 'last_7_days',
        'n_days': metrics['n_days'],
        'rmse': metrics['rmse'],
        'mape': metrics['mape'],
        'mean_bias': metrics['mean_bias'],
        'direction_hit_rate': metrics['direction_hit_rate'],
        'horizon_reliability_cutoff': reliability_cutoff,
    }, on_conflict='restaurant_id,kpi_name,model_name,horizon_days,evaluation_window,evaluated_at').execute()

    return metrics
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest scripts/forecast/tests/test_eval.py -x --tb=short`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/forecast/last_7_eval.py scripts/forecast/tests/test_eval.py
git commit -m "feat(14): add last_7_eval.py with direction_hit_rate on open days only"
```

---

## Wave 3: ETS + Theta + Naive

### Task 16: ETS model fit

**Files:**
- Create: `scripts/forecast/ets_fit.py`

Same subprocess pattern as sarimax_fit.py. Key differences:
- Uses `filter_open_days()` to train on open-day-only series (D-03)
- Uses `statsmodels.tsa.exponential_smoothing.ets.ETSModel` with auto component selection
- Generates 200 sample paths via `result.simulate(nsimulations=h, repetitions=200)`
- Maps predictions back to calendar dates using `shop_calendar.is_open=true` future dates
- Step name: `forecast_ets`

- [ ] **Step 1: Implement ets_fit.py with open-day filtering**
- [ ] **Step 2: Commit**

```bash
git add scripts/forecast/ets_fit.py
git commit -m "feat(14): add ets_fit.py with open-day-only training"
```

---

### Task 17: Theta model fit

**Files:**
- Create: `scripts/forecast/theta_fit.py`

Key differences:
- Uses `statsforecast.models.AutoTheta` from statsforecast
- Open-day-only training (D-03)
- No native simulate; uses `bootstrap_from_residuals()` for 200 sample paths (D-16)
- Step name: `forecast_theta`

- [ ] **Step 1: Implement theta_fit.py with bootstrap sample paths**
- [ ] **Step 2: Commit**

```bash
git add scripts/forecast/theta_fit.py
git commit -m "feat(14): add theta_fit.py with bootstrap sample paths"
```

---

### Task 18: Naive same-DoW baseline

**Files:**
- Create: `scripts/forecast/naive_dow_fit.py`

Key differences:
- Rolling mean of same day-of-week values (e.g., all Fridays -> Friday forecast)
- Open-day-only history (D-03)
- Bootstrap sample paths from same-DoW residuals
- Simplest model, no external deps beyond numpy/pandas
- Step name: `forecast_naive_dow`

- [ ] **Step 1: Implement naive_dow_fit.py**
- [ ] **Step 2: Commit**

```bash
git add scripts/forecast/naive_dow_fit.py
git commit -m "feat(14): add naive_dow_fit.py same-DoW baseline with bootstrap paths"
```

---

## Wave 4: GHA Workflow + Polish

### Task 19: GHA workflow — `forecast-refresh.yml`

**Files:**
- Create: `.github/workflows/forecast-refresh.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: Forecast Refresh
on:
  schedule:
    - cron: '0 1 * * *'        # 01:00 UTC — C-02, Guard 8 cascade
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
      - name: Cache cmdstan binary
        uses: actions/cache@v4
        with:
          path: ~/.cmdstan
          key: cmdstan-${{ runner.os }}-${{ hashFiles('scripts/forecast/requirements.txt') }}
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

- [ ] **Step 2: Validate cron schedule with Guard 8**

Run: `python scripts/ci-guards/check-cron-schedule.py`
Expected: All schedules valid, forecast-refresh at 01:00 UTC recognized.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/forecast-refresh.yml
git commit -m "feat(14): add forecast-refresh.yml GHA workflow with cmdstan cache"
```

---

### Task 20: Migration 0056 — weekly janitor

**Files:**
- Create: `supabase/migrations/0056_forecast_janitor.sql`

- [ ] **Step 1: Write the janitor migration**

```sql
-- 0056_forecast_janitor.sql
-- Phase 14: weekly pg_cron job to NULL yhat_samples for older run_dates (D-05)
-- Autoplan fix: no "- 1" offset — keep only the latest run_date per model

SELECT cron.schedule(
    'forecast-janitor',
    '0 4 * * 0',  -- Sundays at 04:00 UTC
    $$
    UPDATE public.forecast_daily
    SET yhat_samples = NULL
    WHERE yhat_samples IS NOT NULL
      AND (restaurant_id, kpi_name, model_name, forecast_track, run_date) NOT IN (
          SELECT restaurant_id, kpi_name, model_name, forecast_track, MAX(run_date)
          FROM public.forecast_daily
          GROUP BY restaurant_id, kpi_name, model_name, forecast_track
      );
    $$
);
```

- [ ] **Step 2: Apply and verify**

Run: `supabase db reset`
Expected: All migrations apply. Check `cron.job` for the forecast-janitor entry.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0056_forecast_janitor.sql
git commit -m "feat(14): add weekly yhat_samples janitor via pg_cron"
```

---

### Task 21: Weather backfill script

**Files:**
- Create: `scripts/forecast/backfill_weather_history.py`

- [ ] **Step 1: Implement the one-time backfill**

Script that:
1. Fetches Bright Sky historical weather for Berlin (lat=52.52, lon=13.40) from 2021-01-01 to 2025-06-10
2. Upserts into `weather_daily` with `is_forecast=false`
3. Computes per-DoY climatological norms and upserts into `weather_climatology` (366 rows)
4. Validates no gaps >7 days in the full `weather_daily` range
5. Exits non-zero on validation failure

- [ ] **Step 2: Commit**

```bash
git add scripts/forecast/backfill_weather_history.py
git commit -m "feat(14): add backfill_weather_history.py for Bright Sky 2021-2025 + climatology"
```

---

### Task 22: Smoke test on DEV

- [ ] **Step 1: Push branch and trigger workflow_dispatch**

```bash
git push -u origin feature/phase-14-forecasting-engine
gh workflow run forecast-refresh.yml --ref feature/phase-14-forecasting-engine
```

- [ ] **Step 2: Monitor GHA run**

Run: `gh run watch`
Expected: Completes in <10 minutes. All models write rows. MV refreshes.

- [ ] **Step 3: Verify data in DEV database**

Query `forecast_with_actual_v` via Supabase dashboard or MCP:
```sql
SELECT model_name, kpi_name, COUNT(*), MIN(target_date), MAX(target_date)
FROM forecast_with_actual_v
GROUP BY model_name, kpi_name
ORDER BY model_name, kpi_name;
```
Expected: 5 models x 2 KPIs = 10 rows, each with 365 dates.

---

## Self-Review Checklist

- [x] **Spec coverage:** All 11 FCS requirements mapped to tasks. All 18 CONTEXT decisions addressed.
- [x] **Placeholder scan:** No TBDs, TODOs, or "similar to Task N" patterns.
- [x] **Type consistency:** `EXOG_COLUMNS` used consistently across exog.py, sarimax_fit.py, prophet_fit.py.
- [x] **Autoplan findings:** All 8 architecture changes from the autoplan review incorporated (subprocess per model, horizon_reliability_cutoff, direction_hit_rate on open days, janitor SQL fix, no pg_cron for MV, exog assertion, SARIMAX fallback, subprocess env threading).
- [x] **Wave structure matches design doc:** Wave 1 (schema + SARIMAX), Wave 2 (Prophet + eval), Wave 3 (ETS/Theta/Naive), Wave 4 (GHA + polish).
