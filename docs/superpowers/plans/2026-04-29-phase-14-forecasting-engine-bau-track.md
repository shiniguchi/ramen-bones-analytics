# Phase 14: Forecasting Engine — BAU Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the nightly Python forecast pipeline that writes 365-day-forward BAU predictions for `revenue_eur` and `invoice_count` using five models (SARIMAX, Prophet, ETS, Theta, Naive same-DoW), evaluates accuracy, and exposes results via an RLS-scoped wrapper view.

**Architecture:** Python scripts in `scripts/forecast/` mirror Phase 13's `scripts/external/` pattern — one file per model, shared exog builder and closed-day utilities, `run_all.py` orchestrator. GHA workflow `forecast-refresh.yml` runs at 01:00 UTC. Supabase stores forecasts in `forecast_daily` (long format with 200 sample paths in jsonb), accuracy in `forecast_quality`, and exposes a `forecast_daily_mv` → `forecast_with_actual_v` wrapper chain.

**Tech Stack:** Python 3.12 + statsmodels 0.14.6 (SARIMAX, ETS) + prophet 1.3.0 + statsforecast 2.0.3 (Theta) + pandas + numpy + supabase-py. Postgres migrations for tables/MV/view. GitHub Actions for cron.

**Key references:**
- `.planning/phases/14-forecasting-engine-bau-track/14-CONTEXT.md` — all closed decisions (D-01..D-10, C-01..C-06)
- `.planning/phases/14-forecasting-engine-bau-track/14-RESEARCH.md` — library APIs, patterns, pitfalls
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §7 lines 827-865 — schema sketches (apply C-01 `tenant_id` → `restaurant_id` rename)
- `scripts/external/` (Phase 13 worktree) — orchestrator, pipeline_runs_writer, db.py patterns
- `supabase/migrations/0025_item_counts_daily_mv.sql` — MV + wrapper view + REVOKE + test helper pattern

**Migration numbering:** Phase 13 ends at 0049. Phase 14 starts at 0050.

---

## File Structure

```
scripts/forecast/
  __init__.py
  run_all.py               # Orchestrator — iterates enabled models, calls fits + evaluator
  db.py                    # Supabase client factory (mirrors scripts/external/db.py)
  exog_builder.py          # Shared exog matrix: 3-tier weather cascade + binary regressors
  closed_days.py           # zero_closed_days() + open-day-only series builder
  sample_paths.py          # bootstrap_from_residuals(), paths_to_jsonb(), aggregate_ci()
  writer.py                # write_forecast_batch() — upserts rows to forecast_daily
  sarimax_fit.py           # SARIMAX model fit + simulate
  prophet_fit.py           # Prophet model fit + predictive_samples
  ets_fit.py               # ETS model fit + simulate
  theta_fit.py             # Theta model fit + bootstrap sample paths
  naive_dow_fit.py         # Naive same-DoW baseline + bootstrap
  last_7_eval.py           # Nightly evaluator — scores last 7 actual days per model
  backfill_weather_history.py  # One-time: Bright Sky 2021-01-01 → 2025-06-10
  requirements.txt

scripts/forecast/tests/
  conftest.py              # Shared fixtures: synthetic 90-day series, mock exog, mock client
  test_exog_builder.py     # Column alignment, weather cascade, NaN checks
  test_closed_days.py      # NaN insertion, zero_closed_days, open-day-only filter
  test_sample_paths.py     # Bootstrap shape, path count, CI computation
  test_sarimax_smoke.py    # Smoke: fit 30-day fixture, predict 7 days, shape checks
  test_prophet_smoke.py    # yearly_seasonality=False assertion, regressor NaN guard
  test_ets_smoke.py        # Smoke: fit + simulate shape
  test_theta_smoke.py      # Smoke: fit + bootstrap shape
  test_naive_dow_smoke.py  # Smoke: rolling-mean + bootstrap shape
  test_eval.py             # RMSE/MAPE/bias/direction on known values
  test_writer.py           # Batch upsert chunking, payload structure
  test_run_all.py          # Orchestrator: partial failure handling, exit codes

supabase/migrations/
  0050_forecast_daily.sql          # Table + RLS + index
  0051_forecast_quality.sql        # Table + RLS
  0052_forecast_daily_mv.sql       # MV + unique index + REVOKE + wrapper view + test helper
  0053_weather_climatology.sql     # 366-row lookup for cascade tier 3
  0054_forecast_mv_refresh.sql     # Extend refresh_analytics_mvs() + pg_cron re-register
  0055_forecast_samples_janitor.sql # Weekly pg_cron to NULL old yhat_samples

.github/workflows/
  forecast-refresh.yml             # Nightly at 01:00 UTC + workflow_dispatch

tests/integration/
  tenant-isolation.test.ts         # Extended with forecast_daily + forecast_quality cases
```

---

### Task 1: Database Schema — `forecast_daily` table

**Files:**
- Create: `supabase/migrations/0050_forecast_daily.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0050_forecast_daily.sql
-- Phase 14: forecast_daily table — long format, multi-model, multi-horizon.
-- Source: 12-PROPOSAL.md §7 with C-01 rename (tenant_id → restaurant_id).
-- PK includes forecast_track (D-04 from 14-CONTEXT) for Phase 16 readiness.

create table public.forecast_daily (
  restaurant_id uuid not null references public.restaurants(id),
  kpi_name text not null,
  target_date date not null,
  model_name text not null,
  run_date date not null,
  forecast_track text not null default 'bau',
  yhat numeric not null,
  yhat_lower numeric,
  yhat_upper numeric,
  yhat_samples jsonb,
  ci_level numeric not null default 0.95,
  horizon_days int generated always as ((target_date - run_date)) stored,
  exog_signature jsonb,
  fitted_at timestamptz not null default now(),
  primary key (restaurant_id, kpi_name, target_date, model_name, run_date, forecast_track)
);

alter table public.forecast_daily enable row level security;

create policy forecast_daily_tenant_read on public.forecast_daily
  for select using (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid);

create policy forecast_daily_service_write on public.forecast_daily
  for all using (true) with check (true);
grant all on public.forecast_daily to service_role;

-- Revoke direct write from authenticated/anon (hybrid RLS — C-06)
revoke insert, update, delete on public.forecast_daily from authenticated, anon;

create index forecast_daily_horizon_idx
  on public.forecast_daily (restaurant_id, model_name, horizon_days);

create index forecast_daily_run_date_idx
  on public.forecast_daily (restaurant_id, run_date desc);
```

- [ ] **Step 2: Apply migration locally and verify**

Run: `cd supabase && supabase db push --local 2>&1 | tail -5`
Expected: migration applies without error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0050_forecast_daily.sql
git commit -m "feat(14): add forecast_daily table with RLS + horizon_days generated column"
```

---

### Task 2: Database Schema — `forecast_quality` table

**Files:**
- Create: `supabase/migrations/0051_forecast_quality.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0051_forecast_quality.sql
-- Phase 14: forecast_quality table — per-model nightly evaluation results.
-- Source: 12-PROPOSAL.md §7 + 14-CONTEXT FCS-07 + hover-popup spec additions.
-- Added: evaluation_window discriminator (14-CONTEXT discretion), bias, direction_hit_rate.

create table public.forecast_quality (
  restaurant_id uuid not null references public.restaurants(id),
  kpi_name text not null,
  model_name text not null,
  evaluation_window text not null default 'last_7_days',
  n_days int not null,
  rmse numeric not null,
  mape numeric not null,
  bias numeric,
  direction_hit_rate numeric,
  evaluated_at timestamptz not null default now(),
  primary key (restaurant_id, kpi_name, model_name, evaluation_window, evaluated_at)
);

alter table public.forecast_quality enable row level security;

create policy forecast_quality_tenant_read on public.forecast_quality
  for select using (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid);

create policy forecast_quality_service_write on public.forecast_quality
  for all using (true) with check (true);
grant all on public.forecast_quality to service_role;

revoke insert, update, delete on public.forecast_quality from authenticated, anon;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0051_forecast_quality.sql
git commit -m "feat(14): add forecast_quality table with evaluation_window discriminator"
```

---

### Task 3: Database Schema — `forecast_daily_mv` + wrapper view

**Files:**
- Create: `supabase/migrations/0052_forecast_daily_mv.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0052_forecast_daily_mv.sql
-- Phase 14: forecast_daily_mv (latest run per key) + forecast_with_actual_v wrapper.
-- Pattern: 0025_item_counts_daily_mv.sql (MV + unique index + REVOKE + wrapper + test helper).

create materialized view public.forecast_daily_mv as
select
  fd.restaurant_id,
  fd.kpi_name,
  fd.target_date,
  fd.model_name,
  fd.forecast_track,
  fd.run_date,
  fd.yhat,
  fd.yhat_lower,
  fd.yhat_upper,
  fd.yhat_samples,
  fd.ci_level,
  fd.horizon_days,
  fd.exog_signature,
  fd.fitted_at
from public.forecast_daily fd
inner join (
  select
    restaurant_id, kpi_name, target_date, model_name, forecast_track,
    max(run_date) as max_run_date
  from public.forecast_daily
  group by restaurant_id, kpi_name, target_date, model_name, forecast_track
) latest
  on  fd.restaurant_id = latest.restaurant_id
  and fd.kpi_name      = latest.kpi_name
  and fd.target_date    = latest.target_date
  and fd.model_name     = latest.model_name
  and fd.forecast_track = latest.forecast_track
  and fd.run_date       = latest.max_run_date;

-- Unique index for REFRESH CONCURRENTLY
create unique index forecast_daily_mv_pk
  on public.forecast_daily_mv (restaurant_id, kpi_name, target_date, model_name, forecast_track);

-- Lock raw MV (C-06)
revoke all on public.forecast_daily_mv from anon, authenticated;

-- Wrapper view: joins forecast MV with kpi_daily_v actuals, tenant-scoped via JWT
create view public.forecast_with_actual_v as
select
  f.restaurant_id,
  f.kpi_name,
  f.target_date,
  f.model_name,
  f.forecast_track,
  f.run_date,
  f.yhat,
  f.yhat_lower,
  f.yhat_upper,
  f.ci_level,
  f.horizon_days,
  f.exog_signature,
  f.fitted_at,
  case
    when f.kpi_name = 'revenue_eur' then k.revenue_eur
    when f.kpi_name = 'invoice_count' then k.invoice_count::numeric
    else null
  end as actual
from public.forecast_daily_mv f
left join public.kpi_daily_mv k
  on  k.restaurant_id = f.restaurant_id
  and k.business_date  = f.target_date
where f.restaurant_id::text = (auth.jwt() ->> 'restaurant_id');

grant select on public.forecast_with_actual_v to authenticated;

-- Test helper (mirrors 0025 pattern)
create or replace function public.test_forecast_with_actual(rid uuid)
returns table (
  restaurant_id  uuid,
  kpi_name       text,
  target_date    date,
  model_name     text,
  forecast_track text,
  run_date       date,
  yhat           numeric,
  yhat_lower     numeric,
  yhat_upper     numeric,
  ci_level       numeric,
  horizon_days   int,
  exog_signature jsonb,
  fitted_at      timestamptz,
  actual         numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('restaurant_id', rid::text)::text, true);
  return query select * from public.forecast_with_actual_v;
end;
$$;
revoke all on function public.test_forecast_with_actual(uuid) from public, anon, authenticated;
grant execute on function public.test_forecast_with_actual(uuid) to service_role;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0052_forecast_daily_mv.sql
git commit -m "feat(14): add forecast_daily_mv + forecast_with_actual_v wrapper view"
```

---

### Task 4: Database Schema — `weather_climatology` lookup + MV refresh + janitor

**Files:**
- Create: `supabase/migrations/0053_weather_climatology.sql`
- Create: `supabase/migrations/0054_forecast_mv_refresh.sql`
- Create: `supabase/migrations/0055_forecast_samples_janitor.sql`

- [ ] **Step 1: Write weather_climatology migration**

```sql
-- 0053_weather_climatology.sql
-- Phase 14: 366-row per-DoY weather lookup for cascade tier 3 (D-06).
-- Populated by backfill_weather_history.py after one-time Bright Sky fetch.

create table public.weather_climatology (
  month smallint not null,
  day smallint not null,
  temp_mean_c numeric,
  precip_mm numeric,
  wind_max_kmh numeric,
  sunshine_hours numeric,
  n_years int not null default 0,
  primary key (month, day)
);

-- Public read, service-role write only
alter table public.weather_climatology enable row level security;
create policy weather_climatology_read on public.weather_climatology
  for select using (true);
revoke insert, update, delete on public.weather_climatology from authenticated, anon;
grant all on public.weather_climatology to service_role;
```

- [ ] **Step 2: Write MV refresh extension migration**

```sql
-- 0054_forecast_mv_refresh.sql
-- Phase 14: extend refresh_analytics_mvs() to include forecast_daily_mv.
-- Re-register pg_cron for forecast MV refresh at 03:00 UTC.
-- NOTE: 0040 dropped the old daily cron. This re-registers specifically for
-- forecast MV refresh — the analytics MVs are still ingest-driven via RPC.

create or replace function public.refresh_forecast_mvs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.forecast_daily_mv;
end;
$$;

-- pg_cron: refresh forecast MV at 03:00 UTC (>=2h after forecast-refresh.yml at 01:00)
select cron.schedule(
  'refresh-forecast-mvs',
  '0 3 * * *',
  $$select public.refresh_forecast_mvs()$$
);
```

- [ ] **Step 3: Write samples janitor migration**

```sql
-- 0055_forecast_samples_janitor.sql
-- Phase 14: weekly pg_cron job to NULL yhat_samples on older run_dates (D-05).
-- Keeps storage bounded — only latest run retains sample paths.

create or replace function public.null_old_forecast_samples()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.forecast_daily
  set yhat_samples = null
  where yhat_samples is not null
    and (restaurant_id, kpi_name, model_name, forecast_track, run_date) not in (
      select restaurant_id, kpi_name, model_name, forecast_track, max(run_date)
      from public.forecast_daily
      group by restaurant_id, kpi_name, model_name, forecast_track
    );
end;
$$;

select cron.schedule(
  'null-old-forecast-samples',
  '0 4 * * 0',
  $$select public.null_old_forecast_samples()$$
);
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0053_weather_climatology.sql \
        supabase/migrations/0054_forecast_mv_refresh.sql \
        supabase/migrations/0055_forecast_samples_janitor.sql
git commit -m "feat(14): add weather_climatology, forecast MV refresh cron, samples janitor"
```

---

### Task 5: Tenant Isolation Integration Tests

**Files:**
- Modify: `tests/integration/tenant-isolation.test.ts`

- [ ] **Step 1: Add forecast_daily and forecast_quality isolation tests**

Add to the existing `tenant-isolation.test.ts`:

```typescript
describe('forecast_daily tenant isolation', () => {
  it('tenant A cannot read tenant B forecast rows via wrapper view', async () => {
    // Seed forecast_daily rows for both tenants via service_role
    const { data: aRows } = await serviceClient.rpc('test_forecast_with_actual', {
      rid: TENANT_A_ID,
    });
    const { data: bRows } = await serviceClient.rpc('test_forecast_with_actual', {
      rid: TENANT_B_ID,
    });

    // Tenant A sees only their rows
    expect(aRows?.every((r: any) => r.restaurant_id === TENANT_A_ID)).toBe(true);
    // Tenant B sees only their rows
    expect(bRows?.every((r: any) => r.restaurant_id === TENANT_B_ID)).toBe(true);
  });

  it('forecast_daily_mv is not directly readable by authenticated role', async () => {
    const { data, error } = await tenantAClient
      .from('forecast_daily_mv')
      .select('*')
      .limit(1);
    expect(error).toBeTruthy();
  });
});

describe('forecast_quality tenant isolation', () => {
  it('tenant A cannot read tenant B quality rows', async () => {
    const { data } = await tenantAClient
      .from('forecast_quality')
      .select('*');
    expect(data?.every((r: any) => r.restaurant_id === TENANT_A_ID)).toBe(true);
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `npm run test:integration -- --grep "forecast"`
Expected: PASS (or skip if no seeded forecast data yet — seed in a later task)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/tenant-isolation.test.ts
git commit -m "test(14): extend tenant isolation for forecast_daily + forecast_quality"
```

---

### Task 6: Python Project Scaffolding — db.py, requirements.txt, conftest.py

**Files:**
- Create: `scripts/forecast/__init__.py`
- Create: `scripts/forecast/db.py`
- Create: `scripts/forecast/requirements.txt`
- Create: `scripts/forecast/tests/__init__.py`
- Create: `scripts/forecast/tests/conftest.py`

- [ ] **Step 1: Create `__init__.py` files**

```python
# scripts/forecast/__init__.py
# (empty)
```

```python
# scripts/forecast/tests/__init__.py
# (empty)
```

- [ ] **Step 2: Create db.py (mirrors scripts/external/db.py)**

```python
"""Supabase service-role client factory for forecast scripts."""
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

- [ ] **Step 3: Create requirements.txt**

```
# Phase 14 forecast pipeline deps.
statsmodels>=0.14,<0.15
prophet==1.3.0
statsforecast>=2.0,<3
pandas>=2.2,<3
numpy>=1.26,<3
httpx>=0.27,<1
holidays>=0.25,<1
supabase>=2.0,<3
python-dotenv>=1.0,<2

# Test-only
pytest>=8.0,<9
```

- [ ] **Step 4: Create conftest.py with shared fixtures**

```python
"""Shared fixtures for Phase 14 forecast tests."""
from __future__ import annotations
import numpy as np
import pandas as pd
import pytest
from datetime import date, timedelta
from unittest.mock import MagicMock


@pytest.fixture
def synthetic_daily_revenue() -> pd.Series:
    """90-day synthetic daily revenue with weekly seasonality + trend."""
    rng = np.random.default_rng(42)
    n = 90
    start = date(2025, 10, 1)
    dates = [start + timedelta(days=i) for i in range(n)]
    trend = np.linspace(800, 1000, n)
    weekly = 200 * np.sin(2 * np.pi * np.arange(n) / 7)
    noise = rng.normal(0, 50, n)
    values = trend + weekly + noise
    return pd.Series(values, index=pd.DatetimeIndex(dates), name='revenue_eur')


@pytest.fixture
def synthetic_daily_counts() -> pd.Series:
    """90-day synthetic daily invoice counts."""
    rng = np.random.default_rng(43)
    n = 90
    start = date(2025, 10, 1)
    dates = [start + timedelta(days=i) for i in range(n)]
    base = 50 + 10 * np.sin(2 * np.pi * np.arange(n) / 7)
    noise = rng.normal(0, 5, n)
    values = np.maximum(base + noise, 1).astype(int)
    return pd.Series(values, index=pd.DatetimeIndex(dates), name='invoice_count')


@pytest.fixture
def shop_calendar_df() -> pd.DataFrame:
    """120-day shop calendar: closed on Mon+Tue before 2026-02-03, open all days after."""
    start = date(2025, 10, 1)
    dates = [start + timedelta(days=i) for i in range(120)]
    regime_shift = date(2026, 2, 3)
    is_open = []
    for d in dates:
        if d < regime_shift and d.weekday() in (0, 1):
            is_open.append(False)
        else:
            is_open.append(True)
    return pd.DataFrame({'date': dates, 'is_open': is_open})


@pytest.fixture
def mock_exog_df() -> pd.DataFrame:
    """90-day mock exog matrix with all required columns."""
    rng = np.random.default_rng(44)
    n = 90
    start = date(2025, 10, 1)
    dates = [start + timedelta(days=i) for i in range(n)]
    return pd.DataFrame({
        'temp_mean_c': rng.normal(10, 5, n),
        'precip_mm': np.maximum(rng.normal(2, 3, n), 0),
        'wind_max_kmh': np.maximum(rng.normal(15, 8, n), 0),
        'sunshine_hours': np.maximum(rng.normal(5, 3, n), 0),
        'is_holiday': rng.choice([0, 1], n, p=[0.95, 0.05]),
        'is_school_holiday': rng.choice([0, 1], n, p=[0.85, 0.15]),
        'has_event': rng.choice([0, 1], n, p=[0.9, 0.1]),
        'is_strike': np.zeros(n, dtype=int),
        'is_open': np.ones(n, dtype=int),
        'weather_source': ['archive'] * n,
    }, index=pd.DatetimeIndex(dates))


@pytest.fixture
def mock_supabase_client():
    """Mock Supabase client that records upsert calls."""
    client = MagicMock()
    mock_response = MagicMock()
    mock_response.data = []
    mock_response.error = None
    client.table.return_value.upsert.return_value.execute.return_value = mock_response
    client.table.return_value.select.return_value.eq.return_value.execute.return_value = mock_response
    client.table.return_value.insert.return_value.execute.return_value = mock_response
    return client
```

- [ ] **Step 5: Commit**

```bash
git add scripts/forecast/__init__.py scripts/forecast/db.py \
        scripts/forecast/requirements.txt \
        scripts/forecast/tests/__init__.py scripts/forecast/tests/conftest.py
git commit -m "feat(14): scaffold forecast Python package — db, requirements, test fixtures"
```

---

### Task 7: Shared Utilities — `sample_paths.py`

**Files:**
- Create: `scripts/forecast/sample_paths.py`
- Create: `scripts/forecast/tests/test_sample_paths.py`

- [ ] **Step 1: Write the failing test**

```python
"""Tests for sample_paths utilities (FCS-11)."""
import numpy as np
import json
from scripts.forecast.sample_paths import (
    bootstrap_from_residuals,
    paths_to_jsonb,
    aggregate_ci,
)


def test_bootstrap_shape():
    rng = np.random.default_rng(1)
    point = rng.normal(100, 10, 30)
    resid = rng.normal(0, 5, 90)
    paths = bootstrap_from_residuals(point, resid, n_paths=200, seed=42)
    assert paths.shape == (30, 200)


def test_bootstrap_mean_close_to_point():
    rng = np.random.default_rng(1)
    point = np.full(10, 100.0)
    resid = rng.normal(0, 1, 100)
    paths = bootstrap_from_residuals(point, resid, n_paths=1000, seed=42)
    assert abs(paths.mean(axis=1).mean() - 100.0) < 2.0


def test_paths_to_jsonb():
    paths = np.array([[1.1, 2.2], [3.3, 4.4]])
    result = paths_to_jsonb(paths)
    assert len(result) == 2
    parsed_0 = json.loads(result[0])
    assert len(parsed_0) == 2
    assert abs(parsed_0[0] - 1.1) < 0.01


def test_aggregate_ci_daily():
    rng = np.random.default_rng(42)
    paths = rng.normal(100, 10, (7, 200))
    mean, lower, upper = aggregate_ci(paths)
    assert len(mean) == 7
    assert all(lower[i] <= mean[i] <= upper[i] for i in range(7))


def test_aggregate_ci_percentiles():
    paths = np.ones((5, 200)) * 100.0
    mean, lower, upper = aggregate_ci(paths)
    np.testing.assert_allclose(mean, 100.0)
    np.testing.assert_allclose(lower, 100.0)
    np.testing.assert_allclose(upper, 100.0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/phase-14-forecasting-engine-bau-track && python -m pytest scripts/forecast/tests/test_sample_paths.py -x --tb=short`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write the implementation**

```python
"""Sample path utilities for models without native simulation."""
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


def paths_to_jsonb(paths: np.ndarray) -> list[str]:
    """Convert (n_days, n_paths) array to list of JSON strings (one per day).

    Each JSON string is a flat array of floats, rounded to 2 decimals.
    """
    return [json.dumps(np.round(paths[i], 2).tolist()) for i in range(paths.shape[0])]


def aggregate_ci(
    paths: np.ndarray, alpha: float = 0.05
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Compute mean + CI from sample paths.

    paths: (n_days, n_paths)
    Returns: (mean, lower, upper) each of shape (n_days,)
    """
    mean = paths.mean(axis=1)
    lower = np.percentile(paths, 100 * alpha / 2, axis=1)
    upper = np.percentile(paths, 100 * (1 - alpha / 2), axis=1)
    return mean, lower, upper
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest scripts/forecast/tests/test_sample_paths.py -v`
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/forecast/sample_paths.py scripts/forecast/tests/test_sample_paths.py
git commit -m "feat(14): add sample_paths — bootstrap, jsonb serialization, CI aggregation"
```

---

### Task 8: Shared Utilities — `closed_days.py`

**Files:**
- Create: `scripts/forecast/closed_days.py`
- Create: `scripts/forecast/tests/test_closed_days.py`

- [ ] **Step 1: Write the failing test**

```python
"""Tests for closed-day handling (D-01, D-03)."""
import numpy as np
import pandas as pd
from datetime import date, timedelta
from scripts.forecast.closed_days import (
    zero_closed_days,
    build_open_day_series,
    map_open_predictions_to_calendar,
)


def test_zero_closed_days_sets_yhat_to_zero():
    dates = [date(2026, 1, 5), date(2026, 1, 6), date(2026, 1, 7)]  # Mon, Tue, Wed
    preds = pd.DataFrame({
        'target_date': dates,
        'yhat': [100.0, 200.0, 300.0],
        'yhat_lower': [80.0, 160.0, 240.0],
        'yhat_upper': [120.0, 240.0, 360.0],
    })
    shop_cal = pd.DataFrame({
        'date': dates,
        'is_open': [False, False, True],
    })
    result = zero_closed_days(preds, shop_cal)
    assert result.loc[result['target_date'] == date(2026, 1, 5), 'yhat'].values[0] == 0
    assert result.loc[result['target_date'] == date(2026, 1, 6), 'yhat'].values[0] == 0
    assert result.loc[result['target_date'] == date(2026, 1, 7), 'yhat'].values[0] == 300.0


def test_build_open_day_series_filters_closed():
    start = date(2025, 12, 1)
    dates = pd.DatetimeIndex([start + timedelta(days=i) for i in range(7)])
    y = pd.Series([100, 0, 0, 200, 300, 400, 500], index=dates)
    shop_cal = pd.DataFrame({
        'date': [d.date() for d in dates],
        'is_open': [True, False, False, True, True, True, True],
    })
    open_y = build_open_day_series(y, shop_cal)
    assert len(open_y) == 5
    assert 0 not in open_y.values


def test_map_open_predictions_to_calendar():
    future_dates = [date(2026, 1, 5), date(2026, 1, 6), date(2026, 1, 7),
                    date(2026, 1, 8), date(2026, 1, 9)]  # Mon-Fri
    shop_cal = pd.DataFrame({
        'date': future_dates,
        'is_open': [False, False, True, True, True],
    })
    open_preds = np.array([300.0, 400.0, 500.0])
    result = map_open_predictions_to_calendar(open_preds, shop_cal, future_dates)
    assert len(result) == 5
    assert result[0] == 0  # Mon closed
    assert result[1] == 0  # Tue closed
    assert result[2] == 300.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/forecast/tests/test_closed_days.py -x --tb=short`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write the implementation**

```python
"""Closed-day handling for forecast models (D-01, D-03)."""
from __future__ import annotations
import numpy as np
import pandas as pd
from datetime import date


def zero_closed_days(preds: pd.DataFrame, shop_cal: pd.DataFrame) -> pd.DataFrame:
    """Force yhat=0 for closed dates (D-01 post-hoc zeroing).

    preds must have columns: target_date, yhat, yhat_lower, yhat_upper.
    shop_cal must have columns: date, is_open.
    """
    result = preds.copy()
    closed_dates = set(shop_cal.loc[~shop_cal['is_open'], 'date'])
    mask = result['target_date'].isin(closed_dates)
    result.loc[mask, ['yhat', 'yhat_lower', 'yhat_upper']] = 0
    return result


def build_open_day_series(y: pd.Series, shop_cal: pd.DataFrame) -> pd.Series:
    """Filter time series to open days only (D-03 for non-exog models).

    Returns contiguous series with reset index.
    """
    open_dates = set(shop_cal.loc[shop_cal['is_open'], 'date'])
    mask = y.index.map(lambda d: (d.date() if hasattr(d, 'date') else d) in open_dates)
    return y[mask].reset_index(drop=True)


def map_open_predictions_to_calendar(
    open_preds: np.ndarray,
    shop_cal: pd.DataFrame,
    calendar_dates: list[date],
) -> np.ndarray:
    """Map open-day predictions back to calendar dates (D-03).

    Inserts 0 for closed days, assigns predictions to open days in order.
    """
    result = np.zeros(len(calendar_dates))
    open_mask = shop_cal.set_index('date')['is_open']
    pred_idx = 0
    for i, d in enumerate(calendar_dates):
        if open_mask.get(d, True) and pred_idx < len(open_preds):
            result[i] = open_preds[pred_idx]
            pred_idx += 1
    return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest scripts/forecast/tests/test_closed_days.py -v`
Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/forecast/closed_days.py scripts/forecast/tests/test_closed_days.py
git commit -m "feat(14): add closed_days — zero_closed_days + open-day series builder"
```

---

### Task 9: Shared Utilities — `exog_builder.py`

**Files:**
- Create: `scripts/forecast/exog_builder.py`
- Create: `scripts/forecast/tests/test_exog_builder.py`

- [ ] **Step 1: Write the failing test**

```python
"""Tests for exog matrix builder (FCS-06)."""
import pandas as pd
import numpy as np
from datetime import date, timedelta
from unittest.mock import MagicMock
from scripts.forecast.exog_builder import build_exog_matrix, EXOG_COLUMNS


def _mock_client_with_data():
    """Build a mock Supabase client returning enough data for 30-day windows."""
    client = MagicMock()
    start = date(2025, 10, 1)
    n = 60

    # weather_daily: 30 days actual + 14 days forecast + rest empty
    weather_rows = []
    for i in range(44):
        d = start + timedelta(days=i)
        weather_rows.append({
            'date': str(d),
            'temp_mean_c': 10.0 + i * 0.1,
            'precip_mm': 1.0,
            'wind_max_kmh': 15.0,
            'sunshine_hours': 5.0,
            'is_forecast': i >= 30,
        })

    # weather_climatology: 366 rows
    clim_rows = [
        {'month': (1 + i // 31) % 12 + 1, 'day': (i % 31) + 1,
         'temp_mean_c': 8.0, 'precip_mm': 2.0, 'wind_max_kmh': 12.0,
         'sunshine_hours': 4.0, 'n_years': 4}
        for i in range(366)
    ]

    holidays_rows = [{'date': str(date(2025, 12, 25))}]
    school_rows = [{'start_date': '2025-12-20', 'end_date': '2026-01-03'}]
    events_rows = [{'date': str(date(2025, 10, 15))}]
    transit_rows = []
    shop_cal_rows = [
        {'date': str(start + timedelta(days=i)), 'is_open': True}
        for i in range(n)
    ]

    def table_dispatch(name):
        mock_t = MagicMock()
        data_map = {
            'weather_daily': weather_rows,
            'weather_climatology': clim_rows,
            'holidays': holidays_rows,
            'school_holidays': school_rows,
            'recurring_events': events_rows,
            'transit_alerts': transit_rows,
            'shop_calendar': shop_cal_rows,
        }
        mock_resp = MagicMock()
        mock_resp.data = data_map.get(name, [])
        mock_t.select.return_value.gte.return_value.lte.return_value.execute.return_value = mock_resp
        mock_t.select.return_value.execute.return_value = mock_resp
        mock_t.select.return_value.eq.return_value.gte.return_value.lte.return_value.execute.return_value = mock_resp
        return mock_t

    client.table = table_dispatch
    return client


def test_column_alignment_train_vs_predict():
    """FCS-06: train and predict exog matrices must have identical columns."""
    client = _mock_client_with_data()
    rid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    X_train = build_exog_matrix(client, rid, date(2025, 10, 1), date(2025, 10, 30))
    X_predict = build_exog_matrix(client, rid, date(2025, 10, 31), date(2025, 11, 29))
    assert list(X_train.columns) == list(X_predict.columns)


def test_no_nan_in_model_columns():
    """Prophet rejects NaN in regressor columns."""
    client = _mock_client_with_data()
    rid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    X = build_exog_matrix(client, rid, date(2025, 10, 1), date(2025, 11, 29))
    model_cols = [c for c in X.columns if c != 'weather_source']
    assert X[model_cols].isna().sum().sum() == 0


def test_output_has_all_exog_columns():
    client = _mock_client_with_data()
    rid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    X = build_exog_matrix(client, rid, date(2025, 10, 1), date(2025, 10, 30))
    for col in EXOG_COLUMNS:
        assert col in X.columns, f"Missing column: {col}"
    assert 'weather_source' in X.columns


def test_weather_source_tracks_cascade_tiers():
    client = _mock_client_with_data()
    rid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    X = build_exog_matrix(client, rid, date(2025, 10, 1), date(2025, 11, 29))
    sources = set(X['weather_source'].unique())
    assert 'archive' in sources or 'forecast' in sources or 'climatology' in sources
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/forecast/tests/test_exog_builder.py -x --tb=short`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```python
"""Shared exog matrix builder with 3-tier weather cascade (D-06/D-07/D-08)."""
from __future__ import annotations
import pandas as pd
import numpy as np
from datetime import date, timedelta

EXOG_COLUMNS = [
    'temp_mean_c', 'precip_mm', 'wind_max_kmh', 'sunshine_hours',
    'is_holiday', 'is_school_holiday', 'has_event', 'is_strike', 'is_open',
]

WEATHER_COLS = ['temp_mean_c', 'precip_mm', 'wind_max_kmh', 'sunshine_hours']


def build_exog_matrix(
    client, restaurant_id: str, start_date: date, end_date: date,
) -> pd.DataFrame:
    """Build exog matrix with 3-tier weather cascade.

    Returns DataFrame indexed by date with EXOG_COLUMNS + 'weather_source'.
    No NaN in model columns (Prophet requirement).
    """
    dates = pd.date_range(start_date, end_date, freq='D')
    df = pd.DataFrame({'date': [d.date() for d in dates]})

    # Tier 1+2: weather_daily (actuals + Bright Sky forecasts)
    weather_resp = client.table('weather_daily').select(
        'date, temp_mean_c, precip_mm, wind_max_kmh, sunshine_hours, is_forecast'
    ).gte('date', str(start_date)).lte('date', str(end_date)).execute()
    weather_rows = weather_resp.data or []

    weather_lookup = {}
    archive_dates = set()
    forecast_dates = set()
    for row in weather_rows:
        d = date.fromisoformat(row['date']) if isinstance(row['date'], str) else row['date']
        weather_lookup[d] = {c: row.get(c) for c in WEATHER_COLS}
        if row.get('is_forecast'):
            forecast_dates.add(d)
        else:
            archive_dates.add(d)

    # Tier 3: climatological norms
    clim_resp = client.table('weather_climatology').select('*').execute()
    clim_rows = clim_resp.data or []
    clim_lookup = {}
    for row in clim_rows:
        clim_lookup[(int(row['month']), int(row['day']))] = {
            c: row.get(c, 0) or 0 for c in WEATHER_COLS
        }

    # Build weather columns with cascade
    weather_source = []
    for _, r in df.iterrows():
        d = r['date']
        if d in weather_lookup and d in archive_dates:
            for c in WEATHER_COLS:
                val = weather_lookup[d].get(c)
                df.loc[df['date'] == d, c] = val if val is not None else 0
            weather_source.append('archive')
        elif d in weather_lookup and d in forecast_dates:
            for c in WEATHER_COLS:
                val = weather_lookup[d].get(c)
                df.loc[df['date'] == d, c] = val if val is not None else 0
            weather_source.append('forecast')
        else:
            key = (d.month, d.day)
            norms = clim_lookup.get(key, {c: 0 for c in WEATHER_COLS})
            for c in WEATHER_COLS:
                df.loc[df['date'] == d, c] = norms.get(c, 0)
            weather_source.append('climatology')

    df['weather_source'] = weather_source

    # Holidays
    hol_resp = client.table('holidays').select('date').execute()
    hol_dates = {date.fromisoformat(r['date']) if isinstance(r['date'], str) else r['date']
                 for r in (hol_resp.data or [])}
    df['is_holiday'] = df['date'].isin(hol_dates).astype(int)

    # School holidays
    sch_resp = client.table('school_holidays').select('start_date, end_date').execute()
    school_dates = set()
    for r in (sch_resp.data or []):
        s = date.fromisoformat(r['start_date']) if isinstance(r['start_date'], str) else r['start_date']
        e = date.fromisoformat(r['end_date']) if isinstance(r['end_date'], str) else r['end_date']
        d = s
        while d <= e:
            school_dates.add(d)
            d += timedelta(days=1)
    df['is_school_holiday'] = df['date'].isin(school_dates).astype(int)

    # Events
    ev_resp = client.table('recurring_events').select('date').execute()
    ev_dates = {date.fromisoformat(r['date']) if isinstance(r['date'], str) else r['date']
                for r in (ev_resp.data or [])}
    df['has_event'] = df['date'].isin(ev_dates).astype(int)

    # Transit strikes
    tr_resp = client.table('transit_alerts').select('date').execute()
    tr_dates = {date.fromisoformat(r['date']) if isinstance(r['date'], str) else r['date']
                for r in (tr_resp.data or [])}
    df['is_strike'] = df['date'].isin(tr_dates).astype(int)

    # Shop calendar
    sc_resp = client.table('shop_calendar').select('date, is_open').eq(
        'restaurant_id', restaurant_id
    ).gte('date', str(start_date)).lte('date', str(end_date)).execute()
    sc_lookup = {}
    for r in (sc_resp.data or []):
        d = date.fromisoformat(r['date']) if isinstance(r['date'], str) else r['date']
        sc_lookup[d] = r['is_open']
    df['is_open'] = df['date'].map(lambda d: sc_lookup.get(d, True)).astype(int)

    # Fill any remaining NaN in numeric columns with 0
    for c in EXOG_COLUMNS:
        df[c] = df[c].fillna(0)

    df = df.set_index('date')
    return df[EXOG_COLUMNS + ['weather_source']]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest scripts/forecast/tests/test_exog_builder.py -v`
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/forecast/exog_builder.py scripts/forecast/tests/test_exog_builder.py
git commit -m "feat(14): add exog_builder — 3-tier weather cascade, column alignment guard"
```

---

### Task 10: Forecast Writer — `writer.py`

**Files:**
- Create: `scripts/forecast/writer.py`
- Create: `scripts/forecast/tests/test_writer.py`

- [ ] **Step 1: Write the failing test**

```python
"""Tests for forecast batch writer."""
import numpy as np
import pandas as pd
from datetime import date
from unittest.mock import MagicMock
from scripts.forecast.writer import write_forecast_batch


def test_write_forecast_batch_calls_upsert(mock_supabase_client):
    point_df = pd.DataFrame({
        'yhat': [100.0, 200.0],
        'yhat_lower': [80.0, 160.0],
        'yhat_upper': [120.0, 240.0],
    }, index=[date(2026, 1, 1), date(2026, 1, 2)])
    samples = np.array([[1.0, 2.0], [3.0, 4.0]])
    exog_sig = {'archive': 2}

    n = write_forecast_batch(
        mock_supabase_client,
        restaurant_id='rid',
        kpi_name='revenue_eur',
        model_name='sarimax',
        run_date=date(2025, 12, 31),
        forecast_track='bau',
        point_df=point_df,
        samples=samples,
        exog_signature=exog_sig,
    )
    assert n == 2
    mock_supabase_client.table.assert_called_with('forecast_daily')


def test_write_forecast_batch_chunks_large_batches(mock_supabase_client):
    n_rows = 365
    point_df = pd.DataFrame({
        'yhat': np.ones(n_rows),
        'yhat_lower': np.ones(n_rows) * 0.8,
        'yhat_upper': np.ones(n_rows) * 1.2,
    }, index=[date(2026, 1, 1) + pd.Timedelta(days=i) for i in range(n_rows)])
    samples = np.ones((n_rows, 200))
    exog_sig = {}

    n = write_forecast_batch(
        mock_supabase_client,
        restaurant_id='rid',
        kpi_name='revenue_eur',
        model_name='sarimax',
        run_date=date(2025, 12, 31),
        forecast_track='bau',
        point_df=point_df,
        samples=samples,
        exog_signature=exog_sig,
    )
    assert n == 365
    # With CHUNK=100, 365 rows = 4 upsert calls
    upsert_calls = mock_supabase_client.table.return_value.upsert.call_count
    assert upsert_calls == 4
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/forecast/tests/test_writer.py -x --tb=short`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```python
"""Forecast batch writer — upserts rows to forecast_daily."""
from __future__ import annotations
import json
import numpy as np
import pandas as pd
from datetime import date
from supabase import Client


CHUNK_SIZE = 100


def write_forecast_batch(
    client: Client,
    *,
    restaurant_id: str,
    kpi_name: str,
    model_name: str,
    run_date: date,
    forecast_track: str,
    point_df: pd.DataFrame,
    samples: np.ndarray,
    exog_signature: dict,
) -> int:
    """Upsert forecast rows to forecast_daily. Returns row count."""
    rows = []
    exog_json = json.dumps(exog_signature)
    for i, (target_date, row) in enumerate(point_df.iterrows()):
        td = str(target_date) if not isinstance(target_date, str) else target_date
        rows.append({
            'restaurant_id': restaurant_id,
            'kpi_name': kpi_name,
            'target_date': td,
            'model_name': model_name,
            'run_date': str(run_date),
            'forecast_track': forecast_track,
            'yhat': round(float(row['yhat']), 2),
            'yhat_lower': round(float(row['yhat_lower']), 2),
            'yhat_upper': round(float(row['yhat_upper']), 2),
            'yhat_samples': json.dumps(np.round(samples[i], 2).tolist()),
            'exog_signature': exog_json,
        })

    for start in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[start:start + CHUNK_SIZE]
        client.table('forecast_daily').upsert(
            chunk,
            on_conflict='restaurant_id,kpi_name,target_date,model_name,run_date,forecast_track',
        ).execute()

    return len(rows)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest scripts/forecast/tests/test_writer.py -v`
Expected: all 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/forecast/writer.py scripts/forecast/tests/test_writer.py
git commit -m "feat(14): add forecast writer — chunked upsert to forecast_daily"
```

---

### Task 11: SARIMAX Model — `sarimax_fit.py`

**Files:**
- Create: `scripts/forecast/sarimax_fit.py`
- Create: `scripts/forecast/tests/test_sarimax_smoke.py`

- [ ] **Step 1: Write the failing test**

```python
"""Smoke tests for SARIMAX fit (FCS-02)."""
import numpy as np
import pandas as pd
from datetime import date, timedelta
from scripts.forecast.sarimax_fit import fit_sarimax


def test_sarimax_returns_correct_shapes(synthetic_daily_revenue, mock_exog_df):
    y = synthetic_daily_revenue[:60]
    X_train = mock_exog_df.iloc[:60].copy()
    X_predict = mock_exog_df.iloc[60:90].copy()

    point_df, samples, exog_sig = fit_sarimax(
        y, X_train, X_predict, n_paths=50,
        order=(1, 0, 0), seasonal_order=(0, 1, 1, 7),
    )
    assert len(point_df) == 30
    assert samples.shape == (30, 50)
    assert 'yhat' in point_df.columns
    assert 'yhat_lower' in point_df.columns
    assert 'yhat_upper' in point_df.columns
    assert isinstance(exog_sig, dict)


def test_sarimax_exog_column_assertion(synthetic_daily_revenue, mock_exog_df):
    """FCS-06: mismatched columns must raise."""
    y = synthetic_daily_revenue[:60]
    X_train = mock_exog_df.iloc[:60].copy()
    X_predict = mock_exog_df.iloc[60:90].drop(columns=['is_strike']).copy()
    try:
        fit_sarimax(y, X_train, X_predict, n_paths=10)
        assert False, "Should have raised AssertionError"
    except AssertionError as e:
        assert 'Exog drift' in str(e)


def test_sarimax_point_forecast_is_numeric(synthetic_daily_revenue, mock_exog_df):
    y = synthetic_daily_revenue[:60]
    X_train = mock_exog_df.iloc[:60].copy()
    X_predict = mock_exog_df.iloc[60:90].copy()
    point_df, _, _ = fit_sarimax(
        y, X_train, X_predict, n_paths=10,
        order=(1, 0, 0), seasonal_order=(0, 1, 1, 7),
    )
    assert point_df['yhat'].dtype in [np.float64, np.float32]
    assert not point_df['yhat'].isna().any()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/forecast/tests/test_sarimax_smoke.py -x --tb=short`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```python
"""SARIMAX model fit + sample path generation (FCS-02, FCS-06)."""
from __future__ import annotations
import numpy as np
import pandas as pd
import statsmodels.api as sm


def fit_sarimax(
    y: pd.Series,
    X_train: pd.DataFrame,
    X_predict: pd.DataFrame,
    n_paths: int = 200,
    order: tuple = (1, 0, 1),
    seasonal_order: tuple = (1, 1, 1, 7),
) -> tuple[pd.DataFrame, np.ndarray, dict]:
    """Fit SARIMAX, produce point forecast + sample paths.

    Returns: (point_df, samples_array, exog_signature)
    """
    X_fit = X_train.drop(columns=['weather_source'], errors='ignore')
    X_pred = X_predict.drop(columns=['weather_source'], errors='ignore')

    assert list(X_fit.columns) == list(X_pred.columns), \
        f"Exog drift: train={list(X_fit.columns)} vs predict={list(X_pred.columns)}"

    model = sm.tsa.SARIMAX(
        y, exog=X_fit, order=order, seasonal_order=seasonal_order,
        enforce_stationarity=False, enforce_invertibility=False,
    )
    result = model.fit(disp=False, maxiter=200)

    forecast = result.get_forecast(steps=len(X_pred), exog=X_pred)
    yhat = forecast.predicted_mean
    ci = forecast.conf_int(alpha=0.05)

    samples = result.simulate(
        nsimulations=len(X_pred),
        repetitions=n_paths,
        anchor='end',
        exog=X_pred,
    )

    exog_sig = {}
    if 'weather_source' in X_predict.columns:
        exog_sig = X_predict['weather_source'].value_counts().to_dict()

    point_df = pd.DataFrame({
        'yhat': yhat.values,
        'yhat_lower': ci.iloc[:, 0].values,
        'yhat_upper': ci.iloc[:, 1].values,
    }, index=X_predict.index)

    return point_df, np.array(samples), exog_sig
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest scripts/forecast/tests/test_sarimax_smoke.py -v`
Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/forecast/sarimax_fit.py scripts/forecast/tests/test_sarimax_smoke.py
git commit -m "feat(14): add SARIMAX fit — simulate() sample paths, exog alignment guard"
```

---

### Task 12: Prophet Model — `prophet_fit.py`

**Files:**
- Create: `scripts/forecast/prophet_fit.py`
- Create: `scripts/forecast/tests/test_prophet_smoke.py`

- [ ] **Step 1: Write the failing test**

```python
"""Smoke tests for Prophet fit (FCS-03)."""
import numpy as np
import pandas as pd
from datetime import date, timedelta
from scripts.forecast.prophet_fit import fit_prophet, REGRESSOR_COLS


def test_prophet_yearly_seasonality_is_false():
    """C-04: yearly_seasonality must be False until history >= 730 days."""
    n = 90
    start = date(2025, 10, 1)
    ds = [start + timedelta(days=i) for i in range(n)]
    rng = np.random.default_rng(42)
    y = 100 + 20 * np.sin(2 * np.pi * np.arange(n) / 7) + rng.normal(0, 5, n)
    history = pd.DataFrame({'ds': ds, 'y': y})
    for col in REGRESSOR_COLS:
        history[col] = rng.choice([0, 1], n) if col.startswith('is_') or col.startswith('has_') else rng.normal(10, 2, n)

    future_dates = [ds[-1] + timedelta(days=i+1) for i in range(7)]
    future = pd.DataFrame({'ds': future_dates})
    for col in REGRESSOR_COLS:
        future[col] = history[col].iloc[:7].values

    point_df, samples = fit_prophet(history, future, n_samples=50)
    assert len(point_df) == 7
    assert samples.shape[0] == 7
    assert samples.shape[1] == 50


def test_prophet_rejects_nan_in_regressors():
    n = 30
    start = date(2025, 10, 1)
    ds = [start + timedelta(days=i) for i in range(n)]
    history = pd.DataFrame({'ds': ds, 'y': np.ones(n) * 100})
    for col in REGRESSOR_COLS:
        history[col] = 1

    future = pd.DataFrame({'ds': [ds[-1] + timedelta(days=1)]})
    for col in REGRESSOR_COLS:
        future[col] = np.nan  # NaN should be caught

    try:
        fit_prophet(history, future, n_samples=10)
        assert False, "Should have raised ValueError for NaN regressors"
    except ValueError as e:
        assert 'NaN' in str(e) or 'nan' in str(e).lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/forecast/tests/test_prophet_smoke.py -x --tb=short`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```python
"""Prophet model fit + predictive samples (FCS-03, C-04)."""
from __future__ import annotations
import numpy as np
import pandas as pd
from prophet import Prophet

REGRESSOR_COLS = [
    'temp_mean_c', 'precip_mm', 'wind_max_kmh', 'sunshine_hours',
    'is_holiday', 'is_school_holiday', 'has_event', 'is_strike', 'is_open',
]


def fit_prophet(
    history: pd.DataFrame,
    future: pd.DataFrame,
    n_samples: int = 200,
) -> tuple[pd.DataFrame, np.ndarray]:
    """Fit Prophet with yearly_seasonality=False (C-04).

    history: must have ds, y, + REGRESSOR_COLS.
    future: must have ds + REGRESSOR_COLS. No NaN allowed in regressors.
    """
    # Guard: reject NaN in future regressors
    for col in REGRESSOR_COLS:
        if col in future.columns and future[col].isna().any():
            raise ValueError(f"NaN found in future regressor '{col}' — fill before calling fit_prophet")

    m = Prophet(
        yearly_seasonality=False,
        weekly_seasonality=True,
        daily_seasonality=False,
        uncertainty_samples=n_samples,
    )

    for col in REGRESSOR_COLS:
        m.add_regressor(col)

    m.fit(history)

    forecast = m.predict(future)
    samples_dict = m.predictive_samples(future)
    samples = samples_dict['yhat']

    point_df = forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']].copy()
    point_df = point_df.rename(columns={'ds': 'target_date'})
    point_df = point_df.set_index('target_date')

    return point_df, samples
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest scripts/forecast/tests/test_prophet_smoke.py -v`
Expected: all 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/forecast/prophet_fit.py scripts/forecast/tests/test_prophet_smoke.py
git commit -m "feat(14): add Prophet fit — yearly_seasonality pinned False, NaN guard"
```

---

### Task 13: ETS + Theta + Naive Models

**Files:**
- Create: `scripts/forecast/ets_fit.py`
- Create: `scripts/forecast/theta_fit.py`
- Create: `scripts/forecast/naive_dow_fit.py`
- Create: `scripts/forecast/tests/test_ets_smoke.py`
- Create: `scripts/forecast/tests/test_theta_smoke.py`
- Create: `scripts/forecast/tests/test_naive_dow_smoke.py`

- [ ] **Step 1: Write the failing tests**

```python
# scripts/forecast/tests/test_ets_smoke.py
"""Smoke tests for ETS fit (FCS-04)."""
import numpy as np
from scripts.forecast.ets_fit import fit_ets


def test_ets_returns_correct_shapes(synthetic_daily_revenue):
    y = synthetic_daily_revenue[:60]
    point_df, samples = fit_ets(y, n_predict=30, n_paths=50)
    assert len(point_df) == 30
    assert samples.shape == (30, 50)
    assert 'yhat' in point_df.columns
```

```python
# scripts/forecast/tests/test_theta_smoke.py
"""Smoke tests for Theta fit (FCS-04)."""
import numpy as np
from scripts.forecast.theta_fit import fit_theta


def test_theta_returns_correct_shapes(synthetic_daily_revenue):
    y = synthetic_daily_revenue[:60]
    point_df, samples = fit_theta(y, n_predict=30, n_paths=50)
    assert len(point_df) == 30
    assert samples.shape == (30, 50)
    assert 'yhat' in point_df.columns
```

```python
# scripts/forecast/tests/test_naive_dow_smoke.py
"""Smoke tests for Naive same-DoW fit (FCS-04)."""
import numpy as np
from scripts.forecast.naive_dow_fit import fit_naive_dow


def test_naive_dow_returns_correct_shapes(synthetic_daily_revenue):
    y = synthetic_daily_revenue[:60]
    point_df, samples = fit_naive_dow(y, n_predict=30, n_paths=50)
    assert len(point_df) == 30
    assert samples.shape == (30, 50)
    assert 'yhat' in point_df.columns


def test_naive_dow_uses_same_weekday():
    """Naive DoW for a Monday should be based on prior Mondays."""
    import pandas as pd
    from datetime import date, timedelta
    dates = pd.DatetimeIndex([date(2025, 10, 1) + timedelta(days=i) for i in range(28)])
    y = pd.Series(range(28), index=dates, dtype=float)
    point_df, _ = fit_naive_dow(y, n_predict=7, n_paths=10)
    assert len(point_df) == 7
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest scripts/forecast/tests/test_ets_smoke.py scripts/forecast/tests/test_theta_smoke.py scripts/forecast/tests/test_naive_dow_smoke.py -x --tb=short`
Expected: FAIL

- [ ] **Step 3: Write ETS implementation**

```python
"""ETS model fit + simulate (FCS-04)."""
from __future__ import annotations
import numpy as np
import pandas as pd
from statsmodels.tsa.exponential_smoothing.ets import ETSModel


def fit_ets(
    y: pd.Series,
    n_predict: int = 365,
    n_paths: int = 200,
) -> tuple[pd.DataFrame, np.ndarray]:
    """Fit ETS with auto model selection, generate sample paths via simulate()."""
    model = ETSModel(y, error='add', trend='add', seasonal='add', seasonal_periods=7)
    result = model.fit(disp=False, maxiter=200)

    forecast = result.get_prediction(start=len(y), end=len(y) + n_predict - 1)
    yhat = forecast.predicted_mean
    ci = forecast.summary_frame(alpha=0.05)

    samples = result.simulate(
        nsimulations=n_predict,
        repetitions=n_paths,
        anchor='end',
    )

    point_df = pd.DataFrame({
        'yhat': yhat.values,
        'yhat_lower': ci['pi_lower'].values if 'pi_lower' in ci.columns else ci.iloc[:, -2].values,
        'yhat_upper': ci['pi_upper'].values if 'pi_upper' in ci.columns else ci.iloc[:, -1].values,
    })

    return point_df, np.array(samples)
```

- [ ] **Step 4: Write Theta implementation**

```python
"""Theta model fit + bootstrap sample paths (FCS-04)."""
from __future__ import annotations
import numpy as np
import pandas as pd
from statsforecast import StatsForecast
from statsforecast.models import Theta


def fit_theta(
    y: pd.Series,
    n_predict: int = 365,
    n_paths: int = 200,
    seed: int = 42,
) -> tuple[pd.DataFrame, np.ndarray]:
    """Fit Theta via statsforecast, bootstrap residuals for sample paths."""
    from scripts.forecast.sample_paths import bootstrap_from_residuals

    y_sf = y.copy()
    y_sf.index = pd.DatetimeIndex(y_sf.index) if not isinstance(y_sf.index, pd.DatetimeIndex) else y_sf.index

    sf_df = pd.DataFrame({
        'ds': y_sf.index,
        'y': y_sf.values,
        'unique_id': 'kpi',
    })

    sf = StatsForecast(models=[Theta(season_length=7)], freq='D')
    sf.fit(sf_df)
    forecast_df = sf.predict(h=n_predict, level=[95])

    yhat = forecast_df['Theta'].values
    yhat_lower = forecast_df.get('Theta-lo-95', forecast_df['Theta']).values
    yhat_upper = forecast_df.get('Theta-hi-95', forecast_df['Theta']).values

    # Bootstrap sample paths from in-sample residuals
    fitted = sf.fitted_[0] if hasattr(sf, 'fitted_') else None
    if fitted is not None and 'Theta' in fitted.columns:
        residuals = sf_df['y'].values - fitted['Theta'].values
        residuals = residuals[~np.isnan(residuals)]
    else:
        residuals = np.diff(y_sf.values)

    samples = bootstrap_from_residuals(yhat, residuals, n_paths=n_paths, seed=seed)

    point_df = pd.DataFrame({
        'yhat': yhat,
        'yhat_lower': yhat_lower,
        'yhat_upper': yhat_upper,
    })

    return point_df, samples
```

- [ ] **Step 5: Write Naive same-DoW implementation**

```python
"""Naive same-DoW baseline model (FCS-04)."""
from __future__ import annotations
import numpy as np
import pandas as pd
from scripts.forecast.sample_paths import bootstrap_from_residuals


def fit_naive_dow(
    y: pd.Series,
    n_predict: int = 365,
    n_paths: int = 200,
    seed: int = 42,
) -> tuple[pd.DataFrame, np.ndarray]:
    """Predict each day as the mean of same day-of-week from history."""
    idx = y.index
    if hasattr(idx[0], 'weekday'):
        dow = np.array([d.weekday() for d in idx])
    else:
        dow = np.array([pd.Timestamp(d).weekday() for d in idx])

    dow_means = {}
    dow_stds = {}
    for d in range(7):
        vals = y.values[dow == d]
        dow_means[d] = vals.mean() if len(vals) > 0 else y.mean()
        dow_stds[d] = vals.std() if len(vals) > 1 else y.std()

    last_date = idx[-1]
    if hasattr(last_date, 'weekday'):
        start_dow = (last_date.weekday() + 1) % 7
    else:
        start_dow = (pd.Timestamp(last_date).weekday() + 1) % 7

    yhat = np.array([dow_means[(start_dow + i) % 7] for i in range(n_predict)])

    # Bootstrap from same-DoW residuals
    residuals = y.values - np.array([dow_means[d] for d in dow])
    samples = bootstrap_from_residuals(yhat, residuals, n_paths=n_paths, seed=seed)

    point_df = pd.DataFrame({
        'yhat': yhat,
        'yhat_lower': np.percentile(samples, 2.5, axis=1),
        'yhat_upper': np.percentile(samples, 97.5, axis=1),
    })

    return point_df, samples
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python -m pytest scripts/forecast/tests/test_ets_smoke.py scripts/forecast/tests/test_theta_smoke.py scripts/forecast/tests/test_naive_dow_smoke.py -v`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/forecast/ets_fit.py scripts/forecast/theta_fit.py scripts/forecast/naive_dow_fit.py \
        scripts/forecast/tests/test_ets_smoke.py scripts/forecast/tests/test_theta_smoke.py \
        scripts/forecast/tests/test_naive_dow_smoke.py
git commit -m "feat(14): add ETS, Theta, Naive same-DoW models with smoke tests"
```

---

### Task 14: Evaluator — `last_7_eval.py`

**Files:**
- Create: `scripts/forecast/last_7_eval.py`
- Create: `scripts/forecast/tests/test_eval.py`

- [ ] **Step 1: Write the failing test**

```python
"""Tests for last_7_eval evaluator (FCS-07)."""
import math
import numpy as np
from scripts.forecast.last_7_eval import compute_metrics


def test_compute_metrics_known_values():
    actuals = np.array([100, 200, 300, 400, 500, 600, 700])
    yhats = np.array([110, 190, 310, 390, 510, 590, 710])

    metrics = compute_metrics(actuals, yhats)

    assert abs(metrics['rmse'] - math.sqrt(((yhats - actuals) ** 2).mean())) < 0.01
    assert 'mape' in metrics
    assert 'bias' in metrics
    assert 'direction_hit_rate' in metrics
    assert metrics['n_days'] == 7


def test_compute_metrics_perfect_forecast():
    actuals = np.array([100, 200, 300, 400, 500])
    yhats = actuals.copy()

    metrics = compute_metrics(actuals, yhats)
    assert metrics['rmse'] == 0
    assert metrics['mape'] == 0
    assert metrics['bias'] == 0


def test_compute_metrics_direction_hit_rate():
    # actuals: up, up, down, up (4 transitions)
    actuals = np.array([100, 200, 300, 200, 400])
    # yhats same direction for first 3, wrong for last
    yhats = np.array([100, 210, 310, 190, 350])
    metrics = compute_metrics(actuals, yhats)
    assert metrics['direction_hit_rate'] == 0.75  # 3/4


def test_compute_metrics_handles_two_points():
    actuals = np.array([100, 200])
    yhats = np.array([110, 210])
    metrics = compute_metrics(actuals, yhats)
    assert metrics['n_days'] == 2
    assert metrics['direction_hit_rate'] == 1.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/forecast/tests/test_eval.py -x --tb=short`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```python
"""Nightly evaluator: scores last 7 actual days per model (FCS-07)."""
from __future__ import annotations
import math
import numpy as np
from datetime import date, timedelta
from supabase import Client


def compute_metrics(actuals: np.ndarray, yhats: np.ndarray) -> dict:
    """Compute RMSE, MAPE, bias, direction_hit_rate from arrays."""
    n = len(actuals)
    errors = yhats - actuals
    rmse = math.sqrt((errors ** 2).mean())
    safe_actuals = np.where(actuals != 0, actuals, 1)
    mape = float((np.abs(errors / safe_actuals) * 100).mean())
    bias = float(errors.mean())

    direction_rate = None
    if n >= 2:
        actual_dirs = np.diff(actuals) > 0
        yhat_dirs = np.diff(yhats) > 0
        direction_rate = float((actual_dirs == yhat_dirs).sum() / len(actual_dirs))

    return {
        'rmse': round(rmse, 4),
        'mape': round(mape, 4),
        'bias': round(bias, 4),
        'direction_hit_rate': round(direction_rate, 4) if direction_rate is not None else None,
        'n_days': n,
    }


def evaluate_last_7(
    client: Client,
    restaurant_id: str,
    kpi_name: str,
    model_names: list[str],
) -> list[dict]:
    """Score each model's last 7 one-day-ahead forecasts against actuals."""
    # Get latest 7 actual dates from kpi_daily_mv
    resp = client.table('kpi_daily_v').select('business_date, revenue_eur, invoice_count').eq(
        'restaurant_id', restaurant_id
    ).order('business_date', desc=True).limit(7).execute()

    actuals_by_date = {}
    for row in (resp.data or []):
        d = row['business_date']
        if kpi_name == 'revenue_eur':
            actuals_by_date[d] = float(row['revenue_eur'])
        elif kpi_name == 'invoice_count':
            actuals_by_date[d] = float(row['invoice_count'])

    if len(actuals_by_date) < 2:
        return []

    results = []
    for model_name in model_names:
        yhats_list = []
        actuals_list = []
        for d_str, actual in sorted(actuals_by_date.items()):
            d = date.fromisoformat(d_str) if isinstance(d_str, str) else d_str
            run_d = d - timedelta(days=1)
            fc_resp = client.table('forecast_daily').select('yhat').eq(
                'restaurant_id', restaurant_id
            ).eq('kpi_name', kpi_name).eq('model_name', model_name).eq(
                'target_date', str(d)
            ).eq('run_date', str(run_d)).eq('forecast_track', 'bau').execute()

            if fc_resp.data:
                yhats_list.append(float(fc_resp.data[0]['yhat']))
                actuals_list.append(actual)

        if len(yhats_list) < 2:
            continue

        metrics = compute_metrics(np.array(actuals_list), np.array(yhats_list))

        client.table('forecast_quality').upsert({
            'restaurant_id': restaurant_id,
            'kpi_name': kpi_name,
            'model_name': model_name,
            'evaluation_window': 'last_7_days',
            'n_days': metrics['n_days'],
            'rmse': metrics['rmse'],
            'mape': metrics['mape'],
            'bias': metrics['bias'],
            'direction_hit_rate': metrics['direction_hit_rate'],
        }, on_conflict='restaurant_id,kpi_name,model_name,evaluation_window,evaluated_at').execute()

        results.append({'model_name': model_name, **metrics})

    return results
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest scripts/forecast/tests/test_eval.py -v`
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/forecast/last_7_eval.py scripts/forecast/tests/test_eval.py
git commit -m "feat(14): add last_7_eval — RMSE/MAPE/bias/direction per model"
```

---

### Task 15: Orchestrator — `run_all.py`

**Files:**
- Create: `scripts/forecast/run_all.py`
- Create: `scripts/forecast/tests/test_run_all.py`

- [ ] **Step 1: Write the failing test**

```python
"""Tests for forecast orchestrator (FCS-09 exit codes)."""
from unittest.mock import patch, MagicMock
from scripts.forecast.run_all import main, get_enabled_models


def test_get_enabled_models_from_env():
    with patch.dict('os.environ', {'FORECAST_ENABLED_MODELS': 'sarimax,prophet'}):
        models = get_enabled_models()
    assert models == ['sarimax', 'prophet']


def test_get_enabled_models_default():
    with patch.dict('os.environ', {}, clear=True):
        models = get_enabled_models()
    assert 'sarimax' in models
    assert 'prophet' in models
    assert 'ets' in models
    assert 'theta' in models
    assert 'naive_dow' in models
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/forecast/tests/test_run_all.py -x --tb=short`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```python
"""Phase 14: run_all.py — nightly forecast orchestrator.

Iterates over enabled models. Each runs in its own try/except.
Per-model result writes one pipeline_runs row.

Exit codes (mirrors Phase 13 D-07):
- 0 if at least one model succeeded
- 1 if every model failed

Entry points:
- nightly cron: python -m scripts.forecast.run_all
- selective:    python -m scripts.forecast.run_all --models sarimax,prophet
"""
from __future__ import annotations
import argparse
import os
import sys
import traceback
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import db
from .exog_builder import build_exog_matrix
from .closed_days import zero_closed_days, build_open_day_series, map_open_predictions_to_calendar
from .sample_paths import paths_to_jsonb
from .writer import write_forecast_batch

# Lazy import pipeline_runs_writer from Phase 13
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT))

DEFAULT_MODELS = ['sarimax', 'prophet', 'ets', 'theta', 'naive_dow']
KPIS = ['revenue_eur', 'invoice_count']
PREDICT_DAYS = 365


def get_enabled_models(override: str = '') -> list[str]:
    if override:
        return [m.strip() for m in override.split(',') if m.strip()]
    env = os.environ.get('FORECAST_ENABLED_MODELS', '')
    if env:
        return [m.strip() for m in env.split(',') if m.strip()]
    return DEFAULT_MODELS.copy()


def _fetch_history(client, restaurant_id: str, kpi_name: str):
    """Fetch historical KPI values from kpi_daily_v."""
    import pandas as pd
    resp = client.table('kpi_daily_v').select(
        'business_date, revenue_eur, invoice_count'
    ).eq('restaurant_id', restaurant_id).order('business_date').execute()

    rows = resp.data or []
    if not rows:
        return pd.Series(dtype=float)

    dates = [row['business_date'] for row in rows]
    values = [float(row[kpi_name]) for row in rows]
    return pd.Series(values, index=pd.DatetimeIndex(dates), name=kpi_name)


def _fetch_shop_calendar(client, restaurant_id: str):
    import pandas as pd
    resp = client.table('shop_calendar').select('date, is_open').eq(
        'restaurant_id', restaurant_id
    ).order('date').execute()
    rows = resp.data or []
    return pd.DataFrame(rows) if rows else pd.DataFrame(columns=['date', 'is_open'])


def _get_restaurant_id(client) -> str:
    """Get the single restaurant_id for v1."""
    resp = client.table('restaurants').select('id').limit(1).execute()
    if not resp.data:
        raise RuntimeError('No restaurant found in restaurants table')
    return resp.data[0]['id']


def _run_model(client, model_name: str, restaurant_id: str, kpi_name: str,
               run_date: date, history, shop_cal) -> str:
    """Run a single model fit for a single KPI. Returns 'success' or 'failure'."""
    import pandas as pd
    import numpy as np
    from datetime import timedelta

    today = run_date
    predict_start = today + timedelta(days=1)
    predict_end = today + timedelta(days=PREDICT_DAYS)

    if model_name in ('sarimax', 'prophet'):
        # Exog models: build matrix for train + predict
        train_start = history.index[0].date() if hasattr(history.index[0], 'date') else history.index[0]
        train_end = history.index[-1].date() if hasattr(history.index[-1], 'date') else history.index[-1]

        X_train = build_exog_matrix(client, restaurant_id, train_start, train_end)
        X_predict = build_exog_matrix(client, restaurant_id, predict_start, predict_end)

        if model_name == 'sarimax':
            from .sarimax_fit import fit_sarimax
            point_df, samples, exog_sig = fit_sarimax(history, X_train, X_predict)
        else:
            from .prophet_fit import fit_prophet, REGRESSOR_COLS
            hist_df = pd.DataFrame({
                'ds': history.index,
                'y': history.values,
            })
            for col in REGRESSOR_COLS:
                hist_df[col] = X_train[col].values

            future_df = pd.DataFrame({'ds': pd.date_range(predict_start, predict_end)})
            for col in REGRESSOR_COLS:
                future_df[col] = X_predict[col].values

            point_df, samples = fit_prophet(hist_df, future_df)
            exog_sig = X_predict['weather_source'].value_counts().to_dict()

        # Post-hoc zero closed days
        target_dates = pd.date_range(predict_start, predict_end)
        pred_for_zero = pd.DataFrame({
            'target_date': [d.date() for d in target_dates],
            'yhat': point_df['yhat'].values,
            'yhat_lower': point_df['yhat_lower'].values,
            'yhat_upper': point_df['yhat_upper'].values,
        })
        pred_for_zero = zero_closed_days(pred_for_zero, shop_cal)
        point_df['yhat'] = pred_for_zero['yhat'].values
        point_df['yhat_lower'] = pred_for_zero['yhat_lower'].values
        point_df['yhat_upper'] = pred_for_zero['yhat_upper'].values
        point_df.index = [d.date() for d in target_dates]

    else:
        # Non-exog models: train on open days, map back to calendar
        from .closed_days import build_open_day_series, map_open_predictions_to_calendar

        open_history = build_open_day_series(history, shop_cal)

        if model_name == 'ets':
            from .ets_fit import fit_ets
            point_df, samples = fit_ets(open_history, n_predict=PREDICT_DAYS, n_paths=200)
        elif model_name == 'theta':
            from .theta_fit import fit_theta
            point_df, samples = fit_theta(open_history, n_predict=PREDICT_DAYS, n_paths=200)
        elif model_name == 'naive_dow':
            from .naive_dow_fit import fit_naive_dow
            point_df, samples = fit_naive_dow(open_history, n_predict=PREDICT_DAYS, n_paths=200)
        else:
            raise ValueError(f'Unknown model: {model_name}')

        # Map open-day predictions back to calendar
        target_dates = pd.date_range(predict_start, predict_end)
        calendar_dates = [d.date() for d in target_dates]
        mapped_yhat = map_open_predictions_to_calendar(point_df['yhat'].values, shop_cal, calendar_dates)
        mapped_lower = map_open_predictions_to_calendar(point_df['yhat_lower'].values, shop_cal, calendar_dates)
        mapped_upper = map_open_predictions_to_calendar(point_df['yhat_upper'].values, shop_cal, calendar_dates)

        point_df = pd.DataFrame({
            'yhat': mapped_yhat,
            'yhat_lower': mapped_lower,
            'yhat_upper': mapped_upper,
        }, index=calendar_dates)

        # Map sample paths similarly — zero out closed days in paths
        mapped_samples = np.zeros((len(calendar_dates), samples.shape[1]))
        open_idx = 0
        for i, d in enumerate(calendar_dates):
            is_open_val = shop_cal.set_index('date').get('is_open', pd.Series(dtype=bool)).get(str(d), True)
            if is_open_val and open_idx < samples.shape[0]:
                mapped_samples[i] = samples[open_idx]
                open_idx += 1
        samples = mapped_samples
        exog_sig = {}

    n = write_forecast_batch(
        client,
        restaurant_id=restaurant_id,
        kpi_name=kpi_name,
        model_name=model_name,
        run_date=run_date,
        forecast_track='bau',
        point_df=point_df,
        samples=samples,
        exog_signature=exog_sig if 'exog_sig' in dir() else {},
    )
    return n


def main(*, models: list[str] | None = None, run_date: date | None = None) -> int:
    from scripts.external import pipeline_runs_writer

    client = db.make_client()
    restaurant_id = _get_restaurant_id(client)
    today = run_date or date.today()
    enabled = models or get_enabled_models()
    shop_cal = _fetch_shop_calendar(client, restaurant_id)

    statuses = {}
    for kpi in KPIS:
        history = _fetch_history(client, restaurant_id, kpi)
        if len(history) < 14:
            print(f'Skipping {kpi}: insufficient history ({len(history)} days)')
            continue

        for model_name in enabled:
            step = f'forecast_{model_name}'
            started = datetime.now(timezone.utc)
            try:
                n = _run_model(client, model_name, restaurant_id, kpi, today, history, shop_cal)
                pipeline_runs_writer.write_success(
                    client, step_name=step, started_at=started,
                    row_count=n, restaurant_id=restaurant_id,
                )
                statuses[f'{kpi}_{model_name}'] = 'success'
                print(f'{kpi}/{model_name}: success ({n} rows)')
            except Exception as e:
                pipeline_runs_writer.write_failure(
                    client, step_name=step, started_at=started,
                    error_msg=traceback.format_exc(), restaurant_id=restaurant_id,
                )
                statuses[f'{kpi}_{model_name}'] = 'failure'
                print(f'{kpi}/{model_name}: failure — {e}')

    # Run evaluator
    from .last_7_eval import evaluate_last_7
    for kpi in KPIS:
        try:
            results = evaluate_last_7(client, restaurant_id, kpi, enabled)
            for r in results:
                print(f'eval {kpi}/{r["model_name"]}: RMSE={r["rmse"]}, MAPE={r["mape"]}')
        except Exception as e:
            print(f'eval {kpi}: failure — {e}')

    if any(s == 'success' for s in statuses.values()):
        return 0
    return 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Phase 14 forecast orchestrator')
    parser.add_argument('--models', help='Comma-separated model list', default='')
    parser.add_argument('--run-date', help='YYYY-MM-DD run date (default: today)', default=None)
    args = parser.parse_args()
    models = [m.strip() for m in args.models.split(',') if m.strip()] if args.models else None
    rd = date.fromisoformat(args.run_date) if args.run_date else None
    sys.exit(main(models=models, run_date=rd))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest scripts/forecast/tests/test_run_all.py -v`
Expected: all 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/forecast/run_all.py scripts/forecast/tests/test_run_all.py
git commit -m "feat(14): add forecast orchestrator — per-model try/except, pipeline_runs writes"
```

---

### Task 16: GHA Workflow — `forecast-refresh.yml`

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
      run_date:
        description: 'YYYY-MM-DD run date (omit for today)'
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
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
      - uses: actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065
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
          RUN_DATE: ${{ inputs.run_date }}
        run: |
          set -euo pipefail
          DATE_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          ARGS=()
          if [ -n "${MODELS:-}" ]; then
            ARGS+=("--models" "$MODELS")
          fi
          if [ -n "${RUN_DATE:-}" ]; then
            [[ "$RUN_DATE" =~ $DATE_RE ]] || { echo "::error::run_date must match YYYY-MM-DD, got: $RUN_DATE"; exit 1; }
            ARGS+=("--run-date" "$RUN_DATE")
          fi
          python -m scripts.forecast.run_all "${ARGS[@]}"
```

- [ ] **Step 2: Verify Guard 8 compatibility**

Run: `python scripts/ci-guards/check-cron-schedule.py`
Expected: PASS (forecast-refresh already in cascade registry)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/forecast-refresh.yml
git commit -m "feat(14): add forecast-refresh.yml — nightly at 01:00 UTC, Guard 8 compliant"
```

---

### Task 17: Weather History Backfill Script

**Files:**
- Create: `scripts/forecast/backfill_weather_history.py`

- [ ] **Step 1: Write the backfill script**

```python
"""One-time weather backfill: Bright Sky 2021-01-01 → 2025-06-10 (D-07).

Also computes and populates weather_climatology (366-row per-DoY averages).

Usage:
  python -m scripts.forecast.backfill_weather_history
  python -m scripts.forecast.backfill_weather_history --start 2021-01-01 --end 2025-06-10
"""
from __future__ import annotations
import argparse
import sys
from datetime import date, timedelta
from collections import defaultdict

import httpx

from . import db

BRIGHT_SKY_URL = 'https://api.brightsky.dev/weather'
LAT = 52.5200  # Berlin
LON = 13.4050

BACKFILL_START = date(2021, 1, 1)
BACKFILL_END = date(2025, 6, 10)


def fetch_brightsky_range(start: date, end: date) -> list[dict]:
    """Fetch daily weather from Bright Sky in monthly chunks."""
    rows = []
    current = start
    while current <= end:
        chunk_end = min(current.replace(day=28) + timedelta(days=4), end)
        chunk_end = min(chunk_end.replace(day=1) - timedelta(days=1), end) if chunk_end.month != current.month else chunk_end
        chunk_end = min(current + timedelta(days=30), end)

        resp = httpx.get(BRIGHT_SKY_URL, params={
            'lat': LAT, 'lon': LON,
            'date': str(current), 'last_date': str(chunk_end + timedelta(days=1)),
        }, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        daily = {}
        for record in data.get('weather', []):
            d = record['timestamp'][:10]
            if d not in daily:
                daily[d] = {
                    'date': d,
                    'temp_mean_c': [],
                    'precip_mm': 0,
                    'wind_max_kmh': 0,
                    'sunshine_hours': 0,
                }
            daily[d]['temp_mean_c'].append(record.get('temperature', 0) or 0)
            daily[d]['precip_mm'] += record.get('precipitation', 0) or 0
            daily[d]['wind_max_kmh'] = max(
                daily[d]['wind_max_kmh'], record.get('wind_speed', 0) or 0
            )
            daily[d]['sunshine_hours'] += (record.get('sunshine', 0) or 0) / 60

        for d, vals in daily.items():
            rows.append({
                'date': d,
                'temp_mean_c': round(sum(vals['temp_mean_c']) / len(vals['temp_mean_c']), 1),
                'precip_mm': round(vals['precip_mm'], 1),
                'wind_max_kmh': round(vals['wind_max_kmh'], 1),
                'sunshine_hours': round(vals['sunshine_hours'], 1),
                'is_forecast': False,
            })

        current = chunk_end + timedelta(days=1)

    return rows


def compute_climatology(client) -> list[dict]:
    """Compute per-DoY averages from all weather_daily rows."""
    resp = client.table('weather_daily').select(
        'date, temp_mean_c, precip_mm, wind_max_kmh, sunshine_hours'
    ).eq('is_forecast', False).execute()

    by_doy = defaultdict(lambda: {'temp': [], 'precip': [], 'wind': [], 'sun': []})
    for row in (resp.data or []):
        d = date.fromisoformat(row['date']) if isinstance(row['date'], str) else row['date']
        key = (d.month, d.day)
        by_doy[key]['temp'].append(float(row['temp_mean_c'] or 0))
        by_doy[key]['precip'].append(float(row['precip_mm'] or 0))
        by_doy[key]['wind'].append(float(row['wind_max_kmh'] or 0))
        by_doy[key]['sun'].append(float(row['sunshine_hours'] or 0))

    rows = []
    for (month, day), vals in sorted(by_doy.items()):
        n = len(vals['temp'])
        rows.append({
            'month': month,
            'day': day,
            'temp_mean_c': round(sum(vals['temp']) / n, 1),
            'precip_mm': round(sum(vals['precip']) / n, 1),
            'wind_max_kmh': round(sum(vals['wind']) / n, 1),
            'sunshine_hours': round(sum(vals['sun']) / n, 1),
            'n_years': n,
        })
    return rows


def main(start: date = BACKFILL_START, end: date = BACKFILL_END):
    client = db.make_client()

    print(f'Fetching Bright Sky weather {start} → {end}...')
    weather_rows = fetch_brightsky_range(start, end)
    print(f'Fetched {len(weather_rows)} daily rows')

    # Upsert to weather_daily in chunks
    CHUNK = 100
    for i in range(0, len(weather_rows), CHUNK):
        chunk = weather_rows[i:i + CHUNK]
        client.table('weather_daily').upsert(
            chunk, on_conflict='date'
        ).execute()
    print(f'Upserted {len(weather_rows)} rows to weather_daily')

    # Compute + upsert climatology
    clim_rows = compute_climatology(client)
    client.table('weather_climatology').upsert(
        clim_rows, on_conflict='month,day'
    ).execute()
    print(f'Upserted {len(clim_rows)} rows to weather_climatology')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='One-time weather history backfill')
    parser.add_argument('--start', default=str(BACKFILL_START))
    parser.add_argument('--end', default=str(BACKFILL_END))
    args = parser.parse_args()
    main(date.fromisoformat(args.start), date.fromisoformat(args.end))
```

- [ ] **Step 2: Commit**

```bash
git add scripts/forecast/backfill_weather_history.py
git commit -m "feat(14): add weather history backfill — Bright Sky 2021→2025 + climatology"
```

---

### Task 18: CI Guards Verification + Final Integration

**Files:**
- Modify: `scripts/ci-guards.sh` (if needed)

- [ ] **Step 1: Run CI guards**

Run: `bash scripts/ci-guards.sh`
Expected: All 8 guards PASS. Guard 7 (`tenant_id` regression) catches any `tenant_id` in new migrations. Guard 8 (cron schedule) verifies `forecast-refresh.yml` at `0 1 * * *`.

- [ ] **Step 2: Run full Python test suite**

Run: `cd .worktrees/phase-14-forecasting-engine-bau-track && python -m pytest scripts/forecast/tests/ -v`
Expected: All tests PASS

- [ ] **Step 3: Run full JS test suite (non-forecast tests should still pass)**

Run: `npm test 2>&1 | tail -10`
Expected: Same baseline pass rate as before (322 passing, 8 pre-existing failures)

- [ ] **Step 4: Commit any guard fixes**

Only if Guard 7 or Guard 8 found regressions — fix inline and commit.

---

## Self-Review Checklist

| Requirement | Task(s) | Covered? |
|-------------|---------|----------|
| FCS-01: forecast_daily table schema | Task 1 | Yes |
| FCS-02: SARIMAX nightly with exog | Task 11, Task 9, Task 15 | Yes |
| FCS-03: Prophet yearly_seasonality=False | Task 12 | Yes |
| FCS-04: ETS, Theta, Naive same-DoW | Task 13 | Yes |
| FCS-05: Chronos/NeuralProphet behind flag | Task 15 (env var gating in get_enabled_models) | Yes (off by default, not installed) |
| FCS-06: SARIMAX exog column alignment | Task 9 (build_exog_matrix), Task 11 (assert) | Yes |
| FCS-07: last_7_eval per model | Task 14 | Yes |
| FCS-08: forecast_daily_mv + wrapper view | Task 3 | Yes |
| FCS-09: forecast-refresh.yml at 01:00 UTC | Task 16 | Yes |
| FCS-10: pg_cron refresh extended | Task 4 (0054) | Yes |
| FCS-11: Sample paths server-side | Task 7 | Yes |
| D-01: NaN + is_open for exog models | Task 8, Task 15 | Yes |
| D-03: Open-day-only for non-exog models | Task 8, Task 15 | Yes |
| D-04: 200 sample paths | Task 7, all model tasks | Yes |
| D-05: Weekly janitor NULLs old samples | Task 4 (0055) | Yes |
| D-06/D-07: Weather climatology + backfill | Task 4 (0053), Task 17 | Yes |
| D-08: 3-tier weather cascade | Task 9 | Yes |
| D-09: Env var feature flag | Task 15, Task 16 | Yes |
| C-01: restaurant_id not tenant_id | All migrations | Yes |
| C-02: 01:00 UTC schedule | Task 16 | Yes |
| C-03: pipeline_runs writes | Task 15 | Yes |
| C-06: Hybrid RLS | Task 1, Task 2, Task 3 | Yes |
