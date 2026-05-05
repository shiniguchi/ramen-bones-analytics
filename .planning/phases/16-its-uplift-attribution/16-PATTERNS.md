# Phase 16: ITS Uplift Attribution — Pattern Map

**Mapped:** 2026-05-01
**Files analyzed:** 27 (creates + modifies)
**Analogs found:** 27 / 27

This document is the planner's reference for "what existing code should each new file copy patterns from?" Every file Phase 16 creates or modifies is mapped to its closest existing analog, with concrete excerpts the planner can transcribe.

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|----------------|---------------|
| `supabase/migrations/0058_campaign_calendar.sql` | data-layer (DDL) | CRUD (write via service_role; tenant-scoped read) | `supabase/migrations/0050_forecast_daily.sql` | exact — table + RLS + REVOKE + jwt filter |
| `supabase/migrations/0059_baseline_items_v.sql` | data-layer (DDL view) | request-response (derived select) | `supabase/migrations/0054_forecast_with_actual_v.sql` | exact — RLS-scoped wrapper view + GRANT SELECT |
| `supabase/migrations/0060_kpi_daily_with_comparable_v.sql` | data-layer (DDL view) | request-response (derived select) | `supabase/migrations/0054_forecast_with_actual_v.sql` + `0010_cohort_mv.sql` (lines 62-77 wrapper-view template) | exact |
| `supabase/migrations/0061_feature_flags.sql` | data-layer (DDL) | CRUD | `supabase/migrations/0050_forecast_daily.sql` | exact — small table + RLS + REVOKE writes |
| `supabase/migrations/0062_campaign_uplift_v.sql` | data-layer (DDL view) | request-response (joins forecast + actuals + campaign_calendar) | `supabase/migrations/0054_forecast_with_actual_v.sql` | exact — wrapper view joining forecast tables |
| `supabase/migrations/0063_pipeline_runs_fit_train_end.sql` | data-layer (DDL ALTER) | schema-only | `supabase/migrations/0046_pipeline_runs_extend.sql` | exact — ALTER ADD COLUMN IF NOT EXISTS pattern |
| `scripts/forecast/counterfactual_fit.py` | python orchestration / API-backend | batch (read kpi_daily_with_comparable_v → fit per model → write forecast_daily) | `scripts/forecast/sarimax_fit.py` (per-model template) + `scripts/forecast/naive_dow_fit.py` | exact — subprocess fit module pattern |
| `scripts/forecast/cumulative_uplift.py` | python orchestration | batch (read forecast_with_actual_v + yhat_samples → bootstrap → write campaign_uplift) | `scripts/forecast/sample_paths.py` (bootstrap helper) + `scripts/forecast/run_all.py` (orchestrator shell) | role-match (no exact analog — new aggregator) |
| `src/lib/components/CampaignUpliftCard.svelte` | UI component | request-response (LazyMount + clientFetch) | `src/lib/components/RevenueForecastCard.svelte` | exact — Spline + Area + Tooltip.Root snippet pattern |
| `tests/forecast/cutoff_sensitivity.md` | test artifact (markdown report) | read-only artifact | NO direct analog — model on Phase-13/14 pipeline-runs CSV reports if any | NO ANALOG (markdown table, see "No Analog Found") |
| `tests/forecast/test_counterfactual_fit.py` | test (python) | request-response (mock supabase + assert writes) | `scripts/forecast/tests/test_run_all_grain_loop.py` | exact — subprocess + mocked client harness |
| `tests/forecast/test_cumulative_uplift.py` | test (python) | unit + integration | `scripts/forecast/tests/test_sample_paths.py` (bootstrap test) + `scripts/forecast/tests/test_eval.py` (compute-metrics TDD) | exact — same module category |
| `tests/forecast/test_campaign_uplift_v.py` | test (python) | view-query auth'd JWT | `tests/integration/forecast_daily_granularity.test.ts` (TS analog) — best Python option is to author a new pytest using supabase admin RPC `test_table_columns` | role-match (existing convention is TS not py for view tests) |
| `tests/sql/test_baseline_items_v.py` | test (python or ts view-query) | view-query | `tests/integration/forecast_daily_granularity.test.ts` | role-match — TS pattern; if Python preferred, mirror integration approach |
| `tests/sql/test_kpi_daily_with_comparable_v.py` | test (python or ts) | view-query | `tests/integration/forecast_daily_granularity.test.ts` | role-match |
| `tests/forecast/test_offweek_reminder.py` | test (python) | atomic-update assertion | `scripts/forecast/tests/test_run_all_grain_loop.py` (mocked supabase chain) | role-match |
| `tests/ci-guards/test_guard_9.sh` | test (shell) | invoke ci-guards.sh + assert exit | `tests/ci-guards/test_check_cron_schedule.py` (Python harness for guard) + `tests/ci-guards/red-team-tenant-id.sql` (red-team fixture) | role-match — same harness pattern |
| `tests/ci-guards/test_guard_10.sh` | test (shell) | same | same | role-match |
| `scripts/forecast/run_all.py` (MODIFY) | python orchestration | batch | self — add `--track={bau,cf,both}` flag pattern follows existing `--models` argparse | exact (self-reference) |
| `scripts/forecast/exog.py` (READ-ONLY import) | python orchestration | request-response | reused unchanged via `build_exog_matrix(...mode='predict')` | N/A — import-only |
| `scripts/external/pipeline_runs_writer.py` (MODIFY) | python orchestration | CRUD | self — extend `write_success`/`write_failure` signature with optional `fit_train_end` | exact (self-reference) |
| `src/routes/api/forecast/+server.ts` (MODIFY ~lines 163-170) | API / SvelteKit server | request-response | self — events array assembly | exact (self-reference) |
| `src/routes/api/campaign-uplift/+server.ts` (MODIFY) | API / SvelteKit server | request-response | self (Phase 15 stub) — extend payload shape | exact (self-reference) |
| `src/lib/forecastConfig.ts` (DELETE `CAMPAIGN_START`) | UI config | constant retirement | self — file becomes empty or reduced; CI guard prevents reappearance | N/A — deletion |
| `src/routes/+page.svelte` (MODIFY) | UI page composition | request-response | self — slot a new `<LazyMount>` between line 286 and line 312 mirroring InvoiceCountForecastCard pattern | exact (self-reference) |
| `scripts/ci-guards.sh` (MODIFY) | CI / shell | static check | self — append Guards 9 + 10 mirroring Guards 7 + 8 structure | exact (self-reference) |
| `.github/workflows/forecast-refresh.yml` (MODIFY) | CI / workflow | scheduled job | self — append `cumulative_uplift` step + `--track=cf` step | exact (self-reference) |

---

## Pattern Assignments

### Migrations

#### `supabase/migrations/0058_campaign_calendar.sql` (data-layer DDL)

**Analog:** `supabase/migrations/0050_forecast_daily.sql`
**Why:** Phase 14's canonical small-table-with-RLS pattern. Same shape: CREATE TABLE → RLS ENABLE → SELECT policy on `auth.jwt()->>'restaurant_id'` → REVOKE writes from authenticated/anon (writes go via service_role per CONTEXT.md D-01).

**Imports / preamble** — none needed; pure SQL DDL.

**Core pattern** (lines 1-21 from 0050):
```sql
CREATE TABLE public.forecast_daily (
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
    kpi_name      text NOT NULL CHECK (kpi_name IN ('revenue_eur', 'invoice_count')),
    target_date   date NOT NULL,
    -- ... columns ...
    PRIMARY KEY (restaurant_id, kpi_name, target_date, model_name, run_date, forecast_track)
);
COMMENT ON TABLE public.forecast_daily IS 'Phase 14: 365-day forward forecasts ...';
ALTER TABLE public.forecast_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY forecast_daily_select ON public.forecast_daily
    FOR SELECT USING (restaurant_id = (auth.jwt()->>'restaurant_id')::uuid);
REVOKE INSERT, UPDATE, DELETE ON public.forecast_daily FROM authenticated, anon;
```

**What the planner should reuse:**
- `restaurant_id uuid NOT NULL REFERENCES public.restaurants(id)` — exact column shape (NOT `tenant_id` — Guard 7 will fire).
- `(auth.jwt()->>'restaurant_id')::uuid` cast in policy — verbatim.
- `REVOKE INSERT, UPDATE, DELETE ... FROM authenticated, anon` — keeps writes service-role-only per D-01.

**What the planner must add:**
- 12-PROPOSAL §7 lines 867-880 column set (campaign_id PK, start_date, end_date, name, channel, notes), mechanically renamed `tenant_id → restaurant_id` per C-01.
- Seed `INSERT INTO campaign_calendar VALUES (...2026-04-14 friend-owner row...)` from CONTEXT.md specifics.

---

#### `supabase/migrations/0059_baseline_items_v.sql` (data-layer DDL view)

**Analog:** `supabase/migrations/0054_forecast_with_actual_v.sql` + `0010_cohort_mv.sql:62-77` wrapper-view block

**Why:** Both are tenant-scoped wrapper views with `WHERE restaurant_id = (auth.jwt()->>'restaurant_id')::uuid` and explicit `GRANT SELECT TO authenticated`. Phase 16's `baseline_items_v` is a derived select on `stg_orderbird_order_items` filtered by "first seen ≥7 days before earliest campaign start."

**Core pattern** (full file, 0054 lines 1-19):
```sql
-- kpi_daily_mv is wide-form (revenue_cents, tx_count, avg_ticket_cents) while
-- forecast_daily_mv is long-form (kpi_name). Use CASE to unpivot the actual
-- value from the correct column based on forecast kpi_name.
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

GRANT SELECT ON public.forecast_with_actual_v TO authenticated;
```

**Wrapper-view RLS template from 0010** (lines 62-77):
```sql
-- Wrapper view — DO NOT set security_invoker (Pitfall 2)
create view public.cohort_v as
select
  restaurant_id, card_hash, ...
from public.cohort_mv
where restaurant_id::text = (auth.jwt()->>'restaurant_id');

grant select on public.cohort_v to authenticated;
```

**What the planner should reuse:**
- `CREATE OR REPLACE VIEW public.<name> AS SELECT ... WHERE restaurant_id = (auth.jwt()->>'restaurant_id')::uuid;` shape verbatim.
- Trailing `GRANT SELECT ON public.<view> TO authenticated;`.
- Comment-block at top explaining derivation logic (analog: 0054 lines 1-3).

**What the planner must add:**
- 12-PROPOSAL §7 lines 787-804 column set (apply C-01 rename).
- Derivation: `min(occurred_at::date)` over `stg_orderbird_order_items` grouped by `(restaurant_id, item_name)`; filter to items where this min < (`(SELECT MIN(start_date) FROM campaign_calendar WHERE restaurant_id = ...) - 7 days`). The 7-day buffer matches C-04.

---

#### `supabase/migrations/0060_kpi_daily_with_comparable_v.sql` (data-layer DDL view)

**Analog:** `supabase/migrations/0054_forecast_with_actual_v.sql` (wrapper-view-on-MV pattern)

**Why:** D-03 says this is a **view**, not a new MV — extends `kpi_daily_mv` with one extra column derived from `baseline_items_v ⋈ stg_orderbird_order_items`. Phase 14 `forecast_with_actual_v` is the canonical "extend an existing MV with a derived column via LEFT JOIN" template.

**Core pattern** (same excerpt as above, 0054 lines 4-19): identical RLS shape.

**What the planner should reuse:**
- View body + `WHERE restaurant_id = (auth.jwt()->>'restaurant_id')::uuid` filter.
- LEFT JOIN to derived computation (analog joins kpi_daily_mv; this view joins baseline_items_v).
- `GRANT SELECT TO authenticated` line.

**What the planner must add:**
- Schema per 12-PROPOSAL §7 lines 806-825 with C-01 rename.
- `revenue_comparable_eur` column = `SUM(price_cents) / 100.0` from `stg_orderbird_order_items` joined to `baseline_items_v` (filters to "comparable" items only).
- Per-restaurant LEFT JOIN to keep `kpi_daily_mv` shape unchanged for the rest of the dashboard.

---

#### `supabase/migrations/0061_feature_flags.sql` (data-layer DDL)

**Analog:** `supabase/migrations/0050_forecast_daily.sql` (small-table + RLS template)

**Why:** Same shape as 0058 — small tenant-scoped table with service-role-only writes. The `feature_flags` table is a flat key-value with date-trigger column.

**Core pattern** — same as 0058 above.

**What the planner should reuse:**
- The full 6-line CREATE TABLE → ENABLE RLS → POLICY → REVOKE block from 0050 lines 18-21.

**What the planner must add:**
- 12-PROPOSAL §7 lines 1122-1140 schema (apply C-01 rename).
- Per CONTEXT.md D-10 specifics: include `remind_on_or_after_date date NULL` and `enabled boolean NOT NULL DEFAULT false` columns. Per RESEARCH.md §5, this enables the atomic-update race-condition mitigation: `UPDATE feature_flags SET enabled=true WHERE flag_key='offweek_reminder' AND enabled=false AND remind_on_or_after_date <= today` is single-flight via Postgres serialization.
- Migration-time INSERT seeding the offweek_reminder row at `2026-10-15`.

---

#### `supabase/migrations/0062_campaign_uplift_v.sql` (data-layer DDL view)

**Analog:** `supabase/migrations/0054_forecast_with_actual_v.sql` (wrapper view joining forecast tables)

**Why:** Same architecture: wrapper view that joins forecast_daily_mv + actuals + a third table (here, `campaign_calendar`) and filters by tenant. Per CONTEXT.md "Claude's discretion" the planner picks view-only vs view-on-backing-table; either way the wrapper-view RLS shape is identical.

**Core pattern** — same as 0054 (lines 4-19) above.

**What the planner should reuse:**
- The CASE-unpivot pattern (kpi-name → numeric column).
- `LEFT JOIN ... ON k.restaurant_id = f.restaurant_id AND k.business_date = f.target_date` shape — `campaign_uplift_v` adds a third JOIN to `campaign_calendar` on the same restaurant_id.
- The "RLS via WHERE clause + GRANT SELECT TO authenticated" template.

**What the planner must add:**
- 12-PROPOSAL §7 lines 887-902 schema (apply C-01 rename).
- Per-row key `(restaurant_id, campaign_id, model_name, window_kind)` per D-08.
- Columns `cumulative_uplift_eur`, `ci_lower_eur`, `ci_upper_eur`, `naive_dow_uplift_eur`, `n_days`, `as_of_date`, `window_kind`.
- The bootstrap CIs are computed by `cumulative_uplift.py` — this view either reads them from a backing table OR computes them on-the-fly. Per CONTEXT.md and RESEARCH.md §1, planner picks. The recommended path is a backing `campaign_uplift` table populated nightly + this `_v` wrapper.

**Optional belt-and-suspenders (RESEARCH.md §6):** Add a CHECK constraint on `forecast_daily` in this migration (or a separate small migration) to airtight Guard 9:
```sql
ALTER TABLE forecast_daily ADD CONSTRAINT forecast_daily_cf_not_raw_revenue
  CHECK (NOT (forecast_track = 'cf' AND kpi_name = 'revenue_eur'));
```

---

#### `supabase/migrations/0063_pipeline_runs_fit_train_end.sql` (data-layer DDL ALTER)

**Analog:** `supabase/migrations/0046_pipeline_runs_extend.sql`

**Why:** Exact match — same table, same `ALTER ... ADD COLUMN IF NOT EXISTS` idempotent pattern Phase 13 used to extend `pipeline_runs` previously. The 0046 file is the canonical `pipeline_runs` evolution template.

**Core pattern** (lines 16-34):
```sql
alter table public.pipeline_runs
  add column if not exists upstream_freshness_h numeric,
  add column if not exists restaurant_id        uuid references public.restaurants(id) on delete cascade;

alter table public.pipeline_runs enable row level security;

-- Idempotent recreate: drop any prior policy (skeleton had none), then create.
drop policy if exists pipeline_runs_read on public.pipeline_runs;
create policy pipeline_runs_read
  on public.pipeline_runs for select
  using (
    restaurant_id is null
    OR restaurant_id::text = (auth.jwt() ->> 'restaurant_id')
  );

revoke insert, update, delete on public.pipeline_runs from authenticated, anon;
grant select on public.pipeline_runs to authenticated, anon;
```

**What the planner should reuse:**
- `alter table public.pipeline_runs add column if not exists <name> <type>;` exact syntax.
- The "no policy regression" defensive REVOKE/GRANT block at the bottom (idempotent re-state).

**What the planner must add:**
- One-line ALTER: `add column if not exists fit_train_end date;`
- Comment block at top explaining D-05 audit purpose: "BAU rows leave NULL; CF rows populate the date used as `TRAIN_END = min(campaign_calendar.start_date) - 7 days`. CI test asserts no `forecast_track='cf'` row in `forecast_daily` has its `(restaurant_id, model_name, run_date)` matching a `pipeline_runs.fit_train_end >= min(campaign_calendar.start_date)`."

---

### Python orchestration

#### `scripts/forecast/counterfactual_fit.py` (NEW Python module)

**Analog:** `scripts/forecast/sarimax_fit.py` (per-model fit template) + `scripts/forecast/naive_dow_fit.py`

**Why:** D-06 says counterfactual_fit reuses the existing per-model fit modules. Each existing `*_fit.py` is a stand-alone subprocess entry point with a `fit_and_write(client, *, restaurant_id, kpi_name, run_date, granularity)` function. The Phase 16 plan extends each of those modules with a `fit_track_b(train_end)` variant — or `counterfactual_fit.py` is a thin orchestrator that imports the existing fit_and_write but overrides train_end and forces `forecast_track='cf'` + `kpi_name` redirect to `revenue_comparable_eur`.

**Imports pattern** (from sarimax_fit.py lines 20-44):
```python
from __future__ import annotations
import json
import os
import sys
import traceback
from datetime import date, datetime, timezone
from typing import Optional

import numpy as np
import pandas as pd
import statsmodels.api as sm
from numpy.linalg import LinAlgError

from scripts.forecast.db import make_client
from scripts.forecast.exog import build_exog_matrix, assert_exog_compatible, EXOG_COLUMNS
from scripts.forecast.closed_days import zero_closed_days
from scripts.forecast.aggregation import bucket_to_weekly, bucket_to_monthly
from scripts.forecast.sample_paths import paths_to_jsonb
from scripts.forecast.grain_helpers import (
    HORIZON_BY_GRAIN, parse_granularity_env, pred_dates_for_grain, train_end_for_grain,
)
from scripts.external.pipeline_runs_writer import write_success, write_failure
```

**Per-row write pattern** (sarimax_fit.py lines 184-198):
```python
rows.append({
    'restaurant_id': restaurant_id,
    'kpi_name': kpi_name,
    'target_date': str(target_date),
    'model_name': model_name,
    'run_date': str(run_date),
    'forecast_track': 'bau',          # ← Phase 16 changes this to 'cf'
    'granularity': granularity,
    'yhat': round(yhat, 4),
    'yhat_lower': round(yhat_lower, 4),
    'yhat_upper': round(yhat_upper, 4),
    'yhat_samples': paths_to_jsonb(samples, i),
    'exog_signature': json.dumps(exog_sig),
})
```

**Subprocess entry-point pattern** (sarimax_fit.py lines 349-398):
```python
if __name__ == '__main__':
    restaurant_id = os.environ.get('RESTAURANT_ID', '').strip()
    kpi_name = os.environ.get('KPI_NAME', '').strip()
    run_date_str = os.environ.get('RUN_DATE', '').strip()
    if not restaurant_id or not kpi_name or not run_date_str:
        print('ERROR: RESTAURANT_ID, KPI_NAME, and RUN_DATE env vars are required', file=sys.stderr)
        sys.exit(1)
    try:
        granularity = parse_granularity_env(os.environ.get('GRANULARITY'))
    except ValueError as e:
        print(f'ERROR: {e}', file=sys.stderr); sys.exit(1)
    run_date = date.fromisoformat(run_date_str)
    started_at = datetime.now(timezone.utc)
    client = make_client()
    try:
        n = fit_and_write(client, restaurant_id=restaurant_id, kpi_name=kpi_name,
                          run_date=run_date, granularity=granularity)
        write_success(client, step_name=STEP_NAME, started_at=started_at,
                      row_count=n, restaurant_id=restaurant_id)
        sys.exit(0)
    except Exception:
        err_msg = traceback.format_exc()
        try:
            write_failure(client, step_name=STEP_NAME, started_at=started_at,
                          error_msg=err_msg, restaurant_id=restaurant_id)
        except Exception as write_err:
            print(f'Could not write failure row: {write_err}', file=sys.stderr)
        sys.exit(1)
```

**What the planner should reuse:**
- Verbatim import block.
- `fit_and_write()` signature `(client, *, restaurant_id, kpi_name, run_date, granularity)` — same kwargs across all 5 BAU modules.
- Subprocess `__main__` boilerplate (env-var parsing, `started_at`, `try/write_success/except/write_failure/sys.exit`).
- `_upsert_rows(client, rows)` helper at sarimax_fit.py:201-208 (chunked upsert in CHUNK_SIZE=100).

**What the planner must add (Phase 16-unique):**
- A `--track={bau,cf,both}` parameter wired through `run_all.py` (D-06). When `track='cf'`:
  1. `kpi_name` reads from `kpi_daily_with_comparable_v.revenue_comparable_eur` instead of `kpi_daily_mv.revenue_cents/100` (per D-04 / Guard 9 — the kpi_name column literal stays `revenue_eur` only on writes, but the sourced column is the comparable one). Note: per RESEARCH.md §6 alternative, the planner can use a `forecast_daily` CHECK constraint to forbid `forecast_track='cf' AND kpi_name='revenue_eur'` outright — making this a hard DB-level invariant.
  2. `train_end = min(campaign_calendar.start_date) - 7 days` per C-04.
  3. Each row writes `forecast_track='cf'` instead of `'bau'`.
  4. `write_success`/`write_failure` calls pass `step_name=f'cf_{model}'` and `fit_train_end=train_end` (new kwarg added in pipeline_runs_writer.py modify).
- Granularity is hard-coded to `'day'` only per D-07 — week/month rows are NOT written by CF fits.
- Architecture choice (per CONTEXT.md "Claude's discretion"): single `counterfactual_fit.py` orchestrator that loops 5 models × 1 grain × 2 KPIs = 10 fits, OR thin module that imports each `*_fit.py`'s fit_and_write with a CF flag. KISS default = single orchestrator.

---

#### `scripts/forecast/cumulative_uplift.py` (NEW Python module)

**Analog:** `scripts/forecast/sample_paths.py` (bootstrap helper) + `scripts/forecast/run_all.py` (orchestrator shell) + `scripts/external/pipeline_runs_writer.py` (writes pipeline_runs)

**Why:** This is a new aggregator with no exact analog. Closest parallels:
- Bootstrap math: `sample_paths.py:7-19` is the existing 200-path bootstrap-from-residuals function — same numpy idioms.
- Orchestrator shell + freshness-gate + per-model loop + MV refresh: `run_all.py` is the existing batch orchestrator pattern.
- Failure-row writing: `pipeline_runs_writer.py:write_failure` matches D-10's reminder-row mechanism.

**Bootstrap pattern** (from sample_paths.py:7-19):
```python
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
```

**Orchestrator main pattern** (run_all.py:156-277, condensed):
```python
def main(*, models=None, run_date=None) -> int:
    client = make_client()
    # Weather guard / freshness gate / restaurant_id resolve
    restaurant_id = _get_restaurant_id(client)
    # Iterate models × KPIs × grains; collect successes
    successes = 0
    for model in models:
        for kpi in KPIS:
            try:
                # ... per-model work ...
                successes += 1
            except Exception as e:
                print(f'failed: {e}', file=sys.stderr); continue
    return 0 if successes > 0 else 1
```

**Resilience-to-partial-failure pattern** (RESEARCH.md §5; transcribe into cumulative_uplift.py):
```python
SUCCESSFUL_CF_MODELS = []
for model in ['sarimax', 'prophet', 'ets', 'theta', 'naive_dow']:
    try:
        resp = client.table('pipeline_runs').select('status').eq(
            'step_name', f'cf_{model}'
        ).eq('run_date', RUN_DATE).order('completed_at', desc=True).limit(1).execute()
        if resp.data and resp.data[0]['status'] == 'success':
            SUCCESSFUL_CF_MODELS.append(model)
    except Exception as e:
        write_failure(client, step_name='cumulative_uplift',
                      error_msg=f'cf_{model} status check failed: {e}',
                      restaurant_id=restaurant_id)
        continue
```

**Atomic flag-flip pattern (off-week reminder)** (RESEARCH.md §5):
```python
resp = client.table('feature_flags').update(
    {'enabled': True, 'updated_at': 'now()'}
).eq('flag_key', 'offweek_reminder').eq('enabled', False).lte(
    'remind_on_or_after_date', date.today().isoformat()
).execute()
if resp.data:  # this run won the race
    write_reminder(client)  # writes pipeline_runs row
```

**What the planner should reuse:**
- Import block from run_all.py:23-32 (`make_client`, `write_failure`, `write_success`, datetime/date imports).
- `_get_restaurant_id(client)` helper exactly as in run_all.py:50-56.
- The pipeline_runs-status-check pattern from RESEARCH.md §5.
- The 200-path numpy `default_rng(seed=42)` idiom from sample_paths.py:16.

**What the planner must add (Phase 16-unique):**
- The textbook bootstrap form per RESEARCH.md §1 (one path per resample, 1000 resamples, 2.5%/97.5% quantiles):
  ```python
  rng = np.random.default_rng(seed=42)
  sums = np.empty(n_resamples, dtype=float)
  for k in range(n_resamples):
      p = rng.integers(0, P)  # P=200
      sums[k] = float((actual_values - paths[:, p]).sum())
  ci_lower = float(np.quantile(sums, 0.025))
  ci_upper = float(np.quantile(sums, 0.975))
  ```
- Per-window AND per-cumulative-since-launch loop (D-08 `window_kind` discriminator).
- Naive-DoW divergence sanity-check column populated alongside SARIMAX.
- The `feature_flags` atomic UPDATE for off-week reminder (RESEARCH.md §5 — copied above).
- Insight-narrative-line injection per D-10 (extends existing Phase 5 INS-01 prompt template).

---

#### `scripts/forecast/run_all.py` (MODIFY — extend with `--track` flag)

**Analog:** self — argparse + env-var pattern at run_all.py:280-302.

**Existing argparse pattern** (run_all.py:280-302):
```python
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Phase 14 forecast pipeline orchestrator')
    parser.add_argument('--models', help=f'Comma-separated model list (default: ...)', default=None)
    parser.add_argument('--run-date', help='YYYY-MM-DD; defaults to yesterday', default=None)
    args = parser.parse_args()
    selected_models = None
    if args.models:
        selected_models = [m.strip() for m in args.models.split(',') if m.strip()]
    selected_run_date = None
    if args.run_date:
        selected_run_date = date.fromisoformat(args.run_date)
    sys.exit(main(models=selected_models, run_date=selected_run_date))
```

**Existing per-model spawn loop** (run_all.py:236-248):
```python
for model in models:
    for kpi in KPIS:
        for granularity in GRANULARITIES:
            total += 1
            ok = _run_model(model=model, restaurant_id=restaurant_id, kpi_name=kpi,
                            run_date=run_date_str, granularity=granularity)
            if ok: successes += 1
```

**What the planner should reuse:**
- The argparse block — add a `--track` argument with the same idiom.
- The `for model in models:` outer loop scaffold — D-06 says CF reuses this loop, but skips week/month grains for CF (D-07 hard-codes `granularity='day'` for `track='cf'`).

**What the planner must add:**
- `parser.add_argument('--track', choices=['bau', 'cf', 'both'], default='both', help='Forecast track to fit. bau = business-as-usual (default Phase 14), cf = counterfactual Track-B (Phase 16), both = run BAU then CF.')`
- Conditional inside `main()`: when `track in ('cf', 'both')`, spawn the CF fit pass (5 models × 1 grain × 2 KPIs = 10 spawns). When `track in ('bau', 'both')`, spawn the existing BAU pass (5 × 3 × 2 = 30 spawns).
- An `env['TRACK']` thread into `_build_subprocess_env` so each subprocess fit module sees its own track flag.

---

#### `scripts/external/pipeline_runs_writer.py` (MODIFY — add `fit_train_end` field)

**Analog:** self — `write_success` and `write_failure` signatures at lines 42-67 and 97-120.

**Existing payload pattern** (pipeline_runs_writer.py:53-63):
```python
def write_success(
    client: Client, *,
    step_name: str, started_at: datetime, row_count: int,
    upstream_freshness_h: Optional[float] = None,
    restaurant_id: Optional[str] = None,
    commit_sha: Optional[str] = None,
) -> None:
    payload = {
        'step_name': step_name,
        'started_at': started_at.isoformat(),
        'finished_at': _now().isoformat(),
        'status': 'success',
        'row_count': row_count,
        'upstream_freshness_h': upstream_freshness_h,
        'error_msg': None,
        'restaurant_id': restaurant_id,
        'commit_sha': commit_sha or _commit_sha(),
    }
    res = client.table('pipeline_runs').insert(payload).execute()
```

**What the planner should reuse:**
- Function signature shape (kwarg-only with `Optional[T] = None` for new fields).
- `payload` dict construction — append the new field as a top-level key so PostgREST ignores it on rows where the column doesn't exist (i.e., before migration 0063 runs).

**What the planner must add:**
- New optional kwarg `fit_train_end: Optional[date] = None` in `write_success`, `write_fallback`, and `write_failure`.
- `payload['fit_train_end'] = fit_train_end.isoformat() if fit_train_end else None` line in each.
- Per D-05: BAU rows leave this NULL; CF rows populate the cutoff date used.

---

### API / SvelteKit

#### `src/routes/api/forecast/+server.ts` (MODIFY ~lines 163-170)

**Analog:** self — events array at lines 163-169.

**Existing events array pattern**:
```typescript
const events: ForecastEvent[] = [
  ...holidayRows.map((h) => ({ type: 'holiday' as const,         date: h.date,       label: h.name })),
  ...schoolRows .map((s) => ({ type: 'school_holiday' as const,  date: s.start_date, label: s.block_name, end_date: s.end_date })),
  ...recurRows  .map((r) => ({ type: 'recurring_event' as const, date: r.start_date, label: r.name })),
  ...transitRows.map((t) => ({ type: 'transit_strike' as const,  date: t.pub_date.slice(0, 10), label: t.title }))
];
```

**Parallel fetch pattern** (lines 88-135) — adds a 7th query to `Promise.all` already, hitting `holidays`, `school_holidays`, `recurring_events`, `transit_alerts`, `pipeline_runs_status_v`. Phase 16 adds an 8th: `campaign_calendar`.

```typescript
const [forecastRows, holidayRows, schoolRows, recurRows, transitRows, pipelineRows] = await Promise.all([
  fetchAll<ForecastViewRow>(() => locals.supabase.from('forecast_with_actual_v').select(...)),
  fetchAll<HolidayRow>(() => locals.supabase.from('holidays').select(...)),
  // ... others ...
]);
```

**What the planner should reuse:**
- The `Promise.all` array shape — append a 7th `fetchAll<CampaignRow>(() => ...campaign_calendar...)`.
- The `events` spread-and-map idiom for new 5th source: `...campaignRows.map((c) => ({ type: 'campaign_start' as const, date: c.start_date, label: c.name ?? c.campaign_id }))`.
- `clampEvents()` from `$lib/forecastEventClamp` — per CONTEXT.md C-09, `campaign_start` priority is already 5 (highest), so progressive disclosure already works.

**What the planner must add:**
- New `CampaignRow` type at the top of the file: `type CampaignRow = { campaign_id: string; start_date: string; name: string | null };`.
- New `fetchAll<CampaignRow>(...)` query in the Promise.all (the table is RLS-scoped so the auth'd JWT filters automatically).
- New spread `...campaignRows.map(...)` line in the events array.
- CF Pages subrequest budget check: 50 cap, currently 7 queries → 8 with this addition. Still well under.

---

#### `src/routes/api/campaign-uplift/+server.ts` (MODIFY — extend payload)

**Analog:** self (Phase 15 stub at lines 30-66).

**Existing endpoint shape**:
```typescript
const NO_STORE: Record<string, string> = { 'Cache-Control': 'private, no-store' };

export const GET: RequestHandler = async ({ locals }) => {
  const { claims } = await locals.safeGetSession();
  if (!claims) return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  const campaignStartDate = format(CAMPAIGN_START, 'yyyy-MM-dd');
  try {
    const rows = await fetchAll<UpliftViewRow>(() =>
      locals.supabase
        .from('forecast_with_actual_v')
        .select('target_date,yhat,actual_value')
        .eq('kpi_name', 'revenue_eur')
        .eq('forecast_track', 'bau')
        .eq('model_name', 'sarimax')
        .gte('target_date', campaignStartDate)
    );
    let cumulative = 0;
    for (const r of rows) {
      if (r.actual_value !== null) cumulative += r.actual_value - r.yhat;
    }
    return json(
      { campaign_start: campaignStartDate, cumulative_deviation_eur: cumulative,
        as_of: format(new Date(), 'yyyy-MM-dd') },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error('[/api/campaign-uplift]', err);
    return json({ error: 'query failed' }, { status: 500, headers: NO_STORE });
  }
};
```

**What the planner should reuse (per C-08):**
- The endpoint URL `/api/campaign-uplift` — STABLE.
- `Cache-Control: private, no-store` header.
- `locals.safeGetSession()` + 401 short-circuit.
- The existing `cumulative_deviation_eur` field name — back-compat per C-08 (Phase 15 `ForecastHoverPopup` may still consume this).
- The try/catch shape with `console.error` per `.claude/memory/project_silent_error_isolation.md`.

**What the planner must add (Phase 16-unique):**
- Replace the `forecast_with_actual_v` query with one against `campaign_uplift_v` (the new view from migration 0062). The endpoint changes from "compute Σ in TS" to "read pre-computed rows from `campaign_uplift_v`."
- New response fields per C-08: `ci_lower_eur`, `ci_upper_eur`, `naive_dow_uplift_eur`, `model`, `campaigns[]` (array of {campaign_id, start_date, end_date, name, channel, cumulative_uplift_eur, ci_lower, ci_upper, naive_dow_uplift_eur, n_days, as_of_date}).
- DELETE the `import { CAMPAIGN_START } from '$lib/forecastConfig'` line — `CAMPAIGN_START` is retired. Date now comes from the database row.

---

#### `src/lib/forecastConfig.ts` (DELETE `CAMPAIGN_START`)

**Analog:** self — single-line export currently.

**Current state**:
```typescript
export const CAMPAIGN_START: Date = new Date('2026-04-14T00:00:00Z');
```

**What the planner should add:**
- DELETE `CAMPAIGN_START` constant entirely. The file becomes empty (delete the file) or holds non-campaign config.
- New CI Guard 10 (forbids `2026-04-14` literal anywhere in src/) ensures the date doesn't reappear.

---

### Svelte components

#### `src/lib/components/CampaignUpliftCard.svelte` (NEW component)

**Analog:** `src/lib/components/RevenueForecastCard.svelte` (Phase 15 — Spline + Area + Tooltip.Root snippet pattern)

**Why:** RevenueForecastCard is the load-bearing reference for every locked Phase 15 carry-forward Phase 16 inherits: `Tooltip.Root` snippet contract (C-12), `touchEvents: 'auto'` (C-13), LayerChart Spline+Area composition, `fill-opacity={0.06}` CI band convention (C-09 / D-17), clientFetch + `$effect` data-loading. Phase 16 strips axes for sparkline form factor but keeps every primitive identical.

**Imports + state pattern** (RevenueForecastCard.svelte:1-55, condensed):
```svelte
<script lang="ts">
  import { Chart, Svg, Axis, Spline, Area, Highlight, Tooltip } from 'layerchart';
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { curveMonotoneX } from 'd3-shape';
  import { parseISO, format } from 'date-fns';
  import { page } from '$app/state';
  import { t } from '$lib/i18n/messages';
  import { formatEURShort } from '$lib/format';
  import { clientFetch } from '$lib/clientFetch';
  import { getFilters } from '$lib/dashboardStore.svelte';
  import EmptyState from './EmptyState.svelte';

  type ForecastPayload = { rows: ForecastRow[]; actuals: {...}[]; events: ForecastEvent[]; last_run: string | null; ... };

  let forecastData = $state<ForecastPayload | null>(null);
  let chartCtx = $state<any>();
  let lastFetchedGrain: string | null = null;

  $effect(() => {
    const g = getFilters().grain;
    if (g === lastFetchedGrain) return;
    lastFetchedGrain = g;
    void clientFetch<ForecastPayload>(`/api/forecast?kpi=revenue_eur&granularity=${g}`)
      .then(f => { forecastData = f; })
      .catch(e => console.error('[RevenueForecastCard]', e));
  });
</script>
```

**Chart wrapper + Tooltip.Root snippet contract** (RevenueForecastCard.svelte:117-203, condensed):
```svelte
<div class="mt-4 h-64 chart-touch-safe">
  <Chart
    bind:context={chartCtx}
    data={...}
    x="target_date_d"
    y="yhat_mean"
    xScale={scaleTime()}
    padding={{ left: 40, bottom: 24, top: 12, right: 8 }}
    tooltipContext={{ mode: 'bisect-x', touchEvents: 'auto' }}
  >
    <Svg>
      <Area y0={...} y1={...} curve={curveMonotoneX} fill={...} fillOpacity={0.06} />
      <Spline ... curve={curveMonotoneX} stroke={...} stroke-width={2} />
      <Highlight points lines />
    </Svg>
    <Tooltip.Root contained="window" class="max-w-[92vw]">
      {#snippet children({ data })}
        {#if data}
          <ForecastHoverPopup ... />
        {/if}
      {/snippet}
    </Tooltip.Root>
  </Chart>
</div>
```

**Sparkline adaptation** (from RESEARCH.md §3 lines 285-330):
```svelte
<div style="width: 280px; height: 100px;">
  <Chart {data} x="date" y={['ci_lower', 'ci_upper']} xScale={scaleTime()} yNice={2}
         padding={{ left: 0, right: 0, top: 4, bottom: 4 }}
         tooltip={{ mode: 'bisect-x' }}
         tooltipContext={{ mode: 'bisect-x', touchEvents: 'auto' }}>
    <Svg>
      <Area y0="ci_lower" y1="ci_upper" fill="currentColor" fill-opacity={0.06} line={false} curve={curveMonotoneX} />
      <Spline y="cum_uplift" class="stroke-primary stroke-2" curve={curveMonotoneX} />
    </Svg>
    <Tooltip.Root contained="window" class="max-w-[80vw] text-xs">
      {#snippet children({ data })}
        <Tooltip.Header value={format(data.date, 'MMM d')} />
        <Tooltip.List>
          <Tooltip.Item label={`Day ${differenceInDays(data.date, new Date(uplift.campaign_start))}`}
                        value={`€${data.cum_uplift.toFixed(0)}`} />
          <Tooltip.Item label="95% CI" value={`€${data.ci_lower.toFixed(0)} … €${data.ci_upper.toFixed(0)}`} />
        </Tooltip.List>
      {/snippet}
    </Tooltip.Root>
  </Chart>
</div>
```

**What the planner should reuse:**
- The full import block (LayerChart primitives + d3-scale + d3-shape + date-fns + clientFetch + getFilters + page).
- `let forecastData = $state<...>(null)` Svelte 5 rune pattern.
- `$effect` data-loading shape with `lastFetchedGrain` non-reactive flag (the Svelte 5 fix from commit 36a06aa, comment preserved on line 45).
- `tooltipContext={{ touchEvents: 'auto' }}` per C-13.
- `Tooltip.Root` with `{#snippet children({ data })}` — never `let:data` (C-12).
- `fillOpacity={0.06}` for the CI band (C-09 / D-17 convention).
- `console.error('[ComponentName]', e)` on fetch failure per `.claude/memory/project_silent_error_isolation.md`.

**What the planner must add (Phase 16-unique):**
- Endpoint: fetch `/api/campaign-uplift` (no grain query string — endpoint is parameterless for v1 per CONTEXT.md specifics).
- 280×100px sparkline form: `padding={{ left: 0, right: 0, top: 4, bottom: 4 }}` to drop axes; no `<Highlight>`.
- Hero number + sparkline composition (D-11): "Cumulative uplift since 2026-04-14: +€X,XXX" or the honest "CI overlaps zero — no detectable lift" replacement.
- Honest-label rule (UPL-06): when `ci_lower_eur ≤ 0 ≤ ci_upper_eur`, hero replaced with the "CI overlaps zero" string + `±€X,XXX (95% CI)` dimmer subtitle.
- D-09 divergence-warning amber line below sparkline when SARIMAX vs naive_dow uplift sign-disagrees OR magnitude > 50% divergent.
- Card states from RESEARCH.md §4 table: skeleton (animate-pulse), empty (return null when no campaigns), CF-still-computing, stale > 24h, CI-overlaps-zero, divergence-warning, error.

---

#### `src/routes/+page.svelte` (MODIFY — add CampaignUpliftCard slot)

**Analog:** self — InvoiceCountForecastCard slot at lines 279-286.

**Existing slot pattern** (lines 282-286):
```svelte
<LazyMount minHeight="320px">
  {#snippet children()}
    <InvoiceCountForecastCard />
  {/snippet}
</LazyMount>
```

**What the planner should reuse:**
- Verbatim — `<LazyMount minHeight="320px">` with `{#snippet children()}` and the bare component tag inside.
- The `import` line at top (line 22 references `InvoiceCountForecastCard`); add a parallel `import CampaignUpliftCard from '$lib/components/CampaignUpliftCard.svelte';`.

**What the planner must add:**
- A new `<LazyMount minHeight="200px">` block (smaller min-height since the card is sparkline+hero, not a full chart) between the existing InvoiceCountForecastCard `</LazyMount>` (closes ~line 286) and the `<DailyHeatmapCard />` slot at ~line 312.
- Per CONTEXT.md D-11 mental model comment: "where revenue is going (forecast) → tx count (forecast) → did the campaign cause it? (uplift) → look-back KPIs."

---

### Tests

#### `tests/forecast/test_counterfactual_fit.py` (NEW pytest)

**Analog:** `scripts/forecast/tests/test_run_all_grain_loop.py`

**Why:** This is the canonical "subprocess + mocked supabase client" pytest harness. The same idioms apply for `counterfactual_fit.py`: stub the supabase package at import time, mock the supabase client's chained method calls, patch `subprocess.run`, assert spawn count + correct env vars + exit code.

**Imports + supabase stub** (test_run_all_grain_loop.py:1-32):
```python
from __future__ import annotations
import sys, types
from datetime import date, timedelta
from unittest.mock import MagicMock, patch
import pytest

if 'supabase' not in sys.modules:
    _supabase_stub = types.ModuleType('supabase')
    _supabase_stub.create_client = lambda *a, **kw: None
    _supabase_stub.Client = type('Client', (), {})
    sys.modules['supabase'] = _supabase_stub
```

**Mock client builder** (test_run_all_grain_loop.py:43-102) — 60-line factory that returns a MagicMock with chained `.select().eq().order().limit().execute()` returning fake supabase responses.

**Test pattern** (test_run_all_grain_loop.py:113-143):
```python
def test_run_all_loops_over_three_granularities():
    last_actual = (date.today() - timedelta(days=1)).isoformat()
    mock_client = _build_mock_client(last_actual_iso=last_actual)
    with patch('scripts.forecast.run_all.make_client', return_value=mock_client):
        with patch('scripts.forecast.run_all.subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout='', stderr='')
            with patch('scripts.forecast.run_all.evaluate_last_7'):
                from scripts.forecast.run_all import main
                rc = main(models=['sarimax'])
    assert rc == 0
    assert mock_run.call_count == 6
    spawned_grains = [call.kwargs['env']['GRANULARITY'] for call in mock_run.call_args_list]
    assert sorted(spawned_grains) == ['day', 'day', 'month', 'month', 'week', 'week']
```

**What the planner should reuse:**
- The supabase stub block at module top (verbatim).
- The `_build_mock_client(last_actual_iso=...)` factory helper (copy + adapt).
- The `with patch(...) ... main(track='cf')` invocation pattern.
- `assert mock_run.call_count == ...` to verify the spawn count.

**What the planner must add (Phase 16-unique):**
- Test that `--track=cf` produces exactly `5 models × 1 grain × 2 KPIs = 10` spawns (vs BAU's 30).
- Test that each spawn's env has `TRACK=cf` and `GRANULARITY=day`.
- Test that `pipeline_runs.fit_train_end` is populated on CF success rows (mock the supabase upsert and assert payload contains the field).
- C-04 leak-prevention test: assert no `forecast_track='cf'` row's target_date < (campaign_start - 7 days) is written.

---

#### `tests/forecast/test_cumulative_uplift.py` (NEW pytest)

**Analog:** `scripts/forecast/tests/test_sample_paths.py` (bootstrap test) + `scripts/forecast/tests/test_eval.py` (compute_metrics TDD)

**Why:** Same numpy-bootstrap test category. RESEARCH.md §8 specifically calls out cumulative_uplift's bootstrap CI math as a TDD candidate.

**Bootstrap-test pattern** (test_sample_paths.py:5-16):
```python
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
```

**Compute-metrics TDD pattern** (test_eval.py:7-12):
```python
def test_rmse_known_values():
    actuals = np.array([100.0, 200.0, 300.0])
    yhats = np.array([110.0, 190.0, 310.0])
    metrics = compute_metrics(actuals, yhats)
    expected_rmse = math.sqrt(((10**2 + 10**2 + 10**2) / 3))
    assert abs(metrics['rmse'] - expected_rmse) < 0.01
```

**What the planner should reuse:**
- Direct numpy import + `default_rng(seed=42)` for reproducibility.
- Function-call-then-assert idiom with hand-computable expected values.
- Tolerance-based asserts (`< 0.01`) for floating-point comparisons.

**What the planner must add (Phase 16-unique):**
- A test using a **synthetic 200-path array** where the expected CI is computable by hand (e.g., paths with known mean and known variance, window length 7 days). RESEARCH.md §8 explicitly calls this out as a TDD candidate.
- Off-by-one tests for window-sum math: assert `Σ` over `[campaign_start, today]` is inclusive on both ends.
- A snapshot test asserting `(ci_lower, point, ci_upper)` for a fixed seed input — protects against future bootstrap algorithm changes that silently shift the CI.
- D-09 divergence-rule unit test: assert sign-disagree triggers warning, >50% magnitude triggers warning, agreeing-models hides warning.

---

#### `tests/forecast/test_campaign_uplift_v.py` + `tests/sql/test_baseline_items_v.py` + `tests/sql/test_kpi_daily_with_comparable_v.py` (NEW view tests)

**Analog:** `tests/integration/forecast_daily_granularity.test.ts`

**Why:** Existing convention for view-shape + RLS tests is **TypeScript** (vitest, not pytest). The planner SHOULD author these as `.test.ts` files (NOT .py) under `tests/integration/` to match the established pattern. RESEARCH.md mentions `tests/integration/tenant-isolation.test.ts` as the explicit extension target for `campaign_calendar`, `feature_flags`, `campaign_uplift_v`.

**Schema-shape pattern** (forecast_daily_granularity.test.ts:32-42):
```typescript
it('granularity column exists on forecast_daily', async () => {
  const { data, error } = await admin.rpc('test_table_columns', { p_table_name: 'forecast_daily' });
  expect(error).toBeNull();
  const cols = ((data ?? []) as Array<{ column_name: string; data_type: string; is_nullable: string }>);
  const granularity = cols.find((c) => c.column_name === 'granularity');
  expect(granularity).toBeDefined();
  expect(granularity!.data_type).toBe('text');
  expect(granularity!.is_nullable).toBe('NO');
});
```

**Insert + CHECK + RLS test pattern** (forecast_daily_granularity.test.ts:44-61):
```typescript
it('CHECK constraint rejects granularity = "hourly"', async () => {
  const { error } = await admin.from('forecast_daily').insert({ ...invalid_row } as never);
  expect(error).not.toBeNull();
  expect(error!.message).toMatch(/check|granularity/i);
});
```

**Tenant-isolation pattern** (tenant-isolation.test.ts:74-91):
```typescript
const wrapperViews = ['kpi_daily_v', 'cohort_v', 'retention_curve_v'];

it.each(wrapperViews)('tenant A only sees tenant A rows on %s', async (view) => {
  const c = tenantClient();
  await c.auth.signInWithPassword({ email: emailA, password });
  const { data, error } = await c.from(view).select('restaurant_id');
  expect(error).toBeNull();
  const rows = (data ?? []) as Array<{ restaurant_id: string }>;
  expect(rows.every((r) => r.restaurant_id === tenantA)).toBe(true);
});
```

**What the planner should reuse:**
- The `admin.rpc('test_table_columns', { p_table_name: '...' })` shape for column-exists assertions.
- The `it.each([...wrapperViews]).('...', async (view) => ...)` pattern from tenant-isolation.test.ts to extend the existing wrapperViews array with `baseline_items_v`, `kpi_daily_with_comparable_v`, `campaign_uplift_v`.
- The auth'd-tenant-JWT signInWithPassword + `from(view).select()` flow for RLS tests — per `.claude/memory/project_silent_error_isolation.md`, NOT a service-role admin probe.

**What the planner must add:**
- Add `'baseline_items_v'`, `'kpi_daily_with_comparable_v'`, `'campaign_uplift_v'` to the `wrapperViews` array in tenant-isolation.test.ts.
- Add `'campaign_calendar'`, `'feature_flags'` to the per-table policy tests (per CONTEXT.md Integration Points).
- New file `forecast_campaign_uplift_v.test.ts` (or extend forecast_daily_granularity.test.ts) with column-shape assertions for the new view.

**Naming note:** Per CONTEXT.md the file names are listed as `tests/forecast/test_campaign_uplift_v.py` and `tests/sql/test_baseline_items_v.py`. The convention in this codebase is TS at `tests/integration/*.test.ts`. The planner should rename to TS (`tests/integration/baseline_items_v.test.ts`, etc.) — this matches the existing style and reuses the vitest fixture infrastructure (`adminClient`, `tenantClient`).

---

#### `tests/forecast/test_offweek_reminder.py` (NEW pytest)

**Analog:** `scripts/forecast/tests/test_run_all_grain_loop.py` (mocked supabase chain helper)

**Why:** D-10's atomic-update race-condition mitigation requires testing that two concurrent runs don't double-fire. Same mocked-client harness as test_run_all.

**What the planner should reuse:**
- The `_build_mock_client()` factory pattern from test_run_all_grain_loop.py:43-102 — adapt for `feature_flags.update().eq().eq().lte().execute()` chain.
- The `pytest.fixture(autouse=True)` pattern at lines 107-110 to inject SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY env vars.

**What the planner must add (Phase 16-unique):**
- Test 1: simulate UPDATE returning 1 row → reminder fires (write_failure call asserted).
- Test 2: simulate UPDATE returning 0 rows (already flipped by sibling run) → reminder skipped silently.
- Test 3: assert the WHERE clause includes `enabled=false AND remind_on_or_after_date <= today`.

---

### CI guards

#### `tests/ci-guards/test_guard_9.sh` + `tests/ci-guards/test_guard_10.sh` (NEW shell tests)

**Analog:** `tests/ci-guards/test_check_cron_schedule.py` (pytest harness for guard) + `tests/ci-guards/red-team-tenant-id.sql` (red-team fixture)

**Why:** Existing convention is to invoke ci-guards.sh against a tmpdir-staged fake repo and assert exit code. The Python harness pattern from `test_check_cron_schedule.py` is the closest functional analog.

**Harness pattern** (test_check_cron_schedule.py:32-46):
```python
def test_current_repo_passes():
    """Guard run against the live repo exits 0."""
    result = subprocess.run(
        [sys.executable, str(HELPER)],
        capture_output=True, text=True, cwd=str(REPO),
    )
    assert result.returncode == 0, (
        f"Guard 8 unexpectedly fired on current repo.\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
```

**Red-team fixture pattern** (tests/ci-guards/red-team-tenant-id.sql:9-13):
```sql
create view public.evil_v as
select *
from public.transactions x
where x.tenant_id::text = (auth.jwt()->>'tenant_id');
```

**What the planner should reuse:**
- Subprocess-invoke-then-assert-exit pattern from test_check_cron_schedule.py.
- The "stage a tmpdir fake repo" pattern (`_stage_fake_repo` at lines 50-60) for negative tests that introduce a deliberate violation and assert the guard fires.
- The red-team SQL/code fixture pattern (small file containing the forbidden pattern, copied into a tmpdir during the test).

**What the planner must add:**
- **Guard 9 test (D-04):** stage a fake `scripts/forecast/<file>.py` containing `kpi_name='revenue_eur'` adjacent to `forecast_track='cf'`; assert ci-guards.sh exit 1 with Guard 9 message.
  - Recommended: in addition to the grep guard, the planner adds a DB CHECK constraint to migration 0058 or 0062 (RESEARCH.md §6 alternative): `CHECK (NOT (forecast_track = 'cf' AND kpi_name = 'revenue_eur'))` — making the rule mathematically airtight at the DB layer. The grep guard becomes secondary.
- **Guard 10 test:** stage a fake `src/<file>.svelte` containing `2026-04-14`; assert ci-guards.sh exit 1.
- Positive tests (sanity): assert the live repo passes both guards after Phase 16 ships.

**Naming note:** CONTEXT.md lists `.sh` files. Existing convention is `.py` (test_check_cron_schedule.py). The planner should pick `.py` to match — or can use `.sh` if the test is genuinely shell-only. Either works; consistency wins. Recommend `.py` matching the established harness.

---

#### `scripts/ci-guards.sh` (MODIFY — append Guards 9 + 10)

**Analog:** self — Guards 7 + 8 structure at lines 89-130.

**Existing Guard 7 pattern** (ci-guards.sh:89-118):
```bash
# Guard 7 (Phase 12 FND-10 / D-09..D-11): JWT claim is `restaurant_id`, NOT `tenant_id`.
# ... preamble ...
GUARD7_CANDIDATES="supabase/migrations/ scripts/forecast/ scripts/external/ src/"
GUARD7_PATHS=""
for _p in $GUARD7_CANDIDATES; do
  [ -e "$_p" ] && GUARD7_PATHS="$GUARD7_PATHS $_p"
done
if [ -n "$GUARD7_PATHS" ]; then
  if grep -rnEH "auth\.jwt\(\)[[:space:]]*->>[[:space:]]*'tenant_id'" $GUARD7_PATHS 2>/dev/null; then
    echo "::error::Guard 7 FAILED: ... rename the reference ..."
    fail=1
  fi
fi
```

**Existing Guard 8 pattern** (ci-guards.sh:120-130):
```bash
# Guard 8 (Phase 12 FND-11 / D-12..D-14): cron schedule overlap + cascade-gap check.
if ! python3 "$(dirname "$0")/ci-guards/check-cron-schedule.py"; then
  echo "::error::Guard 8 FAILED: cron schedule overlap or cascade-gap violation ..."
  fail=1
fi
```

**What the planner should reuse:**
- The header-comment block style: `# Guard <N> (Phase <X> / D-<Y> / SC#<Z>): <one-line purpose>.`
- The `if grep -... ; then echo ... ; fail=1; fi` exit-code accumulation idiom.
- The `[ -e "$_p" ] && PATHS="$PATHS $_p"` defensive path-existence pattern (Guard 7's regression: missing dirs caused false-passes).

**What the planner must add (Phase 16-unique):**
- **Guard 9** body per RESEARCH.md §6 lines 540-562 (the awk-windowing heuristic) OR — STRONGLY PREFERRED — replace with a DB-CHECK-constraint check in migration 0062 + simpler same-file-co-occurrence grep. The grep is a fast-fail; the CHECK constraint is the airtight enforcement.
- **Guard 10** body per RESEARCH.md §6 lines 581-591:
  ```bash
  echo "=== Guard 10: 2026-04-14 literal forbidden in src/ ==="
  if grep -rnE "2026-?04-?14|April[[:space:]]+14[,]?[[:space:]]+2026" src/ 2>/dev/null; then
    echo "::error::Guard 10 FAILED: src/ contains 2026-04-14 literal..."
    fail=1
  fi
  ```

---

### Workflow

#### `.github/workflows/forecast-refresh.yml` (MODIFY — append `cumulative_uplift` step)

**Analog:** self — current workflow at lines 1-64.

**Existing workflow pattern** (forecast-refresh.yml:43-63):
```yaml
- name: Run forecast pipeline
  env:
    SUPABASE_URL: ${{ secrets.DEV_SUPABASE_URL }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.DEV_SUPABASE_SERVICE_ROLE_KEY }}
    MODELS: ${{ inputs.models }}
  run: |
    set -euo pipefail
    ARGS=()
    if [ -n "${MODELS:-}" ]; then
      if ! echo "$MODELS" | grep -qE '^[a-z_]+(,[a-z_]+)*$'; then
        echo "ERROR: MODELS must be comma-separated lowercase identifiers" >&2
        exit 1
      fi
      ARGS+=("--models" "$MODELS")
    fi
    python -m scripts.forecast.run_all "${ARGS[@]}"
```

**What the planner should reuse:**
- The cron schedule `0 7 * * 1` (UTC weekly Monday) — DO NOT change per C-02. Guard 8 enforces.
- The concurrency block (`group: forecast-refresh, cancel-in-progress: false`).
- Service-role-key step-scoping (`env:` block at the step level only, not workflow level).
- The `set -euo pipefail` + input validation regex.
- The `python -m scripts.forecast.<module>` invocation form.

**What the planner must add (per RESEARCH.md §5 lines 429-453):**
- Per CONTEXT.md D-06: `run_all.py --track=both` is the new default; the existing `python -m scripts.forecast.run_all "${ARGS[@]}"` line auto-picks up `--track=both` once the flag lands. NO YAML edit needed for the BAU+CF orchestration itself.
- New step **after** "Run forecast pipeline":
  ```yaml
  - name: Run cumulative uplift
    env:
      SUPABASE_URL: ${{ secrets.DEV_SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.DEV_SUPABASE_SERVICE_ROLE_KEY }}
    run: |
      set -euo pipefail
      python -m scripts.forecast.cumulative_uplift
  ```
- Reorder MV refresh: move it AFTER `cumulative_uplift` (in case `campaign_uplift_v` is backed by an MV per CONTEXT.md "Claude's discretion").

---

### `tests/forecast/cutoff_sensitivity.md` (NEW markdown report)

**Analog:** NO direct analog. The closest discipline is the existing test report patterns under `scripts/forecast/tests/`.

**What the planner must add:**
- Markdown table with header row + 5 model × 3 cutoff = 15 data rows minimum.
- Per CONTEXT.md D-13: rows = `(model, cutoff_offset)`, columns = `cumulative_uplift_eur`, `ci_lower`, `ci_upper`.
- Per RESEARCH.md §2 Pitfall 2.2: include the **sensitivity ratio** as the headline metric: `cumulative_uplift_eur(cutoff=-14d) / cumulative_uplift_eur(cutoff=-7d)`. Healthy range `[0.8, 1.25]`.
- Generation procedure: run `counterfactual_fit.py --train-end-offset {-14,-7,-1}` against the 5 BAU models on `revenue_comparable_eur`, sum each result over the 2026-04-14 → today window, write to the markdown table.
- Committed once during Phase 16 plan execution; future runs append a new section dated `as_of: <date>`.

---

## Shared Patterns

### Restaurant-ID JWT filter (cross-cutting RLS)

**Source:** `supabase/migrations/0010_cohort_mv.sql:75` + `0050_forecast_daily.sql:20` + `0054_forecast_with_actual_v.sql:16`

**Apply to:** `0058_campaign_calendar.sql`, `0059_baseline_items_v.sql`, `0060_kpi_daily_with_comparable_v.sql`, `0061_feature_flags.sql`, `0062_campaign_uplift_v.sql`

```sql
-- Wrapper-view form (preferred for read-only views):
WHERE restaurant_id = (auth.jwt()->>'restaurant_id')::uuid

-- Policy form (for tables with INSERT/UPDATE policies):
CREATE POLICY <name>_select ON public.<table>
    FOR SELECT USING (restaurant_id = (auth.jwt()->>'restaurant_id')::uuid);
```

**Critical:** the JWT claim is `restaurant_id`, NOT `tenant_id` (Guard 7 catches the regression).

### Service-role-only writes (cross-cutting)

**Source:** `supabase/migrations/0050_forecast_daily.sql:21` + `0046_pipeline_runs_extend.sql:33`

**Apply to:** All Phase 16 tables (`campaign_calendar`, `feature_flags`).

```sql
REVOKE INSERT, UPDATE, DELETE ON public.<table> FROM authenticated, anon;
GRANT SELECT ON public.<table> TO authenticated;
```

Service_role bypasses RLS at the role level (`bypassrls=true`), so the REVOKE is what gates anon/authenticated writes.

### REVOKE-on-MV + wrapper-view-only access (cross-cutting)

**Source:** `supabase/migrations/0010_cohort_mv.sql:59` + `0053_forecast_daily_mv.sql:11`

**Apply to:** Any new MV in Phase 16 (e.g., if `campaign_uplift_v` is backed by an MV, the planner adds:)

```sql
REVOKE ALL ON public.<mv_name> FROM authenticated, anon;
-- Then create wrapper view (above) with auth.jwt() filter and GRANT SELECT to authenticated.
```

Per Phase 1 invariant + CI Guard 1: src/ never reads raw `_mv` tables.

### pipeline_runs row writes (cross-cutting)

**Source:** `scripts/external/pipeline_runs_writer.py:42-67`

**Apply to:** `scripts/forecast/counterfactual_fit.py`, `scripts/forecast/cumulative_uplift.py`

```python
from scripts.external.pipeline_runs_writer import write_success, write_failure

started_at = datetime.now(timezone.utc)
try:
    n = fit_and_write(client, ...)
    write_success(client, step_name=STEP_NAME, started_at=started_at,
                  row_count=n, restaurant_id=restaurant_id, fit_train_end=train_end)
    sys.exit(0)
except Exception:
    err_msg = traceback.format_exc()
    try:
        write_failure(client, step_name=STEP_NAME, started_at=started_at,
                      error_msg=err_msg, restaurant_id=restaurant_id, fit_train_end=train_end)
    except Exception as write_err:
        print(f'Could not write failure row: {write_err}', file=sys.stderr)
    sys.exit(1)
```

Per C-03 / Phase 13 pattern. Each Track-B model fit writes one row with `step_name='cf_<model>'` and `fit_train_end` populated.

### LayerChart + Tooltip.Root snippet (cross-cutting UI)

**Source:** `src/lib/components/RevenueForecastCard.svelte:118-203`

**Apply to:** `src/lib/components/CampaignUpliftCard.svelte`

```svelte
<Chart bind:context={chartCtx} {data} ... tooltipContext={{ mode: 'bisect-x', touchEvents: 'auto' }}>
  <Svg>
    <Area y0=... y1=... curve={curveMonotoneX} fillOpacity={0.06} />
    <Spline ... curve={curveMonotoneX} stroke-width={2} />
  </Svg>
  <Tooltip.Root contained="window" class="max-w-[80vw] text-xs">
    {#snippet children({ data })}
      ...
    {/snippet}
  </Tooltip.Root>
</Chart>
```

C-12 (`{#snippet children({ data })}` not `let:data`), C-13 (`touchEvents: 'auto'`), D-17 (`fillOpacity={0.06}`).

### LazyMount + clientFetch (cross-cutting UI)

**Source:** `src/lib/components/RevenueForecastCard.svelte:48-55` + `src/routes/+page.svelte:282-286`

**Apply to:** `src/lib/components/CampaignUpliftCard.svelte` + `src/routes/+page.svelte` (slot)

```svelte
<!-- In the page composition -->
<LazyMount minHeight="200px">
  {#snippet children()}
    <CampaignUpliftCard />
  {/snippet}
</LazyMount>

<!-- In the component itself -->
<script lang="ts">
  let data = $state<UpliftPayload | null>(null);
  $effect(() => {
    void clientFetch<UpliftPayload>('/api/campaign-uplift')
      .then(d => { data = d; })
      .catch(e => console.error('[CampaignUpliftCard]', e));
  });
</script>
```

Phase 11 D-03 + C-09 + `.claude/memory/project_silent_error_isolation.md`.

---

## No Analog Found

| File | Role | Reason | Recommendation |
|------|------|--------|----------------|
| `tests/forecast/cutoff_sensitivity.md` | test artifact (markdown) | Project has no precedent for committed markdown sensitivity reports under `tests/`. The closest model is generated docs under `docs/superpowers/plans/`, but those serve a different purpose. | Author from scratch per RESEARCH.md §2 + CONTEXT.md D-13. Use a 3-column markdown table; treat the `.md` as a write-once-per-phase artifact, not a test runner output. |
| `scripts/forecast/cumulative_uplift.py` (new aggregator) | python orchestration | No exact analog — this is a NEW aggregator that crosses tables (forecast_with_actual_v + yhat_samples + campaign_calendar). | Synthesize from THREE analogs: (a) `sample_paths.py` for the bootstrap math, (b) `run_all.py` for the orchestrator shell, (c) `pipeline_runs_writer.py` for the success/failure row writes. The planner combines them into one new module per RESEARCH.md §1 pseudocode + RESEARCH.md §5 resilience pattern. |

---

## Metadata

**Analog search scope:**
- `supabase/migrations/0001` … `0057` (full migration history)
- `scripts/forecast/` (5 BAU fit modules + helpers + tests)
- `scripts/external/pipeline_runs_writer.py` + `scripts/external/run_all.py`
- `src/routes/api/forecast/+server.ts`, `src/routes/api/campaign-uplift/+server.ts`
- `src/lib/components/RevenueForecastCard.svelte`, `InvoiceCountForecastCard.svelte`, `EventMarker.svelte`
- `src/lib/forecastConfig.ts`, `src/lib/forecastEventClamp.ts`
- `src/routes/+page.svelte`
- `scripts/ci-guards.sh`, `scripts/ci-guards/check-cron-schedule.py`, `scripts/ci-guards/no-dynamic-sql.sh`
- `tests/integration/`, `tests/ci-guards/`, `scripts/forecast/tests/`
- `.github/workflows/forecast-refresh.yml`

**Files scanned:** ~28 (Read calls) across migrations, Python forecast modules, Svelte components, API endpoints, tests, CI guards, workflows.

**Pattern extraction date:** 2026-05-01

---

## PATTERN MAPPING COMPLETE

Every Phase 16 file has a concrete analog plus targeted code excerpts the planner can paste-and-edit. The dominant patterns reused are: (1) RLS-via-`auth.jwt()->>'restaurant_id'` filters and `REVOKE writes; GRANT SELECT` blocks across all six new migrations, mechanically copied from `0050_forecast_daily.sql` and `0054_forecast_with_actual_v.sql`; (2) the per-model `fit_and_write(client, *, restaurant_id, kpi_name, run_date, granularity)` signature from `scripts/forecast/sarimax_fit.py` extended with a Track-B variant for `counterfactual_fit.py`; (3) the bootstrap-numpy + orchestrator-shell composition from `sample_paths.py` + `run_all.py` + `pipeline_runs_writer.py` for `cumulative_uplift.py` (the one file with NO single analog — synthesized from three); (4) the `Chart` + `Spline` + `Area` + `Tooltip.Root {#snippet children}` + `touchEvents: 'auto'` + `fillOpacity={0.06}` pattern from `RevenueForecastCard.svelte` for `CampaignUpliftCard.svelte`, dropping axes and `Highlight` for the 280×100px sparkline form factor; (5) the supabase-stub + mocked-chained-client harness from `test_run_all_grain_loop.py` for all new pytest files. Two cross-cutting recommendations: promote Guard 9 from grep-heuristic to a DB CHECK constraint on `forecast_daily` (mathematically airtight per RESEARCH.md §6), and rename the new view-shape tests from `.py` to `.test.ts` to match the established `tests/integration/*.test.ts` convention with `adminClient`/`tenantClient` fixtures.
