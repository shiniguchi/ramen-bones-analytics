# Phase 17: Backtest Gate & Quality Monitoring — Pattern Map

**Mapped:** 2026-05-06
**Files analyzed:** 23 (10 NEW Python + 3 NEW SQL + 2 NEW GHA + 1 NEW docs + 1 NEW Svelte test + 6 MODIFIED) + per-fit-script CLI extension (5 files share one pattern)
**Analogs found:** 23 / 23 (all have at-least-role-match analog in repo)

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `scripts/forecast/backtest.py` | Python orchestrator script | batch (fold loop, subprocess fan-out) | `scripts/forecast/run_all.py` (subprocess loop) + `scripts/forecast/last_7_eval.py` (compute_metrics, DB-write) | exact |
| `scripts/forecast/naive_dow_with_holidays.py` | Python model fit script | batch (fit → write forecast_daily) | `scripts/forecast/naive_dow_fit.py` (full file copy-and-adapt) | exact |
| `scripts/forecast/conformal.py` | Python pure-math helper | transform (numpy in, dict out) | `scripts/forecast/last_7_eval.py:21-70` (pure-function shape) | role-match |
| `scripts/forecast/quality_gate_check.py` | Python CI gate script | request-response (DB read → exit code) | `scripts/forecast/last_7_eval.py` (DB read + service_role) + early-exit pattern from `run_all.py:174-182` | role-match |
| `scripts/forecast/write_accuracy_log.py` | Python file-writer script | file-I/O (DB read → markdown write) | `scripts/forecast/last_7_eval.py` (DB read shape) — no exact analog for markdown write | role-match |
| `scripts/forecast/gate.py` (or inline in `backtest.py` — see notes) | Python DB-update helper | CRUD (UPDATE feature_flags) | `scripts/forecast/cumulative_uplift.py:445-453` (atomic feature_flags UPDATE) | exact |
| `.github/workflows/forecast-backtest.yml` | GHA workflow (cron) | event-driven (cron + commit-back) | `.github/workflows/forecast-refresh.yml` | exact (only `permissions` + cron + commit step differ) |
| `.github/workflows/forecast-quality-gate.yml` | GHA workflow (PR gate) | event-driven (pull_request + paths filter) | `.github/workflows/forecast-refresh.yml` (setup) + `.github/workflows/its-validity-audit.yml` (minimal cron-style) | role-match |
| `docs/forecast/ACCURACY-LOG.md` | Append-only Markdown log | file-I/O (auto-committed) | `.planning/learnings/16.2-prophet-past-projection-path-b.md` (header + sections; no auto-commit analog) | partial (no auto-generation analog in repo) |
| `supabase/migrations/00XX_phase17_backtest_schema.sql` | SQL migration (table extend + view drop/create + seed) | CRUD (DDL + INSERT) | `supabase/migrations/0061_feature_flags.sql` (table + RLS + CROSS JOIN seed pattern) + `0014_data_freshness_v.sql` (view shape) + `0051_forecast_quality.sql` (PK shape; for ALTER TABLE additions) | exact |
| `scripts/forecast/tests/test_backtest.py` | Pytest unit tests | event-driven (assert) | `scripts/forecast/tests/test_eval.py` (compute_metrics shape) + `tests/test_run_all_grain_loop.py` (subprocess + supabase stub) | exact |
| `scripts/forecast/tests/test_naive_dow_with_holidays.py` | Pytest | event-driven (assert) | `scripts/forecast/tests/test_eval.py` | role-match |
| `scripts/forecast/tests/test_conformal.py` | Pytest | event-driven (assert) | `scripts/forecast/tests/test_eval.py` (pure-numpy assertion shape) | exact |
| `scripts/forecast/tests/test_gate.py` | Pytest | event-driven (mocked DB) | `scripts/forecast/tests/test_run_all_grain_loop.py` (supabase stub + MagicMock router) | exact |
| `scripts/forecast/tests/test_quality_gate_check.py` | Pytest | event-driven (mocked DB + exit code) | `scripts/forecast/tests/test_run_all_grain_loop.py` | role-match |
| `scripts/forecast/tests/test_accuracy_log.py` | Pytest | event-driven (file-fixture) | `scripts/forecast/tests/test_eval.py` | partial |
| `scripts/forecast/tests/test_workflow_yaml.py` | Pytest (parses YAML) | transform (file → dict assert) | no exact analog (closest: any test that parses a config file) | partial — write greenfield using PyYAML |
| `scripts/forecast/tests/test_data_freshness_v.py` | Pytest (DB integration) | event-driven (live DB) | `scripts/forecast/tests/test_run_all_grain_loop.py` (supabase stub) — but this test SHOULD hit real DEV DB per CLAUDE.md | role-match (different live-DB shape) |
| `scripts/forecast/tests/test_run_all_feature_flags.py` | Pytest (mocked DB) | event-driven | `scripts/forecast/tests/test_run_all_grain_loop.py` | exact |
| `src/lib/components/ModelAvailabilityDisclosure.test.ts` | Vitest + Testing-Library Svelte test | event-driven (DOM assert) | `src/lib/components/InsightCard.test.ts` | exact |
| `scripts/forecast/sarimax_fit.py` (MODIFY) | argparse retrofit | transform (CLI flag → kwarg) | bottom block of `naive_dow_fit.py:498-545` (env-var-only `__main__`) | exact |
| `scripts/forecast/{prophet,ets,theta,naive_dow}_fit.py` (MODIFY) | same as above | same | same | exact |
| `scripts/forecast/run_all.py` (MODIFY) | add `_get_enabled_models` query at startup | request-response (DB read) | `scripts/forecast/run_all.py:51-57` `_get_restaurant_id` (single-table read shape) | exact (sister-function to existing helper) |
| `src/lib/components/ModelAvailabilityDisclosure.svelte` (MODIFY) | extend table with backtest column | request-response (props → DOM) | self (line 115-138 `<tr>` block) | exact (extension, not new) |

---

## Pattern Assignments

### `scripts/forecast/backtest.py` (NEW — orchestrator, batch)

**Analog:** `scripts/forecast/run_all.py` (subprocess pattern) + `scripts/forecast/last_7_eval.py` (metrics + DB write)

**Module docstring + header pattern** — copy from `run_all.py:1-43`:

```python
"""Phase 17: backtest.py — rolling-origin CV driver for the gate.

Spawns each *_fit.py per fold via subprocess (same pattern as run_all.py),
passing --train-end / --eval-start CLI flags. Computes RMSE+MAPE per
(model × horizon × fold) using compute_metrics() from last_7_eval. Writes
forecast_quality rows with evaluation_window='rolling_origin_cv'. Calibrates
conformal CIs at h=35 via scripts.forecast.conformal. Flips feature_flags
.enabled=false for failing models per BCK-04.

Exit codes:
  0  — at least one (model, horizon, fold) succeeded; gate may have flipped flags
  1  — total failure or freshness-gate abort

CLI:
    python -m scripts.forecast.backtest [--models sarimax,...] [--run-date YYYY-MM-DD]
"""
from __future__ import annotations
import argparse
import os
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from scripts.forecast.db import make_client
from scripts.forecast.last_7_eval import compute_metrics
from scripts.forecast.conformal import calibrate_conformal_h35
from scripts.external.pipeline_runs_writer import write_failure, write_success

HORIZONS = [7, 35, 120, 365]
N_FOLDS = 4
DEFAULT_MODELS = 'sarimax,prophet,ets,theta,naive_dow,naive_dow_with_holidays'
KPIS = ['revenue_eur', 'invoice_count']
STEP_NAME = 'forecast_backtest'
```

**Subprocess fan-out** — copy pattern verbatim from `run_all.py:114-144`:

```python
# scripts/forecast/run_all.py:114-144 [VERIFIED]
def _run_model(*, model, restaurant_id, kpi_name, run_date, granularity) -> bool:
    env = _build_subprocess_env(
        restaurant_id=restaurant_id, kpi_name=kpi_name,
        run_date=run_date, granularity=granularity,
    )
    cmd = [sys.executable, '-m', f'scripts.forecast.{model}_fit']
    print(f'[run_all] Spawning: {" ".join(cmd)} KPI={kpi_name} GRAIN={granularity}')
    result = subprocess.run(cmd, env=env, text=True, capture_output=True)
    if result.stdout: print(result.stdout, end='')
    if result.stderr: print(result.stderr, end='', file=sys.stderr)
    if result.returncode == 0:
        return True
    return False
```

**`backtest.py` extends this** by appending CLI flags to `cmd`:

```python
cmd = [sys.executable, '-m', f'scripts.forecast.{model}_fit',
       '--train-end', train_end.isoformat(),
       '--eval-start', eval_start.isoformat(),
       '--fold-index', str(fold_idx)]
```

**Subprocess env builder** — copy `run_all.py:87-111` verbatim (includes the explicit threading of `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` per autoplan E7):

```python
# scripts/forecast/run_all.py:87-111 [VERIFIED]
def _build_subprocess_env(*, restaurant_id, kpi_name, run_date, granularity):
    env = os.environ.copy()
    env['RESTAURANT_ID'] = restaurant_id
    env['KPI_NAME'] = kpi_name
    env['RUN_DATE'] = run_date
    env['GRANULARITY'] = granularity
    for key in ('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'):
        if key not in env:
            raise RuntimeError(f'{key} must be set ...')
    return env
```

**Compute-metrics call site** — `compute_metrics` is reused verbatim from `last_7_eval.py:21-70`:

```python
# scripts/forecast/last_7_eval.py:65-70 — return shape
return {
    'rmse': rmse,
    'mape': mape,
    'mean_bias': mean_bias,
    'direction_hit_rate': direction_hit_rate,
}
```

**`forecast_quality` upsert shape** — copy from `last_7_eval.py:206-218`:

```python
# scripts/forecast/last_7_eval.py:206-218 [VERIFIED]
quality_row = {
    'restaurant_id': restaurant_id,
    'kpi_name': kpi_name,
    'model_name': model_name,
    'evaluated_at': datetime.now(timezone.utc).isoformat(),
    'n_days': len(aligned_actuals),
    'rmse': round(metrics['rmse'], 4),
    'mape': round(metrics['mape'], 4),
    'mean_bias': round(metrics['mean_bias'], 4),
    'direction_hit_rate': round(metrics['direction_hit_rate'], 4),
    'horizon_reliability_cutoff': horizon_cutoff,
}
client.table('forecast_quality').upsert(quality_row).execute()
```

**`backtest.py` extends this** with the new Phase 17 columns: add `'horizon_days': horizon`, `'evaluation_window': 'rolling_origin_cv'`, `'fold_index': fold_idx`, `'train_end_date': train_end.isoformat()`, `'eval_start_date': eval_start.isoformat()`, `'gate_verdict': None` (filled in second pass after gate decision).

**Pipeline-runs writer pattern** — emit a `forecast_backtest` row on completion (copy from `run_all.py:194-204`):

```python
# scripts/forecast/run_all.py:194-204 [VERIFIED]
write_failure(
    client,
    step_name=STEP_NAME,
    started_at=datetime.now(timezone.utc),
    error_msg=msg,
    restaurant_id=restaurant_id,
)
```

**Conventions to preserve:**
- Single `make_client()` call at start (NOT per-fold) — see `run_all.py:172`. RLS-bypass via service_role.
- Print a `[backtest] ...` prefix on every log line (matches `[run_all]` / `[naive_dow_fit]` convention).
- Fold-failure non-fatal: continue with remaining folds (`run_all.py:140-144` shape).
- Final exit code: 0 on partial success, 1 only on total failure (`run_all.py:307-308`).
- **Do NOT write per-fold yhat rows to `forecast_daily`** (R1 from RESEARCH §Cross-cutting Risks): keep yhats in-memory, write only `forecast_quality` rows.

---

### `scripts/forecast/naive_dow_with_holidays.py` (NEW — model fit, batch)

**Analog:** `scripts/forecast/naive_dow_fit.py` (full 546-line file — copy-and-adapt; D-05 forbids modifying naive_dow_fit.py).

**Imports + constants block** — copy `naive_dow_fit.py:23-51` verbatim, only changing `STEP_NAME`:

```python
# scripts/forecast/naive_dow_fit.py:23-51 [VERIFIED]
from __future__ import annotations
import json
import os
import sys
import traceback
from datetime import date, datetime, timezone
from collections import defaultdict
from typing import Optional

import numpy as np
import pandas as pd

from scripts.forecast.db import make_client
from scripts.forecast.closed_days import zero_closed_days, filter_open_days
from scripts.forecast.aggregation import bucket_to_weekly, bucket_to_monthly
from scripts.forecast.sample_paths import bootstrap_from_residuals, paths_to_jsonb
from scripts.forecast.grain_helpers import (
    HORIZON_BY_GRAIN,
    parse_granularity_env,
    pred_dates_for_grain,
    train_end_for_grain,
    window_start_for_grain,
)
from scripts.external.pipeline_runs_writer import write_success, write_failure

N_PATHS = 200
STEP_NAME = 'forecast_naive_dow_with_holidays'  # CHANGE
CHUNK_SIZE = 100
```

**Add this NEW import** for regressor access:

```python
from scripts.forecast.exog import build_exog_matrix, EXOG_COLUMNS
```

**Reuse helpers verbatim** (do not re-implement; import from `naive_dow_fit`):
- `_seasonal_key` (`naive_dow_fit.py:56-70`)
- `_fetch_history` (`naive_dow_fit.py:73-100+`)
- `_seasonal_means_and_residuals` (`naive_dow_fit.py:204-223`)
- `_open_future_dates` (`naive_dow_fit.py:226-230`)
- `_build_forecast_rows_daily` / `_bucket` (`naive_dow_fit.py:233-302`) — adjust `model_name` to `'naive_dow_with_holidays'`
- `_upsert_rows` (`naive_dow_fit.py:247-254` of sarimax_fit.py shape — same in naive_dow_fit)

**NEW logic — holiday multiplier from exog flags** (this is the only genuinely new code):

```python
def _compute_holiday_multipliers(
    *,
    history_df: pd.DataFrame,         # has 'date' + kpi value column
    exog_df: pd.DataFrame,            # build_exog_matrix output, indexed by date
    seasonal_means: dict,             # {dow: mean_y}
    granularity: str,
) -> dict:
    """Return {(is_holiday, is_school, is_event, is_strike): multiplier} dict.

    For each historical date, residual_ratio = y / dow_mean. Group ratios by
    holiday-flag combo and take the mean. Missing combos fall back to 1.0
    (== plain naive_dow behavior).
    """
    # Build per-date ratio
    ratios_by_combo: dict[tuple, list[float]] = defaultdict(list)
    for d, y in zip(history_df['date'], history_df['y']):
        if d not in exog_df.index:
            continue
        flags = (
            int(exog_df.loc[d, 'is_holiday']),
            int(exog_df.loc[d, 'is_school_holiday']),
            int(exog_df.loc[d, 'is_event']),
            int(exog_df.loc[d, 'is_strike']),
        )
        dow_mean = seasonal_means.get(_seasonal_key(d, granularity), 0.0)
        if dow_mean > 0:
            ratios_by_combo[flags].append(float(y) / dow_mean)
    return {combo: float(np.mean(rs)) for combo, rs in ratios_by_combo.items() if rs}
```

**`__main__` block + argparse** — see "Shared Patterns → CLI argparse retrofit" section below.

**Conventions to preserve:**
- `model_name='naive_dow_with_holidays'` literal (per A7 in RESEARCH Assumptions Log)
- Pre-plan check: grep `0050_forecast_daily.sql` for `CHECK.*model_name` constraint (R8) — extend if present.
- Reuse `bootstrap_from_residuals` from `sample_paths.py` (do NOT reinvent).
- Daily grain only initially (matches `run_all.py` train_end_for_grain pattern); week/month inherits if helpers cover it.

---

### `scripts/forecast/conformal.py` (NEW — pure helper, transform)

**Analog:** `scripts/forecast/last_7_eval.py:21-70` (the pure `compute_metrics` function — same shape: numpy in, dict out, no DB).

**Pure-function template** — copy structural shape from `last_7_eval.py:21-70`:

```python
# scripts/forecast/last_7_eval.py:21-45 [VERIFIED — pure-function shape]
def compute_metrics(actuals, yhats, is_open=None) -> dict:
    """..."""
    actuals = np.asarray(actuals, dtype=float)
    yhats = np.asarray(yhats, dtype=float)
    rmse = float(np.sqrt(np.mean((yhats - actuals) ** 2)))
    # ...
    return {'rmse': rmse, 'mape': mape, ...}
```

**`conformal.py` body** (~30 LOC, per RESEARCH §ConformalIntervals Option 1):

```python
"""Phase 17 BCK-02: conformal CI calibration at h=35.

Per Vovk/Shafer split-conformal: collect absolute residuals from prior folds
at the matching horizon-step h, take the (1-alpha) empirical quantile, add
to the point forecast for the (lower, upper) CI band.

D-03 lock: statsforecast.cross_validation NOT used as loop driver.
backtest.py owns the rolling-origin loop; this module owns calibration.
"""
from __future__ import annotations
import numpy as np

def calibrate_conformal_h35(
    fold_residuals: dict[int, np.ndarray],
    alpha: float = 0.05,
) -> dict:
    """Return {'qhat_h35': float} — the conformal quantile to add ± to point forecast."""
    if not fold_residuals:
        return {'qhat_h35': float('nan')}
    all_residuals = np.concatenate([np.asarray(r, dtype=float) for r in fold_residuals.values()])
    if all_residuals.size == 0:
        return {'qhat_h35': float('nan')}
    qhat = float(np.quantile(np.abs(all_residuals), 1 - alpha))
    return {'qhat_h35': qhat}
```

**Conventions to preserve:**
- No DB access. Pure function — testable without supabase stub.
- Match `last_7_eval.compute_metrics`'s `np.asarray(..., dtype=float)` defensive coercion shape.
- Returns `dict` (not tuple/dataclass) — same shape as `compute_metrics` for grep-traceability.

---

### `scripts/forecast/quality_gate_check.py` (NEW — CI gate, request-response)

**Analog:** `scripts/forecast/last_7_eval.py` (DB-read shape via service_role) + `run_all.py:174-182` (early exit on guard).

**DB-read pattern** — copy `last_7_eval.py:108-117` shape:

```python
# scripts/forecast/last_7_eval.py:108-117 [VERIFIED]
resp = (
    client.table('kpi_daily_mv')
    .select('business_date,revenue_cents,tx_count')
    .eq('restaurant_id', restaurant_id)
    .gte('business_date', str(eval_start))
    .lte('business_date', str(eval_end))
    .order('business_date')
    .limit(10000)
    .execute()
)
```

**`quality_gate_check.py` adapted query:**

```python
# Read enabled models AND their latest gate_verdicts
flags_resp = (
    client.table('feature_flags')
    .select('restaurant_id,flag_key,enabled')
    .like('flag_key', 'model_%')
    .eq('enabled', True)
    .execute()
)
enabled_models = {row['flag_key'].removeprefix('model_') for row in (flags_resp.data or [])}

verdicts_resp = (
    client.table('forecast_quality')
    .select('model_name,horizon_days,gate_verdict,evaluated_at')
    .eq('evaluation_window', 'rolling_origin_cv')
    .order('evaluated_at', desc=True)
    .execute()
)
```

**Early-exit pattern** — copy from `run_all.py:174-182`:

```python
# scripts/forecast/run_all.py:174-182 [VERIFIED]
weather_count = _check_weather_guard(client)
if weather_count == 0:
    print(
        '[run_all] ABORT: weather_daily has 0 rows. ...',
        file=sys.stderr,
    )
    return 1
```

**`quality_gate_check.py` adaptation:**

```python
def main() -> int:
    client = make_client()
    failures = _find_enabled_failures(client)  # returns list of (model, horizon, verdict)
    if failures:
        print('[quality_gate_check] FAIL — enabled models with FAIL verdict:', file=sys.stderr)
        for model, horizon, verdict in failures:
            print(f'  - {model} @ h={horizon}: {verdict}', file=sys.stderr)
        return 1
    print('[quality_gate_check] PASS — all enabled models have PASS or PENDING verdicts')
    return 0

if __name__ == '__main__':
    sys.exit(main())
```

**Conventions to preserve:**
- Service-role via `make_client()` (`db.py`) — no auth-cookie path.
- Stderr for failure detail; stdout for final OK message.
- Exit 1 on FAIL (CI semantics); exit 0 on PASS or all-PENDING.
- 5-min timeout cap per BCK-06 — keep deps minimal (`pip install supabase python-dotenv`, NO cmdstan).

---

### `scripts/forecast/write_accuracy_log.py` (NEW — file writer, file-I/O)

**Analog:** `scripts/forecast/last_7_eval.py` for DB-read shape; `pipeline_runs_writer` for "write artifact then return" shape. **No exact analog for markdown templating** — write greenfield using f-string templating.

**DB read** — same `forecast_quality` query as `quality_gate_check.py` above.

**Markdown writing pattern** — file is auto-generated. Keep the logic simple and the templates inline. Per RESEARCH §ACCURACY-LOG.md Format:

```python
"""Phase 17 BCK-07: regenerate docs/forecast/ACCURACY-LOG.md from forecast_quality.

Idempotent: if no new run since last week, the rendered file is byte-equal to
the on-disk one and the workflow's bash `git diff --staged --quiet` skips
the commit.
"""
import os
from datetime import datetime, timezone
from pathlib import Path

from scripts.forecast.db import make_client

ACCURACY_LOG = Path(__file__).resolve().parents[2] / 'docs' / 'forecast' / 'ACCURACY-LOG.md'

LATEST_HEADER = """\
# Forecast Accuracy Log

Auto-generated weekly by `.github/workflows/forecast-backtest.yml` (Tuesday 23:00 UTC).
Do not edit by hand — the next cron run will overwrite manual edits.

**Production model:** {production_model}

---

## Latest run: {run_date} UTC

> {honest_failure_line}

| Model | h=7 | h=35 | h=120 | h=365 | Verdict |
|---|---|---|---|---|---|
{rows}

**Conformal CI calibration (h=35):** qhat_95 = {qhat:.0f} EUR (revenue_eur)

---

## History

"""

HONEST_FAILURE_DEFAULT = (
    'naive-DoW-with-holidays remains production model — '
    'no challenger promoted this week.'
)
```

**Conventions to preserve:**
- Append-only: read existing file, parse "## History" anchor, prepend new "## Latest run" block, preserve everything below "## History".
- `[skip ci]` is added by the workflow's commit step, not by this script.
- Honest-failure copy must include the EXACT string `naive-DoW-with-holidays remains production model — no challenger promoted this week.` when no challenger PASSes (per CONTEXT.md specifics).

---

### `scripts/forecast/gate.py` (NEW — DB updater, CRUD) — OR inline in `backtest.py`

**Recommendation per RESEARCH §Architectural Responsibility Map: keep inline as `_apply_gate_to_feature_flags(...)` inside `backtest.py`**. Only extract to its own module if `backtest.py` exceeds ~400 LOC.

**Analog:** `scripts/forecast/cumulative_uplift.py:445-453` — atomic `feature_flags` UPDATE.

**Atomic UPDATE pattern** — copy verbatim from `cumulative_uplift.py:445-453`:

```python
# scripts/forecast/cumulative_uplift.py:445-453 [VERIFIED]
resp = (
    client.table("feature_flags")
    .update({"enabled": True, "updated_at": "now()"})
    .eq("flag_key", "offweek_reminder")
    .eq("enabled", False)
    .lte("remind_on_or_after_date", today.isoformat())
    .execute()
)
rows = getattr(resp, "data", None) or []
if not rows:
    return False
```

**`backtest.py` adaptation** — flip enabled=false on FAIL (per RESEARCH §Gate Algorithm):

```python
def _apply_gate_to_feature_flags(client, restaurant_id, verdicts, horizon):
    """BCK-04: any model with FAIL flips enabled=false. Baselines are NEVER flipped."""
    for model, verdict in verdicts.items():
        if model in ('naive_dow', 'naive_dow_with_holidays'):
            continue  # baselines stay always-on per D-06 / R7
        if verdict == 'FAIL':
            client.table('feature_flags').update({
                'enabled': False,
                'updated_at': datetime.now(timezone.utc).isoformat(),
            }).eq('restaurant_id', restaurant_id).eq('flag_key', f'model_{model}').execute()
```

**Conventions to preserve:**
- **Hard-coded baseline guard**: `naive_dow` and `naive_dow_with_holidays` are NEVER flipped (R7 risk mitigation; cannot be configured away).
- `'updated_at': "now()"` literal (Supabase server-time) is used by `cumulative_uplift` line 448 for race-mitigation — but for gate writes, prefer `datetime.now(timezone.utc).isoformat()` (RESEARCH §Codebase Reuse Map deliverable 6 explicit note).
- One UPDATE per (model, restaurant_id) pair — no bulk update (matches `cumulative_uplift` shape).

---

### `.github/workflows/forecast-backtest.yml` (NEW — GHA cron, event-driven)

**Analog:** `.github/workflows/forecast-refresh.yml` (89 lines — exact match for setup; only `permissions`, `cron`, `timeout-minutes`, and final commit step differ).

**Header + permissions block** — start from `forecast-refresh.yml:1-17` and swap `contents: read` → `contents: write`:

```yaml
# .github/workflows/forecast-refresh.yml:1-17 [VERIFIED]
name: Forecast Refresh
on:
  workflow_dispatch:
    inputs:
      models:
        description: 'Comma-separated model list (omit for all enabled)'
        required: false
        default: ''

permissions:
  contents: read       # <-- Phase 17 forecast-backtest.yml: change to `contents: write`

concurrency:
  group: forecast-refresh    # <-- Phase 17: change to `forecast-backtest`
  cancel-in-progress: false  # KEEP false (D-07 + RESEARCH §Codebase Reuse Map deliverable 5)
```

**Setup steps + run pattern** — copy verbatim from `forecast-refresh.yml:26-62`:

```yaml
# .github/workflows/forecast-refresh.yml:26-62 [VERIFIED]
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
            if ! echo "$MODELS" | grep -qE '^[a-z_]+(,[a-z_]+)*$'; then
              echo "ERROR: MODELS must be comma-separated lowercase identifiers" >&2
              exit 1
            fi
            ARGS+=("--models" "$MODELS")
          fi
          python -m scripts.forecast.run_all "${ARGS[@]}"
```

**`forecast-backtest.yml` adapts this** — replace `run_all` with `backtest`, add cron, add commit step. Full template in RESEARCH §GHA Workflow Templates lines 599-686.

**NEW commit-back step** (no analog in repo — write greenfield using github-actions[bot] convention):

```yaml
      - name: Commit ACCURACY-LOG.md
        run: |
          set -euo pipefail
          git config user.name 'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          git add docs/forecast/ACCURACY-LOG.md
          if git diff --staged --quiet; then
            echo "No ACCURACY-LOG changes to commit"
            exit 0
          fi
          git commit -m "docs(forecast): weekly ACCURACY-LOG update [skip ci]"
          git push origin HEAD:main
```

**Conventions to preserve:**
- `concurrency: cancel-in-progress: false` — CRITICAL (D-07 + RESEARCH §R5/R6). Default true would kill in-progress runs.
- Inputs threaded via `env:` not direct `${{ }}` interpolation in shell (REVIEW C-1/MS-1 from forecast-refresh.yml comments — same shell-injection mitigation here).
- `[skip ci]` in commit message — prevents the auto-commit from re-triggering `forecast-quality-gate.yml` on itself (RESEARCH note line 689).
- Cron: `'0 23 * * 2'` — Tuesday 23:00 UTC (CONTEXT specifics; do not change).
- `timeout-minutes: 30` (R5 risk; refine after first run measurement).

---

### `.github/workflows/forecast-quality-gate.yml` (NEW — GHA PR check, event-driven)

**Analog:** `forecast-refresh.yml` (setup steps) + `its-validity-audit.yml:1-23` (minimal job shape).

**`its-validity-audit.yml` minimal pattern** — copy structural shape:

```yaml
# .github/workflows/its-validity-audit.yml:1-23 [VERIFIED]
name: ITS Validity Audit
on:
  schedule:
    - cron: '0 9 * * 1'
  workflow_dispatch:
jobs:
  audit:
    runs-on: ubuntu-latest
    env:
      SUPABASE_URL: ${{ secrets.DEV_SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.DEV_SUPABASE_SERVICE_ROLE_KEY }}
      GITHUB_SHA: ${{ github.sha }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'
          cache-dependency-path: tools/requirements-audit.txt
      - name: Install audit deps
        run: pip install -r tools/requirements-audit.txt
      - name: Run ITS validity audit
        run: python tools/its_validity_audit.py
```

**`forecast-quality-gate.yml` adapts this** — swap trigger to `pull_request: paths:`, add concurrency. Full template in RESEARCH §GHA Workflow Templates lines 695-733.

**Trigger + concurrency** (NEW — uses `pull_request` not `schedule`):

```yaml
on:
  pull_request:
    paths:
      - 'scripts/forecast/**'

permissions:
  contents: read   # PR-only — no commit (different from forecast-backtest.yml!)

concurrency:
  group: forecast-quality-gate-${{ github.ref }}
  cancel-in-progress: true   # opposite of forecast-backtest.yml — superseded PR runs cancel
```

**Conventions to preserve:**
- `cancel-in-progress: true` here (opposite of forecast-backtest.yml `false`) — superseded PR commits should kill the prior run.
- `permissions: contents: read` — PR gate never commits (different from forecast-backtest.yml).
- `timeout-minutes: 5` — BCK-06 hard cap.
- `pip install supabase python-dotenv` — NOT `requirements.txt` — read-only check needs no cmdstan/numpy/pandas (faster install, fits 5min budget).

---

### `docs/forecast/ACCURACY-LOG.md` (NEW — append-only doc, file-I/O)

**Analog:** `.planning/learnings/16.2-prophet-past-projection-path-b.md` — closest in tone (long-form Markdown with date headers + sections).

**Header pattern** — copy structural shape from `.planning/learnings/16.2-prophet-past-projection-path-b.md:1-6`:

```markdown
# Prophet past-projection — Path B revert (16.2 Risk 2 contingency)

**Date:** 2026-05-05
**Phase:** 16.2 (Item 6)
**Source:** Owner persona test 2026-05-05 — `.planning/feedback/16.1-friend-2026-05-05/HANDOFF.md` Item 6 + screenshot ...
```

**Initial commit (skeleton)** — write the first version with empty "Latest run" / empty "History" sections; first cron run fills in real data:

```markdown
# Forecast Accuracy Log

Auto-generated weekly by `.github/workflows/forecast-backtest.yml` (Tuesday 23:00 UTC).
Do not edit by hand — the next cron run will overwrite manual edits.

**Production model:** naive_dow_with_holidays

---

## Latest run: (pending first cron)

> Phase 17 just deployed. First weekly backtest runs Tuesday 23:00 UTC after deploy.

---

## History

(empty until first weekly run)
```

**Honest-failure copy templates** — see RESEARCH §ACCURACY-LOG.md Format (4 fixed templates).

**Conventions to preserve:**
- Top-of-file frontmatter-like block (no actual YAML frontmatter — just bold key/value text per Markdown convention used in `.planning/learnings/`).
- Latest-week entry inserted ABOVE the `## History` line (append-only at the top of history, not bottom — per BCK-07).
- The exact string `naive-DoW-with-holidays remains production model — no challenger promoted this week.` (em-dash + lowercase 'no challenger') from CONTEXT specifics.

---

### `supabase/migrations/00XX_phase17_backtest_schema.sql` (NEW — migration)

**Three changes in one migration** (RESEARCH §Schema Impact). Build from three concatenated patterns.

#### Part 1 — `forecast_quality` ALTER TABLE

**Analog:** `supabase/migrations/0051_forecast_quality.sql` (table definition we extend).

```sql
-- supabase/migrations/0051_forecast_quality.sql:1-20 [VERIFIED]
CREATE TABLE public.forecast_quality (
    restaurant_id     uuid NOT NULL REFERENCES public.restaurants(id),
    kpi_name          text NOT NULL,
    model_name        text NOT NULL,
    horizon_days      integer NOT NULL DEFAULT 1,
    evaluation_window text NOT NULL DEFAULT 'last_7_days',
    evaluated_at      timestamptz NOT NULL DEFAULT now(),
    -- ...
    PRIMARY KEY (restaurant_id, kpi_name, model_name, horizon_days, evaluation_window, evaluated_at)
);
```

**Phase 17 ALTER** (do NOT extend PK — just add nullable diagnostic columns):

```sql
ALTER TABLE public.forecast_quality
  ADD COLUMN IF NOT EXISTS fold_index integer,
  ADD COLUMN IF NOT EXISTS train_end_date date,
  ADD COLUMN IF NOT EXISTS eval_start_date date,
  ADD COLUMN IF NOT EXISTS gate_verdict text
    CHECK (gate_verdict IN ('PASS', 'FAIL', 'PENDING', 'UNCALIBRATED') OR gate_verdict IS NULL);
COMMENT ON COLUMN public.forecast_quality.fold_index IS
  'Phase 17 BCK-01: 0..3 for rolling_origin_cv rows; NULL for last_7_days rows.';
```

#### Part 2 — `feature_flags` per-model seed

**Analog:** `supabase/migrations/0061_feature_flags.sql:53-57` (existing seed pattern).

```sql
-- supabase/migrations/0061_feature_flags.sql:53-57 [VERIFIED]
INSERT INTO public.feature_flags (restaurant_id, flag_key, enabled, remind_on_or_after_date, description)
SELECT r.id, 'offweek_reminder', false, '2026-10-15'::date,
       'Fire on or after 2026-10-15 to re-anchor the counterfactual via a planned off-week.'
FROM public.restaurants r
ON CONFLICT (restaurant_id, flag_key) DO NOTHING;
```

**Phase 17 adaptation — CROSS JOIN seed of 6 model rows:**

```sql
INSERT INTO public.feature_flags (restaurant_id, flag_key, enabled, description)
SELECT r.id, m.flag_key, true, m.description
FROM public.restaurants r
CROSS JOIN (VALUES
  ('model_sarimax',                'Phase 17 BCK-04: SARIMAX gated by rolling-origin CV at h=7/35/120/365.'),
  ('model_prophet',                'Phase 17 BCK-04: Prophet gated by rolling-origin CV at h=7/35/120/365.'),
  ('model_ets',                    'Phase 17 BCK-04: ETS gated by rolling-origin CV at h=7/35/120/365.'),
  ('model_theta',                  'Phase 17 BCK-04: Theta gated by rolling-origin CV at h=7/35/120/365.'),
  ('model_naive_dow',              'Phase 17 BCK-04: naive_dow baseline (always-on; gate compares challengers against THIS).'),
  ('model_naive_dow_with_holidays','Phase 17 BCK-03: regressor-aware naive baseline.')
) m(flag_key, description)
ON CONFLICT (restaurant_id, flag_key) DO NOTHING;
```

#### Part 3 — `data_freshness_v` UNION extension

**Analog:** `supabase/migrations/0014_data_freshness_v.sql` (full file, 18 lines).

```sql
-- supabase/migrations/0014_data_freshness_v.sql:1-18 [VERIFIED]
CREATE OR REPLACE VIEW public.data_freshness_v
WITH (security_invoker = true) AS
SELECT
  t.restaurant_id,
  MAX(t.created_at) AS last_ingested_at
FROM public.transactions t
WHERE t.restaurant_id::text = (auth.jwt() ->> 'restaurant_id')
GROUP BY t.restaurant_id;

GRANT SELECT ON public.data_freshness_v TO authenticated;
```

**Phase 17 replacement** — `DROP VIEW + CREATE VIEW` with UNION (preserves single-column-shape contract per Option A; full SQL in RESEARCH §Codebase Reuse Map deliverable 8 lines 285-317).

**Conventions to preserve:**
- `WITH (security_invoker = true)` — KEEP. Without this the view runs under owner role and bypasses RLS.
- `GRANT SELECT ON public.data_freshness_v TO authenticated;` — KEEP. View consumers are SSR-load-functions which run with `authenticated` role.
- Outer aggregate is `MIN(stage_last)` — stalest stage drives the badge (RESEARCH §Codebase Reuse Map deliverable 8 subtle correctness note).
- Migration filename: next sequential `00XX_phase17_backtest_schema.sql` — check `supabase/migrations/` highest existing number first (currently `0066`, so likely `0067_phase17_backtest_schema.sql`).
- One migration file for all three changes (RESEARCH §Schema Impact recommendation) — keeps the rollback story atomic.

---

### `scripts/forecast/tests/test_backtest.py` (NEW — pytest)

**Analog:** `scripts/forecast/tests/test_eval.py` (pure-function shape) + `tests/test_run_all_grain_loop.py` (mocked-supabase pattern).

**Pure-function test shape** — copy `test_eval.py:7-13`:

```python
# scripts/forecast/tests/test_eval.py:7-13 [VERIFIED]
def test_rmse_known_values():
    actuals = np.array([100.0, 200.0, 300.0])
    yhats = np.array([110.0, 190.0, 310.0])
    metrics = compute_metrics(actuals, yhats)
    expected_rmse = math.sqrt(((10**2 + 10**2 + 10**2) / 3))
    assert abs(metrics['rmse'] - expected_rmse) < 0.01
```

**Mocked supabase shape** — copy `test_run_all_grain_loop.py:21-32`:

```python
# scripts/forecast/tests/test_run_all_grain_loop.py:21-32 [VERIFIED]
if 'supabase' not in sys.modules:
    _supabase_stub = types.ModuleType('supabase')
    _supabase_stub.create_client = lambda *a, **kw: None
    _supabase_stub.Client = type('Client', (), {})
    sys.modules['supabase'] = _supabase_stub
```

**Conftest fixture reuse** — `scripts/forecast/tests/conftest.py:7-19` provides `synthetic_revenue` (90-day series with weekly seasonality). Reuse in cold-start guard tests (need <8d slice for PENDING; ≥35d for h=7 PASS).

**Conventions to preserve:**
- `from __future__ import annotations` not strictly needed in tests (existing tests omit it)
- `numpy as np`, not `from numpy import ...`
- Assertion tolerance `< 0.01` for floats (test_eval pattern)
- One test function per behavior (no `parametrize` fan-out in existing tests)

---

### `scripts/forecast/tests/test_naive_dow_with_holidays.py` (NEW — pytest)

**Analog:** `scripts/forecast/tests/test_eval.py` (pure-function tests).

**Same conventions as `test_backtest.py`**. Test the holiday-multiplier helper (`_compute_holiday_multipliers`) with synthetic 4-flag-combo fixtures.

---

### `scripts/forecast/tests/test_conformal.py` (NEW — pytest)

**Analog:** `scripts/forecast/tests/test_eval.py:7-13` (numpy-quantile assertion).

**Test pattern** — replicate `test_eval.py:7-13` shape with conformal quantile math:

```python
def test_qhat_h35_known_residuals():
    fold_residuals = {
        0: np.array([10.0, -10.0]),
        1: np.array([5.0, -5.0]),
        2: np.array([20.0, -20.0]),
        3: np.array([15.0, -15.0]),
    }
    out = calibrate_conformal_h35(fold_residuals, alpha=0.05)
    expected_qhat = float(np.quantile(np.abs([10, 10, 5, 5, 20, 20, 15, 15]), 0.95))
    assert abs(out['qhat_h35'] - expected_qhat) < 1e-6
```

---

### `scripts/forecast/tests/test_gate.py` (NEW — pytest)

**Analog:** `scripts/forecast/tests/test_run_all_grain_loop.py:43-80` (mocked supabase + `MagicMock` table router).

**Mock-table router pattern** — copy structural shape from `test_run_all_grain_loop.py:43-80`:

```python
# scripts/forecast/tests/test_run_all_grain_loop.py:43-80 [VERIFIED]
def _build_mock_client(*, last_actual_iso: str):
    client = MagicMock(name='supabase_client')
    weather_chain = MagicMock()
    weather_chain.select.return_value = weather_chain
    weather_chain.limit.return_value = weather_chain
    weather_chain.execute.return_value = _make_table_response(count=1)
    # ...
    def table_router(name):
        if name == 'weather_daily': return weather_chain
        # ...
```

**Adapt for `feature_flags` table** — assert that `client.table('feature_flags').update({...}).eq(...).execute()` was called for the FAIL model and NOT called for `naive_dow` baseline.

**Conventions to preserve:**
- Same `_make_table_response` helper signature (`count`, `data` kwargs).
- `MagicMock(name='supabase_client')` — name aids debugging.
- Stub `supabase` module at top of file (test_run_all_grain_loop.py:21-32) — required because `make_client` imports `supabase` transitively.

---

### `scripts/forecast/tests/test_quality_gate_check.py`, `test_accuracy_log.py`, `test_data_freshness_v.py`, `test_run_all_feature_flags.py` (NEW — pytest)

Same mocked-supabase pattern as `test_gate.py`.

`test_data_freshness_v.py` is the **only** test that should hit a live DB (per CLAUDE.md DEV-first); structure with `pytest.mark.integration` marker if available, else gate behind `SUPABASE_URL` env presence.

`test_workflow_yaml.py` — parses the YAML files with PyYAML and asserts: `cron == '0 23 * * 2'`, `permissions.contents == 'write'` for backtest, `permissions.contents == 'read'` for quality-gate, `concurrency.cancel-in-progress` matches per-workflow expectation.

---

### `src/lib/components/ModelAvailabilityDisclosure.test.ts` (NEW — Vitest + Testing Library)

**Analog:** `src/lib/components/InsightCard.test.ts` (full file, ~80 lines — direct match for component test shape).

**Locale pin pattern** — copy `InsightCard.test.ts:7-12` (NON-NEGOTIABLE):

```typescript
// src/lib/components/InsightCard.test.ts:7-12 [VERIFIED]
// Pin the test locale to 'en' so the EN assertions below match what
// InsightCard.svelte renders. Without this, page.data.locale resolves to
// DEFAULT_LOCALE ('ja' per src/lib/i18n/locales.ts) ...
vi.mock("$app/state", () => ({
  page: { data: { locale: "en" } },
}));
```

**Render + container.querySelector pattern** — copy `InsightCard.test.ts:30-40`:

```typescript
// src/lib/components/InsightCard.test.ts:30-40 [VERIFIED]
it("renders headline and body in normal mode", () => {
    const { container } = render(InsightCard, { insight: baseInsight });
    expect(container.querySelector("h2")?.textContent).toContain("Past 7 days €1842 ▼ 12%");
    expect(container.querySelector("p")?.textContent).toContain("Four-week rolling total");
});
```

**Adapt for ModelAvailabilityDisclosure**:

```typescript
import ModelAvailabilityDisclosure from "$lib/components/ModelAvailabilityDisclosure.svelte";

it("renders 4 horizon pills per model when backtest data present", () => {
    const { container } = render(ModelAvailabilityDisclosure, {
        availableModels: ['sarimax', 'naive_dow'],
        grain: 'day',
        backtestStatus: {
            sarimax:   { h7: 'PASS', h35: 'FAIL', h120: 'PENDING', h365: 'PENDING' },
            naive_dow: { h7: 'PASS', h35: 'PASS', h120: 'PENDING', h365: 'PENDING' },
        },
    });
    const pills = container.querySelectorAll('[data-testid^="backtest-pill-"]');
    expect(pills.length).toBe(8); // 2 models × 4 horizons
});
```

**Conventions to preserve:**
- `// @vitest-environment jsdom` first line (test_eval.py equivalent for frontend)
- `vi.mock("$app/state", ...)` BEFORE the component import (load order matters)
- `data-testid` attributes for pills (matches `data-testid="freshness-label"` on FreshnessLabel and `data-testid="model-avail-trigger"` on existing component line 85).

---

### `scripts/forecast/sarimax_fit.py` (MODIFY — add argparse to `__main__`)

**Analog:** existing `__main__` block at the bottom of each `*_fit.py` (env-var-only).

**Current pattern** — copy from `sarimax_fit.py:426-445`:

```python
# scripts/forecast/sarimax_fit.py:426-445 [VERIFIED]
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
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)

    run_date = date.fromisoformat(run_date_str)
    started_at = datetime.now(timezone.utc)
    client = make_client()

    try:
        n = fit_and_write(
            client,
            restaurant_id=restaurant_id,
            kpi_name=kpi_name,
            run_date=run_date,
            granularity=granularity,
        )
        # ...
```

**Phase 17 retrofit** — add argparse BEFORE the env-var reads, parse `--train-end` / `--eval-start` / `--fold-index`, then thread into the `fit_and_write` call:

```python
if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Phase 14/17 sarimax fit')
    parser.add_argument('--train-end', type=str, default=None,
        help='YYYY-MM-DD. Override default train_end_for_grain. Used by backtest.py per fold.')
    parser.add_argument('--eval-start', type=str, default=None,
        help='YYYY-MM-DD. First date of evaluation window (recorded only).')
    parser.add_argument('--fold-index', type=int, default=None,
        help='0-indexed fold number. Optional.')
    args = parser.parse_args()

    # Existing env-var reads (UNCHANGED — argparse is additive)
    restaurant_id = os.environ.get('RESTAURANT_ID', '').strip()
    # ... (existing block intact) ...

    train_end_override = date.fromisoformat(args.train_end) if args.train_end else None

    n = fit_and_write(
        client,
        restaurant_id=restaurant_id,
        kpi_name=kpi_name,
        run_date=run_date,
        granularity=granularity,
        train_end=train_end_override,  # already accepted by fit_and_write per A3
    )
```

**Conventions to preserve:**
- argparse runs FIRST (before env-var reads) so `--help` still works without all env vars set.
- argparse value overrides default `train_end_for_grain(...)` only when explicitly passed (R3 mitigation).
- Apply identically to `prophet_fit.py:NNN`, `ets_fit.py:NNN`, `theta_fit.py:466+`, `naive_dow_fit.py:498-545`.
- DO NOT add positional args (no positional args exist today — verified per RESEARCH §Subprocess Fold-Driver Design).
- Verify `fit_and_write` already accepts `train_end: Optional[date]=None` — verified for sarimax (line 265), theta (line 306), ets (line 314), naive_dow (assumption A3 — verify in Plan).

---

### `scripts/forecast/run_all.py` (MODIFY — add `_get_enabled_models` query)

**Analog:** `scripts/forecast/run_all.py:51-57` (existing `_get_restaurant_id` — same single-table read shape).

**Existing helper pattern** — copy from `run_all.py:51-57`:

```python
# scripts/forecast/run_all.py:51-57 [VERIFIED]
def _get_restaurant_id(client) -> str:
    """Fetch the first restaurant_id from the restaurants table."""
    resp = client.table('restaurants').select('id').limit(1).execute()
    rows = resp.data or []
    if not rows:
        raise RuntimeError('No restaurants found in the restaurants table')
    return rows[0]['id']
```

**NEW sister function** (insert directly below):

```python
def _get_enabled_models(client, restaurant_id: str) -> list[str]:
    """Phase 17 D-04: read enabled-model rows from feature_flags.

    Bulk single query (per RESEARCH §Codebase Reuse Map deliverable 6 recommendation).
    Returns list of bare model names (without 'model_' prefix), e.g. ['sarimax', 'naive_dow'].
    """
    resp = (
        client.table('feature_flags')
        .select('flag_key,enabled')
        .eq('restaurant_id', restaurant_id)
        .like('flag_key', 'model_%')
        .execute()
    )
    return [
        row['flag_key'].removeprefix('model_')
        for row in (resp.data or [])
        if row.get('enabled') is True
    ]
```

**Call-site change** — replace the env-var-only resolution at `run_all.py:228-230`:

```python
# scripts/forecast/run_all.py:228-230 [VERIFIED — current state]
if not models:
    env_models = os.environ.get('FORECAST_ENABLED_MODELS', DEFAULT_MODELS)
    models = [m.strip() for m in env_models.split(',') if m.strip()]
```

**Phase 17 replacement — AND-intersect with feature_flags** (per Open Question #3 recommendation):

```python
if not models:
    env_models = os.environ.get('FORECAST_ENABLED_MODELS', DEFAULT_MODELS)
    env_set = {m.strip() for m in env_models.split(',') if m.strip()}
    db_set = set(_get_enabled_models(client, restaurant_id))
    models = sorted(env_set & db_set)  # AND-intersect — both must agree
    if not models:
        print('[run_all] WARN: env_set ∩ feature_flags is empty — no models will run', file=sys.stderr)
```

**Conventions to preserve:**
- `_get_enabled_models` uses **bulk single query** (one DB round-trip), not lazy-per-model (RESEARCH §Codebase Reuse Map deliverable 6 explicit recommendation).
- AND-intersect (Open Question #3 recommendation) — preserves operator escape-hatch via env var, lets gate veto via DB.
- Print a WARN to stderr if intersect is empty (avoid silent skip of all models).

---

### `src/lib/components/ModelAvailabilityDisclosure.svelte` (MODIFY — add backtest column)

**Analog:** itself — current `<tr>` block at lines 115-138.

**Current `<tr>` block** — copy from `ModelAvailabilityDisclosure.svelte:115-138`:

```svelte
<!-- src/lib/components/ModelAvailabilityDisclosure.svelte:115-138 [VERIFIED] -->
{#each MODELS as info (info.key)}
  {@const available = availableModels.includes(info.key)}
  {@const minVal = minForGrain(info)}
  <tr>
    <td class="py-0.5 align-top">
      <span class="inline-flex items-center gap-1.5">
        <span class="inline-block h-2 w-2 rounded-full {available ? '' : 'opacity-30'}"
              style:background-color={FORECAST_MODEL_COLORS[info.key]}></span>
        <span>{t(page.data.locale, `legend_model_${info.key}` as MessageKey)}</span>
      </span>
    </td>
    <td class="py-0.5 align-top {available ? 'text-emerald-700' : 'text-zinc-500'}">
      {t(page.data.locale, statusKey(info, available))}
    </td>
    <td class="py-0.5 pr-4 align-top text-right tabular-nums whitespace-nowrap">
      {minVal === null ? '—' : `${minVal} ${unitLabel}`}
    </td>
    <td class="py-0.5 pl-2 align-top text-zinc-500">
      {t(page.data.locale, `model_avail_why_${info.key}` as MessageKey)}
    </td>
  </tr>
{/each}
```

**Phase 17 extension** — add a 5th `<td>` with 4 horizon pills (RESEARCH §ModelAvailabilityDisclosure.svelte Extension):

```svelte
<!-- NEW 5th column — 4-cell horizon strip, each colored by verdict -->
<td class="py-0.5 align-top">
  <div class="flex gap-1 text-[10px]">
    {#each ['h7','h35','h120','h365'] as h}
      {@const status = backtestStatus?.[info.key]?.[h]}
      <span
        class="rounded px-1.5 py-0.5 {verdictColorClass(status)}"
        data-testid="backtest-pill-{info.key}-{h}"
      >
        {h.replace('h', '')}d: {verdictShort(status)}
      </span>
    {/each}
  </div>
</td>
```

**Required changes elsewhere in the same file:**
- Add `backtestStatus` prop to `$props()` block (lines 20-26):
  ```typescript
  let { availableModels, grain, backtestStatus = null }: {
      availableModels: readonly string[];
      grain: 'day' | 'week' | 'month';
      backtestStatus?: { [key: string]: { h7?: 'PASS'|'FAIL'|'PENDING'|'UNCALIBRATED'|null; h35?: ...; h120?: ...; h365?: ...; } } | null;
  } = $props();
  ```
- Update `min-w-[640px]` to `min-w-[840px]` on line 105 (RESEARCH §ModelAvailabilityDisclosure.svelte Extension layout note).
- Add 4 i18n keys: `model_avail_backtest_pass`, `_fail`, `_pending`, `_uncalibrated` (matches Phase 16.1-02 i18n scaffold pattern).
- Add a `<th>` for the new column in the thead (line 107-112 block).

**Conventions to preserve:**
- Svelte 5 runes (`$props()`, `$state()`, `$derived`) — no Svelte 4 syntax.
- `t(page.data.locale, key)` for ALL user-visible text (i18n discipline; matches lines 87, 97, 108-111).
- `data-testid` on each pill for the new Vitest test.
- `tabular-nums` not needed for pill cells (variable-width OK; no number alignment).
- Keep `{#each ... as info (info.key)}` keyed-each for stable reordering.
- `availableModels` defaults to `[]`; `backtestStatus` defaults to `null` — both render gracefully when missing (cold-start case).

---

## Shared Patterns

### Pattern A — Service-role DB client factory

**Source:** `scripts/forecast/db.py:7-15`
**Apply to:** `backtest.py`, `naive_dow_with_holidays.py`, `quality_gate_check.py`, `write_accuracy_log.py`, all new tests' fixtures

```python
# scripts/forecast/db.py:7-15 [VERIFIED]
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

**Apply by:** `from scripts.forecast.db import make_client; client = make_client()` once per script entry point. Never per-fold or per-loop iteration.

### Pattern B — Pipeline-runs writer (success/failure)

**Source:** `scripts/forecast/run_all.py:32, 194-225` (imports + write_failure call sites)
**Apply to:** `backtest.py` (write `forecast_backtest` step rows), `naive_dow_with_holidays.py` (write `forecast_naive_dow_with_holidays` rows)

```python
# scripts/forecast/run_all.py:32, 194-225 [VERIFIED]
from scripts.external.pipeline_runs_writer import write_failure  # already imported in run_all.py

# Usage at error / success points:
write_failure(
    client,
    step_name=STEP_NAME,
    started_at=datetime.now(timezone.utc),
    error_msg=msg,
    restaurant_id=restaurant_id,
)
# OR write_success with row_count=n
```

**STEP_NAME convention** (from existing scripts):
- `backtest.py` → `STEP_NAME = 'forecast_backtest'`
- `naive_dow_with_holidays.py` → `STEP_NAME = 'forecast_naive_dow_with_holidays'`
- These names must be added to `data_freshness_v` UNION's `step_name IN (...)` filter (see deliverable 8 SQL block in RESEARCH).

### Pattern C — RLS + service-role table grants

**Source:** `supabase/migrations/0061_feature_flags.sql:43-48` + `0051_forecast_quality.sql:17-20`
**Apply to:** any new table (none in Phase 17, but if future migration adds one)

```sql
-- supabase/migrations/0061_feature_flags.sql:43-48 [VERIFIED]
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY feature_flags_select ON public.feature_flags
    FOR SELECT USING (restaurant_id = (auth.jwt()->>'restaurant_id')::uuid);
REVOKE INSERT, UPDATE, DELETE ON public.feature_flags FROM authenticated, anon;
GRANT SELECT ON public.feature_flags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_flags TO service_role;
```

Phase 17 does not add new tables; the migration only ALTERs `forecast_quality`, seeds `feature_flags`, and replaces `data_freshness_v`. RLS on the existing tables is unchanged. New `gate_verdict` column inherits `forecast_quality`'s existing RLS policy (SELECT only for authenticated).

### Pattern D — `[script_name] ...` log prefix

**Source:** Every Python script in `scripts/forecast/` (e.g., `run_all.py:130, 137, 141`, `naive_dow_fit.py:456, 531, 535`).
**Apply to:** `backtest.py`, `naive_dow_with_holidays.py`, `quality_gate_check.py`, `write_accuracy_log.py`

```python
print(f'[backtest] Spawning fold {fold_idx}/{N_FOLDS} for {model}/{kpi}/h={horizon}')
print(f'[naive_dow_with_holidays] Done: {n} rows written for {kpi_name}/{granularity}')
```

Stderr for failures, stdout for progress. Keeps GHA logs greppable per-script.

### Pattern E — argparse retrofit on existing fit scripts

**Source:** Phase 17 NEW pattern (existing scripts have NO argparse — env-var-only)
**Apply to:** `sarimax_fit.py`, `prophet_fit.py`, `ets_fit.py`, `theta_fit.py`, `naive_dow_fit.py` (5 files), AND `naive_dow_with_holidays.py` (which inherits this from naive_dow_fit's copy-and-adapt)

See "`scripts/forecast/sarimax_fit.py` (MODIFY)" section above for full template. Apply identically to all 5 fit scripts. The argparse block goes ABOVE the existing env-var reads.

### Pattern F — Concurrency group naming

**Source:** `forecast-refresh.yml:14-17` and `external-data-refresh.yml:20-24`
**Apply to:** both new GHA workflows

```yaml
concurrency:
  group: forecast-backtest      # singleton across cron + dispatch
  cancel-in-progress: false     # do NOT kill in-progress runs
```

```yaml
concurrency:
  group: forecast-quality-gate-${{ github.ref }}    # per-PR-ref
  cancel-in-progress: true      # kill superseded PR commits
```

**Decision rule:** cron + dispatch workflows use `cancel-in-progress: false`; PR workflows use `true`.

### Pattern G — Inputs-via-env shell-injection mitigation

**Source:** `forecast-refresh.yml:48-62` + `external-data-refresh.yml:48-65` (REVIEW C-1/MS-1 comments)
**Apply to:** `forecast-backtest.yml` MODELS input

```yaml
# forecast-refresh.yml:48-62 [VERIFIED]
env:
  MODELS: ${{ inputs.models }}        # via env, not direct ${{ }} in shell
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
```

Always use this validate-before-forward shape for `workflow_dispatch` inputs that flow into shell commands.

---

## No Analog Found

Files with no close in-repo analog (planner should use RESEARCH.md patterns + textbook references):

| File | Role | Data Flow | Reason | Fallback Source |
|---|---|---|---|---|
| `scripts/forecast/conformal.py` quantile math | pure-helper | transform | No prior conformal/quantile code in repo | RESEARCH §ConformalIntervals Integration Option 1 + textbook Vovk/Shafer split-conformal |
| `docs/forecast/ACCURACY-LOG.md` auto-generation logic | docs | file-I/O | No auto-committed Markdown log exists in this repo | RESEARCH §ACCURACY-LOG.md Format provides the exact templates |
| `forecast-backtest.yml` commit-back step | GHA shell | event-driven | No GHA workflow in this repo currently writes back to the repo | github-actions[bot] convention from GitHub docs (cited in RESEARCH §R9 sources) |
| `tests/test_workflow_yaml.py` YAML parsing | pytest | transform | No existing test parses GHA YAML | PyYAML standard library; assertions per RESEARCH §Phase Requirements → Test Map |

---

## Pre-Plan Verification Checklist

Before the planner writes PLAN.md tasks, verify these open assumptions (RESEARCH Assumptions Log):

- [ ] **A1** — `forecast_daily` PK shape: `grep "PRIMARY KEY" supabase/migrations/0050_forecast_daily.sql` to confirm whether `forecast_track` is in PK. If yes, RESEARCH §R1 option (a) is open; if no, option (b) "in-memory yhats only" is the default (recommended).
- [ ] **A2** — `forecast_daily` CHECK constraint on `model_name`: `grep "CHECK.*model_name" supabase/migrations/0050_forecast_daily.sql` — if present, the migration must add `'naive_dow_with_holidays'` to the allowed values.
- [ ] **A3** — `fit_and_write` accepts `train_end` kwarg: verified for sarimax (line 265), theta (306), ets (314), naive_dow (Read confirmed the import + signature). Verify `prophet_fit.py` matches.
- [ ] **A4** — `pipeline_runs.step_name` literals: confirmed `'forecast_naive_dow'`, `'forecast_sarimax'`, `'forecast_run_all'`, etc. Add `'forecast_backtest'` and `'forecast_naive_dow_with_holidays'` to the `data_freshness_v` UNION's IN-list.
- [ ] **Migration number**: latest is `0066`; next is `0067_phase17_backtest_schema.sql`.
- [ ] **i18n placeholders**: 4 new MessageKeys added to `src/lib/i18n/messages.ts` (or wherever the type lives) per Phase 16.1-02 placeholder convention (en + ja real, de/es/fr placeholder).

---

## Metadata

**Analog search scope:**
- `scripts/forecast/` — all `.py` files (read run_all, last_7_eval, db, sarimax_fit, naive_dow_fit, exog, cumulative_uplift)
- `scripts/forecast/tests/` — read test_eval, conftest, test_run_all_grain_loop
- `.github/workflows/` — read forecast-refresh, its-validity-audit, external-data-refresh
- `supabase/migrations/` — read 0014, 0051, 0061
- `src/lib/components/` — read ModelAvailabilityDisclosure, FreshnessLabel, InsightCard.test.ts
- `src/routes/+page.server.ts` — grepped data_freshness_v consumer
- `.planning/learnings/` — read 16.2-prophet-past-projection-path-b.md

**Files scanned:** 22 source files read in full or in targeted ranges; 6 directory listings; 4 grep queries.

**Pattern extraction date:** 2026-05-06

## PATTERN MAPPING COMPLETE
