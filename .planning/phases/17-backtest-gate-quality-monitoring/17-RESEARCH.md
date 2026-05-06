# Phase 17: Backtest Gate & Quality Monitoring — Research

**Researched:** 2026-05-06
**Domain:** Time-series forecast model evaluation, rolling-origin cross-validation, conformal prediction, GHA workflow design, Supabase schema extension
**Confidence:** HIGH (codebase reuse map + GHA pattern); MEDIUM (statsforecast 1.7 ConformalIntervals manual-residual usage — official docs only show StatsForecast-driver path)

## Summary

Phase 17 adds **8 deliverables** that bolt a **weekly rolling-origin CV gate** onto the existing Phase 14 forecast pipeline. Every claim below was verified against the actual codebase at `/Users/shiniguchi/development/ramen-bones-analytics/`. Phase 17 is largely **plumbing** — the math (`compute_metrics`, sample-path generation, RMSE/MAPE) already exists in `last_7_eval.py` and the model `fit_and_write` functions already accept `train_end: Optional[date]` kwargs. What is genuinely new: (1) a fold-driver script, (2) a holiday-aware naive companion, (3) two GHA workflows, (4) per-model `feature_flags` rows + a gate writer, (5) ACCURACY-LOG.md, (6) a per-horizon status row in `ModelAvailabilityDisclosure.svelte`, (7) a UNION branch to `data_freshness_v`.

**Primary recommendation:** Add a single shared `--train-end` / `--eval-start` CLI surface to all 5 `*_fit.py` scripts (currently env-var-only) so `backtest.py` can subprocess them per fold. Use `ConformalIntervals(h=35, n_windows=4)` only inside the calibration step on h=35 fold residuals — NOT as the loop driver (D-03 locked). Mirror `forecast-refresh.yml`'s least-privilege shape, override only the `permissions: contents: write` on `forecast-backtest.yml`. Use append-only Markdown for ACCURACY-LOG with a YAML-fenced metadata block per run for diff-friendly history.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Rolling-origin CV loop | Python script (`scripts/forecast/backtest.py`) | — | Owns subprocess spawning, fold cutoffs, residual collection |
| Per-fold model fit | Python subprocess (existing `*_fit.py`) | — | Same pattern as `run_all.py`; fold = 1 subprocess call |
| Conformal CI calibration | Python (inside `backtest.py`) | — | Pure math; runs after fold loop completes |
| Promotion-gate decision | Python (in `backtest.py` after metrics gathered) | DB writer (`feature_flags.enabled` UPDATE) | Decision = pure compare; persistence = DB write |
| Per-model enabled flag | Database (`feature_flags` table) | Python read in `run_all.py` | Tenant-scoped row; reads at orchestrator startup |
| Weekly cron + commit | GHA workflow (`forecast-backtest.yml`) | Python script | Cron schedules; Python computes; bash commits |
| PR gate | GHA workflow (`forecast-quality-gate.yml`) | DB read | CI step queries forecast_quality + feature_flags |
| Quality badge | Frontend (`ModelAvailabilityDisclosure.svelte`) | API/SSR (existing payload) | Reads same `forecast_quality` rows the GHA writes |
| Cascade staleness | DB view (`data_freshness_v`) | Frontend (`FreshnessLabel.svelte` already auto-surfaces) | View change is invisible to the SSR loader |
| ACCURACY-LOG | Repo file (`docs/forecast/ACCURACY-LOG.md`) | GHA commit step | Public, append-only, no DB query needed at read time |

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Manual rolling-origin loop — `backtest.py` calls each `*_fit.py` script as a subprocess per fold with `--train-end` / `--eval-start` flags. **NO** adapter wrappers. Matches existing `run_all.py` subprocess pattern.
- **D-02:** 4 folds per horizon. Aligns with `ConformalIntervals(n_windows=4)`. Long horizons (120d, 365d) PENDING until sufficient depth.
- **D-03:** `statsforecast.cross_validation` is **NOT** used as loop driver. `ConformalIntervals` from statsforecast IS used for CI calibration at h=35 after folds.
- **D-04:** Per-model `feature_flags` rows seeded with 5 rows (`model_sarimax`, `model_prophet`, `model_ets`, `model_theta`, `model_naive_dow`) at `enabled=true` on deploy. `backtest.py` flips failures to `enabled=false`. `run_all.py` reads at startup.
- **D-05:** New `naive_dow_with_holidays.py` (does **NOT** modify existing `naive_dow_fit.py`). Same regressors as competing models.
- **D-06:** Initial `enabled=true` for all 5 models on Phase 17 deploy — no forecast outage. Gate first runs Tuesday 23:00 UTC; may flip flags then.
- **D-07:** ACCURACY-LOG committed via `GITHUB_TOKEN` with `permissions: contents: write`. **No PAT.** Main branch protection does not block `github-actions[bot]` pushes.
- **D-08:** ACCURACY-LOG append-only — latest week summary at top, history grows below. Verdicts: PASS / FAIL / PENDING / UNCALIBRATED.
- **D-09:** Extend existing `ModelAvailabilityDisclosure.svelte` (no new component, no new slots).
- **D-10:** Extend existing `data_freshness_v` view (no new SSR subrequest).

### Claude's Discretion

- Exact CLI flag names for `--train-end` / `--eval-start` per `*_fit.py` (planner reads existing parsers and adds where missing — see §Subprocess Fold-Driver Design).
- DB column additions to `forecast_quality` for rolling_origin_cv rows — research below confirms **migration NEEDED** for `fold_index`, `train_end_date`, `eval_start_date` to disambiguate fold rows under the existing PK.
- `run_all.py` feature_flags read pattern — **bulk single query** recommended below.
- `data_freshness_v` extension approach — **UNION branch** recommended below (preserves single-call SSR contract D-10).

### Deferred Ideas (OUT OF SCOPE)

- **Sunday zeros hotfix** (`closed_days.py` Sunday mask). Backtest's relative RMSE comparison stays valid even with Sunday zeros — all models equally wrong. Fix belongs in a standalone pipeline patch before first weekly cron run.
- **Conformal CI rendering in Calendar* charts.** Phase 17 writes calibrated CI bounds to DB; chart rendering is Phase 18+.
- **Phase 18+ quality dashboard** beyond ModelAvailabilityDisclosure rows.

## Phase Requirements

| ID | Description (from REQUIREMENTS.md) | Research Support |
|---|---|---|
| BCK-01 | `backtest.py` runs rolling-origin folds at 4 horizons (7d/35d/120d/365d), RMSE+MAPE per (model × horizon × fold) | §Subprocess Fold-Driver Design + §Codebase Reuse Map deliverable 1 |
| BCK-02 | `ConformalIntervals(h=35, n_windows=4)` calibrates 95% CIs at h≥35; UI badges PENDING <day-8, UNCALIBRATED <2y | §ConformalIntervals Integration + §ModelAvailabilityDisclosure.svelte Extension |
| BCK-03 | Regressor-aware naive baseline; gate against max(naive_dow_RMSE, naive_dow_with_holidays_RMSE) | §Codebase Reuse Map deliverable 2 + §Gate Algorithm |
| BCK-04 | Per-model `feature_flags`; gate writes `enabled=false` on failure; `run_all.py` reads at startup | §Schema Impact + §Codebase Reuse Map deliverable 6 |
| BCK-05 | `forecast-backtest.yml` weekly Tuesday 23:00 UTC; commits ACCURACY-LOG via GITHUB_TOKEN | §GHA Workflow Templates |
| BCK-06 | `forecast-quality-gate.yml` runs on every forecast-engine PR; <5min on ubuntu-latest | §GHA Workflow Templates |
| BCK-07 | `docs/forecast/ACCURACY-LOG.md` auto-committed weekly with honest-failure language | §ACCURACY-LOG.md Format |
| BCK-08 | Freshness-SLO: `pipeline_runs.upstream_freshness_h > 24` triggers stale badge for any cascade stage | §data_freshness_v Extension |

## Codebase Reuse Map

### Deliverable 1 — `scripts/forecast/backtest.py` (BCK-01/BCK-02/BCK-03)

**Closest existing pattern:** `scripts/forecast/last_7_eval.py` (compute_metrics) + `scripts/forecast/run_all.py` (subprocess pattern).

**Reuse verbatim:**

```python
# Source: scripts/forecast/last_7_eval.py:21-70 [VERIFIED: Read tool]
def compute_metrics(actuals, yhats, is_open=None) -> dict:
    """Returns {rmse, mape, mean_bias, direction_hit_rate}."""
    # backtest.py imports this directly — pure function, no DB
```

**Reuse subprocess shape:**

```python
# Source: scripts/forecast/run_all.py:114-144 [VERIFIED: Read tool]
def _run_model(*, model, restaurant_id, kpi_name, run_date, granularity):
    env = _build_subprocess_env(...)
    cmd = [sys.executable, '-m', f'scripts.forecast.{model}_fit']
    result = subprocess.run(cmd, env=env, text=True, capture_output=True)
    return result.returncode == 0
```

`backtest.py` extends this by adding `train_end` and `eval_start` to `_build_subprocess_env` (or, preferred, as `--train-end` / `--eval-start` CLI flags — see §Subprocess Fold-Driver Design).

**Confidence:** HIGH `[VERIFIED: codebase Read]`

### Deliverable 2 — `scripts/forecast/naive_dow_with_holidays.py` (BCK-03)

**Closest existing pattern:** `scripts/forecast/naive_dow_fit.py` (full file, 547 lines) — copy-and-adapt rather than refactor (D-05 locked: do NOT modify naive_dow_fit.py).

**Reuse:**
- `_seasonal_means_and_residuals` (line 204) — keep as-is
- `_fetch_history` (line 73) — keep as-is
- `bootstrap_from_residuals` from `sample_paths.py` — keep as-is
- `bucket_to_weekly` / `bucket_to_monthly` from `aggregation.py` — keep as-is

**New logic:** Multiplicative holiday adjustment. Apply per-day multipliers from the existing exog matrix (`is_holiday`, `is_school_holiday`, `is_event`, `is_strike` from `scripts/forecast/exog.py:11-14` `EXOG_COLUMNS`):

```python
# Pseudocode for new naive_dow_with_holidays.py forecast step
# 1. Compute base DoW seasonal means as in naive_dow_fit.py
# 2. For each historical date, compute residual_ratio = y / dow_mean
# 3. Group residual_ratios by holiday-flag combination → holiday_multiplier dict
# 4. For each forecast date d: yhat = dow_mean[d.weekday()] * holiday_multiplier[(is_holiday(d), is_school_holiday(d), is_event(d), is_strike(d))]
```

**Regressor source:** `scripts/forecast/exog.py:93` `build_exog_matrix(client, restaurant_id=..., start_date=..., end_date=...)` — already exposes the `is_holiday`/`is_school_holiday`/`is_event`/`is_strike`/`is_open` boolean columns the naive_dow needs `[VERIFIED: Read scripts/forecast/exog.py]`.

**Output:** Writes rows to `forecast_daily` with `model_name='naive_dow_with_holidays'` (NEW value — confirm migration adds it to any existing CHECK constraint; `forecast_daily` schema check during plan-check). Critical pre-Plan check: grep `0050_forecast_daily.sql` for any CHECK constraint on `model_name`.

**Confidence:** HIGH `[VERIFIED: codebase Read]`

### Deliverable 3 — `.github/workflows/forecast-backtest.yml` (BCK-05)

**Closest existing pattern:** `.github/workflows/forecast-refresh.yml` (90 lines).

**Copy verbatim:**
- `actions/checkout@v4` + `actions/setup-python@v5` with `python-version: '3.12'` + `cache: 'pip'` setup
- `cache: cmdstan` step (Prophet needs cmdstan; backtest will run prophet too)
- `concurrency: group: forecast-backtest, cancel-in-progress: false` (prevents 2 weekly crons from racing on the same `forecast_quality` rows or both attempting to commit)
- `secrets.DEV_SUPABASE_URL` / `secrets.DEV_SUPABASE_SERVICE_ROLE_KEY` env scoping per-step (least-privilege pattern from `forecast-refresh.yml:48-50`)

**New for forecast-backtest.yml:**
- `permissions: contents: write` (D-07) — overrides the existing `forecast-refresh.yml:11-12` `contents: read`. Verified main branch is **NOT** protected via `gh api repos/shiniguchi/ramen-bones-analytics/branches/main/protection` returning HTTP 404 "Branch not protected" `[VERIFIED: gh CLI 2026-05-06]` — so `GITHUB_TOKEN` with `contents: write` will succeed without a PAT.
- `schedule: - cron: '0 23 * * 2'` (Tuesday 23:00 UTC, per BCK-05 + CONTEXT specifics)
- Final step: bash commit pattern (full template in §GHA Workflow Templates)

**Confidence:** HIGH `[VERIFIED: forecast-refresh.yml Read + gh API check]`

### Deliverable 4 — `.github/workflows/forecast-quality-gate.yml` (BCK-06)

**Closest existing pattern:** `.github/workflows/forecast-refresh.yml` setup steps + `.github/workflows/its-validity-audit.yml` for the on-PR triggering convention.

**Copy:**
- `actions/checkout@v4` + `actions/setup-python@v5` + `pip install`
- `permissions: contents: read` (PR-only, no commit)
- `on: pull_request: paths: ['scripts/forecast/**']`
- `concurrency: group: forecast-quality-gate-${{ github.ref }}, cancel-in-progress: true` (cancel superseded PR runs)

**New:** A read-only step that runs a Python script (`scripts/forecast/quality_gate_check.py` — new) which: (1) reads latest `forecast_quality` rows where `evaluation_window='rolling_origin_cv'`, (2) joins against `feature_flags` for `enabled=true` models, (3) exits 1 if any enabled model failed the gate at any horizon. Goal: <5min on `ubuntu-latest`.

**Confidence:** HIGH `[VERIFIED: workflow patterns]`

### Deliverable 5 — `docs/forecast/ACCURACY-LOG.md` (BCK-07)

**No existing pattern in this repo.** Closest: `docs/feature-roadmap.md` and `docs/architecture.md` (plain Markdown, no auto-generation).

**New file structure:** §ACCURACY-LOG.md Format below.

**Concurrency safety:** D-07 + concurrency group on `forecast-backtest.yml` (`group: forecast-backtest`) prevents interleaved writes; an in-progress run blocks a manual `workflow_dispatch` trigger. Combined with `cancel-in-progress: false`, a queued second run waits for the first to finish — file is committed atomically per run.

**Confidence:** HIGH `[CITED: GitHub Actions concurrency docs]`

### Deliverable 6 — Per-model `feature_flags` rows + gate writer (BCK-04)

**Closest existing pattern:** `supabase/migrations/0061_feature_flags.sql` (the existing skeleton) + `scripts/forecast/cumulative_uplift.py:447` (atomic UPDATE pattern on `feature_flags`).

**Reuse from 0061:**

```sql
-- Source: supabase/migrations/0061_feature_flags.sql:53-57 [VERIFIED: Read]
INSERT INTO public.feature_flags (restaurant_id, flag_key, enabled, description)
SELECT r.id, 'model_sarimax', true, 'Phase 17 BCK-04: SARIMAX gated by rolling-origin CV.'
FROM public.restaurants r
ON CONFLICT (restaurant_id, flag_key) DO NOTHING;
```

(Repeat for `model_prophet`, `model_ets`, `model_theta`, `model_naive_dow`, `model_naive_dow_with_holidays`.)

**Comment in 0061 explicitly authorizes this:**

```
-- Phase 17 will extend this table with backtest-gate rows (e.g.
-- `flag_key='backtest_gate'`) without schema regret — the (restaurant_id,
-- flag_key) PK already partitions per flag.
```

`[VERIFIED: 0061_feature_flags.sql:21-23]`

**Atomic UPDATE pattern from cumulative_uplift.py:447:**

```python
# Source: scripts/forecast/cumulative_uplift.py:445-450 [VERIFIED: Bash grep]
client.table("feature_flags").update({
    "enabled": False,
    "updated_at": "now()",  # actually use datetime.now(timezone.utc).isoformat()
}).eq("restaurant_id", restaurant_id).eq("flag_key", f"model_{model_name}").execute()
```

**`run_all.py` integration point:**

```python
# After line 185 (restaurant_id resolution) in scripts/forecast/run_all.py
def _get_enabled_models(client, restaurant_id: str) -> list[str]:
    """Phase 17 D-04: read enabled-model rows from feature_flags."""
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

This **replaces or supplements** the env-var read at line 229: `os.environ.get('FORECAST_ENABLED_MODELS', DEFAULT_MODELS)`. **Recommendation:** AND-intersect — a model is enabled iff in BOTH the env-var allowlist AND `feature_flags.enabled=true` (preserves operator escape hatch via env var, lets gate veto via DB).

**Confidence:** HIGH `[VERIFIED: codebase Read + Bash grep]`

### Deliverable 7 — `ModelAvailabilityDisclosure.svelte` extension (BCK-01/BCK-02)

**Existing component:** `src/lib/components/ModelAvailabilityDisclosure.svelte` (144 lines, already a 4-column table: Model / Status / Min-data / Why) `[VERIFIED: Read tool]`.

**Existing data path:**
- Component receives `availableModels: readonly string[]` and `grain: 'day'|'week'|'month'` as props
- `availableModels` derives in `src/lib/forecastOverlay.svelte.ts:166` from forecast data already loaded via `/api/forecast`
- Renders inside CalendarRevenueCard at line 375 (`<ModelAvailabilityDisclosure availableModels={overlay.availableModels} grain={...} />`) `[VERIFIED: grep]`

**Extension approach (D-09, no new component):**
- Add a fifth column (or a per-row sub-row) showing backtest verdict per horizon (PASS/FAIL/PENDING/UNCALIBRATED)
- Data source: extend `/api/forecast` payload (or thin new endpoint `/api/forecast-quality-summary`) to include latest `forecast_quality` rows where `evaluation_window='rolling_origin_cv'` joined to `feature_flags`
- New shape on the prop:

```ts
type BacktestStatus = {
  horizon_7d: 'PASS' | 'FAIL' | 'PENDING' | 'UNCALIBRATED';
  horizon_35d: 'PASS' | 'FAIL' | 'PENDING' | 'UNCALIBRATED';
  horizon_120d: 'PASS' | 'FAIL' | 'PENDING' | 'UNCALIBRATED';
  horizon_365d: 'PASS' | 'FAIL' | 'PENDING' | 'UNCALIBRATED';
};
type ModelInfo = {
  key: string;
  // existing fields
  backtest: BacktestStatus | null;  // null = not yet evaluated
};
```

**Layout NOT to break:** The existing `min-w-[640px]` on the table (line 105) already permits horizontal scroll on narrow viewports — Calendar* card layouts will not break. New column adds ~80px to min-width; budget to `min-w-[720px]`.

**i18n:** Component already uses `$lib/i18n/messages` with MessageKey type (line 17). Add 4 new keys (`model_avail_backtest_pass` / `_fail` / `_pending` / `_uncalibrated`) per locale (en + ja real, de/es/fr placeholder per Phase 16.1-02 pattern).

**Confidence:** HIGH `[VERIFIED: Read]`

### Deliverable 8 — `data_freshness_v` extension (BCK-08)

**Current state:** `supabase/migrations/0014_data_freshness_v.sql` defines a single-tenant view returning `(restaurant_id, last_ingested_at)` from `transactions.created_at`. `[VERIFIED: Read]`

**SSR shape:** `src/routes/+page.server.ts:69-73` queries `.from('data_freshness_v').select('last_ingested_at').maybeSingle()` and feeds `lastIngestedAt: string | null` to `<FreshnessLabel lastIngestedAt={data.freshness} />`. `[VERIFIED: grep + Read]`

**FreshnessLabel logic (`src/lib/components/FreshnessLabel.svelte`):**
- `<30h` → muted gray
- `>30h` → yellow
- `>48h` → red + outdated suffix `[VERIFIED: Read FreshnessLabel.svelte]`

**Approach (D-10):** UNION branch. New view returns `(restaurant_id, stage, last_ingested_at)` instead of single-row `(restaurant_id, last_ingested_at)`. **BREAKING for SSR.** Two options:

| Option | Pro | Con |
|---|---|---|
| **A. Keep view shape; use MAX-aggregate UNION** — view returns single max(timestamp) across transactions+forecast stages | No SSR change; FreshnessLabel signals "anything stale" | Loses per-stage info; can't show *which* stage is stale |
| **B. Break view shape; SSR queries multiple rows** | Per-stage badge UX possible | SSR change AND FreshnessLabel signature change AND BCK-08 contract drift |

**Recommendation: Option A.** UNION's MAX semantics let the existing `lastIngestedAt: string | null` contract stay intact. The "stale" decision becomes "any cascade stage stale by >24h pulls the view's max-timestamp back, triggering yellow/red." This is exactly what BCK-08 asks for ("if `pipeline_runs.upstream_freshness_h > 24` for any cascade stage, dashboard renders the stale-data badge"). Per-stage detail is Phase 18+.

```sql
-- Phase 17 BCK-08: extend data_freshness_v to include forecast cascade stages.
-- Returns the LATEST freshness timestamp across transactions ingest + forecast
-- pipeline runs. FreshnessLabel.svelte reads the unchanged column shape and
-- surfaces yellow >30h / red >48h automatically.
DROP VIEW IF EXISTS public.data_freshness_v;
CREATE VIEW public.data_freshness_v
WITH (security_invoker = true) AS
WITH all_stages AS (
  -- Stage 1: transactions ingest (existing branch)
  SELECT
    t.restaurant_id,
    MAX(t.created_at) AS stage_last
  FROM public.transactions t
  WHERE t.restaurant_id::text = (auth.jwt() ->> 'restaurant_id')
  GROUP BY t.restaurant_id
  UNION ALL
  -- Stage 2: forecast pipeline runs (NEW per BCK-08)
  SELECT
    pr.restaurant_id,
    MAX(pr.finished_at) AS stage_last
  FROM public.pipeline_runs pr
  WHERE pr.status = 'success'
    AND pr.step_name IN ('forecast_run_all', 'forecast_backtest', 'forecast_sarimax', 'forecast_prophet', 'forecast_ets', 'forecast_theta', 'forecast_naive_dow')
    AND (pr.restaurant_id IS NULL  -- audit-script global rows (Phase 12)
         OR pr.restaurant_id::text = (auth.jwt() ->> 'restaurant_id'))
  GROUP BY pr.restaurant_id
)
SELECT
  restaurant_id,
  -- MIN(MAX(stage_last)) — the stalest stage drives the label
  MIN(stage_last) AS last_ingested_at
FROM all_stages
WHERE restaurant_id IS NOT NULL  -- drop global Phase 12 audit rows from per-tenant output
GROUP BY restaurant_id;

GRANT SELECT ON public.data_freshness_v TO authenticated;
```

**Subtle correctness note:** The outer `MIN(stage_last)` returns the **stalest** stage timestamp. If transactions are fresh but forecast is 30h old, `last_ingested_at = forecast_finished_at_30h_ago` → FreshnessLabel goes yellow. This matches BCK-08 semantics ("if pipeline_runs.upstream_freshness_h > 24 for any cascade stage").

**Confidence:** HIGH `[VERIFIED: Read 0014 + 0046 + +page.server.ts]`

## Schema Impact

### New migration `00XX_phase17_backtest_schema.sql`

Three changes in one migration:

1. **Extend `forecast_quality` for rolling_origin_cv rows.** The existing PK `(restaurant_id, kpi_name, model_name, horizon_days, evaluation_window, evaluated_at)` `[VERIFIED: 0051_forecast_quality.sql:14]` already disambiguates fold rows IFF `evaluated_at` differs across folds (each fold runs in a separate `evaluate_*` invocation with `now()` separation in microseconds). **Risk:** if multiple folds write inside the same transaction with the same `now()`, PK conflict. **Mitigation:** add explicit `fold_index integer` column and include in PK, OR rely on `evaluated_at` precision (timestamptz is microsecond, `backtest.py` writes serially per fold).

   **Recommendation:** add nullable cols (`fold_index integer`, `train_end_date date`, `eval_start_date date`) that are populated for `evaluation_window='rolling_origin_cv'` rows and NULL for `evaluation_window='last_7_days'` rows. Do NOT extend the PK — keep `evaluated_at` as the disambiguator (microsecond resolution, sequential writes from a single backtest.py run). The new columns are diagnostic, not load-bearing.

   ```sql
   ALTER TABLE public.forecast_quality
     ADD COLUMN IF NOT EXISTS fold_index integer,
     ADD COLUMN IF NOT EXISTS train_end_date date,
     ADD COLUMN IF NOT EXISTS eval_start_date date,
     ADD COLUMN IF NOT EXISTS gate_verdict text
       CHECK (gate_verdict IN ('PASS', 'FAIL', 'PENDING', 'UNCALIBRATED') OR gate_verdict IS NULL);
   COMMENT ON COLUMN public.forecast_quality.fold_index IS
     'Phase 17 BCK-01: 0..3 for rolling_origin_cv rows; NULL for last_7_days rows.';
   COMMENT ON COLUMN public.forecast_quality.gate_verdict IS
     'Phase 17 BCK-04: aggregated verdict per (model, horizon) used by ACCURACY-LOG and feature_flags writer.';
   ```

2. **Seed per-model `feature_flags` rows (D-04, D-06).**

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

3. **Extend `data_freshness_v`** — see SQL block in Deliverable 8 above.

**Confidence:** HIGH `[VERIFIED: codebase Read]`

### Possible additional migration: `model_name` constraint on `forecast_daily`

**Open check before plan starts:** Plan-checker must `grep "model_name" supabase/migrations/0050_forecast_daily.sql` to verify there's no CHECK constraint listing exactly `('sarimax','prophet','ets','theta','naive_dow')`. If there is, a one-liner ALTER is needed to allow `'naive_dow_with_holidays'`. From the search, no such constraint was discovered in the existing forecast_daily schema, but verify.

## Subprocess Fold-Driver Design

### CLI surface to add

**Current state per script:**
- All 5 fit scripts read 4 env vars: `RESTAURANT_ID`, `KPI_NAME`, `RUN_DATE`, `GRANULARITY` (no other CLI flags) `[VERIFIED: Bash grep]`
- All 5 expose internal `fit_and_write(client, *, restaurant_id, kpi_name, run_date, granularity='day', track='bau', train_end: Optional[date]=None)` Python-callable function `[VERIFIED: Read sarimax_fit.py:257-265]`
- The internal `train_end` kwarg is **already accepted** for Phase 16 CF fits — Phase 17 just needs to wire CLI access to it for BAU subprocess invocation

**New CLI flags to add to all 5 `*_fit.py` scripts (and `naive_dow_with_holidays.py`):**

```python
# At the bottom of each *_fit.py — replace the env-var-only block:
if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=f'Phase 14/17 {model_name} fit')
    parser.add_argument('--train-end', type=str, default=None,
        help='YYYY-MM-DD. Override default train_end_for_grain. Used by backtest.py per fold.')
    parser.add_argument('--eval-start', type=str, default=None,
        help='YYYY-MM-DD. First date of the evaluation window. Optional — backtest.py ignores fit-side, uses this only to record which fold this fit belongs to.')
    parser.add_argument('--fold-index', type=int, default=None,
        help='0-indexed fold number. Written to forecast_quality.fold_index. Optional.')
    args = parser.parse_args()

    # Existing env-var reads...
    restaurant_id = os.environ.get('RESTAURANT_ID', '').strip()
    # ...

    train_end_override = date.fromisoformat(args.train_end) if args.train_end else None

    n = fit_and_write(
        client,
        restaurant_id=restaurant_id,
        kpi_name=kpi_name,
        run_date=run_date,
        granularity=granularity,
        train_end=train_end_override,  # already accepted by all fit_and_write signatures
    )
```

**Why CLI flags over more env vars:** subprocess argparse naturally supports `--train-end YYYY-MM-DD` injection; env-var-only would require dynamic env mutation per fold which is more error-prone.

**Argparse conflict check:** No existing positional args in any `*_fit.py` per `[VERIFIED: grep "argparse" .../scripts/forecast/*_fit.py]` (no argparse usage found at all — all are env-var-only). Adding argparse is purely additive.

### Rolling-origin loop pseudocode

```python
# scripts/forecast/backtest.py — pseudocode for rolling-origin CV driver
"""
Phase 17 backtest driver. Spawns each *_fit.py per fold with --train-end /
--eval-start. After all folds complete, calibrates h=35 CIs via
ConformalIntervals(h=35, n_windows=4) using collected fold residuals.
"""
HORIZONS = [7, 35, 120, 365]
N_FOLDS = 4
MODELS = ['sarimax', 'prophet', 'ets', 'theta', 'naive_dow', 'naive_dow_with_holidays']
KPIS = ['revenue_eur', 'invoice_count']

def main(client, restaurant_id, run_date):
    last_actual = _get_last_actual_date(client, restaurant_id=restaurant_id)
    for kpi in KPIS:
        for horizon in HORIZONS:
            # Cold-start guard (BCK-02 PENDING badge)
            if _days_of_history(client, restaurant_id) < horizon + N_FOLDS:
                _write_pending_rows(client, kpi, horizon, restaurant_id, run_date)
                continue

            # Step cutoffs back from last_actual:
            # fold 0: train_end = last_actual - 0*horizon, eval_start = last_actual - horizon + 1
            # fold 1: train_end = last_actual - 1*horizon, ...
            # fold 2..3 similarly
            for fold_idx in range(N_FOLDS):
                eval_end = last_actual - timedelta(days=fold_idx * horizon)
                eval_start = eval_end - timedelta(days=horizon - 1)
                train_end = eval_start - timedelta(days=1)

                for model in MODELS:
                    # Subprocess pattern matches run_all.py:114-144
                    cmd = [sys.executable, '-m', f'scripts.forecast.{model}_fit',
                           '--train-end', train_end.isoformat(),
                           '--eval-start', eval_start.isoformat(),
                           '--fold-index', str(fold_idx)]
                    env = _build_subprocess_env(restaurant_id, kpi, run_date.isoformat(), 'day')
                    result = subprocess.run(cmd, env=env, text=True, capture_output=True)
                    if result.returncode != 0:
                        # Log fold failure; continue with other folds
                        continue
                    # Each fit writes its yhat rows to forecast_daily under same run_date
                    # but distinguished by exog_signature.fold_index (or via target_date overlap)

                    # 2. Read back yhats vs actuals for [eval_start, eval_end]
                    #    using compute_metrics from last_7_eval.py
                    actuals = _fetch_actuals(client, restaurant_id, kpi, eval_start, eval_end)
                    yhats = _fetch_forecasts(client, restaurant_id, kpi, model,
                                             eval_start, eval_end, train_end)
                    metrics = compute_metrics(actuals.values, yhats.values)
                    _write_quality_row(client, restaurant_id, kpi, model, horizon,
                                       fold_idx, train_end, eval_start, metrics)

    # Conformal calibration phase — ONLY at h=35 (BCK-02 spec)
    _calibrate_conformal_h35(client, restaurant_id, MODELS, KPIS)

    # Gate decision phase — flips feature_flags.enabled
    _run_gate(client, restaurant_id, MODELS, KPIS, HORIZONS)
```

**Confidence:** MEDIUM (pseudocode; the precise interaction between fold yhat rows and the existing `(restaurant_id, kpi_name, target_date, model_name, run_date, granularity)` PK on `forecast_daily` may require either: (a) a separate `forecast_backtest_daily` table, or (b) using a discriminator like `forecast_track='backtest_fold_N'`. Plan-check must verify.)

## ConformalIntervals Integration

### The constraint

The official Nixtla docs **only** show `ConformalIntervals` used as `model.prediction_intervals=intervals` then driven by `StatsForecast.forecast()` or `StatsForecast.cross_validation()` — i.e., the StatsForecast harness orchestrates the calibration internally. `[CITED: https://nixtlaverse.nixtla.io/statsforecast/docs/tutorials/conformalprediction.html]`

This **conflicts with D-03** ("statsforecast.cross_validation is NOT used as the loop driver"). Two options:

### Option 1 (recommended) — Manual symmetric absolute-residual conformal at h=35

Implement the conformal calibration math directly in Python instead of importing `ConformalIntervals`. The math is simple enough to write inline:

```python
# scripts/forecast/conformal.py — NEW (~30 LOC)
"""
Phase 17 BCK-02: conformal CI calibration at h=35.

Per Vovk/Shafer split-conformal: collect absolute residuals from prior folds
at the matching horizon-step h, take the (1-alpha) empirical quantile, add
to the point forecast for the (lower, upper) CI band.

D-03 lock: statsforecast.cross_validation NOT used as loop driver.
backtest.py owns the rolling-origin loop; this module owns calibration.
"""
import numpy as np

def calibrate_conformal_h35(
    fold_residuals: dict[int, np.ndarray],  # {fold_idx: absolute_residuals_at_h35}
    alpha: float = 0.05,                    # 95% CI
) -> dict:
    """Return {'qhat_h35': float} — the conformal quantile to add ± to point forecast."""
    # Concat residuals across folds. n_windows=4 => n_calibration = 4 * h_step
    # but at h=35, the residual we care about is the single h-step-ahead error
    # from each fold (one residual per fold per horizon-step).
    all_residuals = np.concatenate([r for r in fold_residuals.values()])
    qhat = float(np.quantile(np.abs(all_residuals), 1 - alpha))
    return {'qhat_h35': qhat}
```

This avoids the StatsForecast-driver requirement while preserving the BCK-02 spec ("calibrates 95% CIs at horizons ≥35d"). The output `qhat_h35` is written to `forecast_quality` (or a sidecar table) and read by the Calendar* CI band rendering (deferred to Phase 18+).

### Option 2 — Use the statsforecast import as a residual-store-only

`ConformalIntervals(h=35, n_windows=4)` is a small dataclass-like wrapper. It exposes its quantile computation via internal methods — but those methods are private and not API-stable. **Not recommended** — fragile against statsforecast 1.7→2.0 upgrades.

### Verdict

**Use Option 1.** Keep the import line `from statsforecast.utils import ConformalIntervals` for documentation/grep traceability if desired, but do the math manually. The 4 fold residuals at h=35 are already collected by the rolling-origin loop. Single 30-LOC pure-Python function.

**Confidence:** MEDIUM (verified ConformalIntervals expects StatsForecast harness driver per docs; manual quantile math is well-known and documented in textbook Vovk/Shafer split-conformal).

`[CITED: https://nixtlaverse.nixtla.io/statsforecast/docs/tutorials/conformalprediction.html]`
`[CITED: https://valeman.medium.com/conformal-prediction-forecasting-with-nixtlas-statsforecast-cc39b9e30b36]`

## Gate Algorithm

```python
# scripts/forecast/backtest.py — gate decision after fold results gathered

def _gate_decision(
    quality_rows: list[dict],  # all forecast_quality rows from this run
    horizon: int,
    kpi: str,
) -> dict[str, str]:
    """Returns {model_name: 'PASS'|'FAIL'|'PENDING'|'UNCALIBRATED'} per BCK-03/04."""

    # 1. Filter to this (kpi, horizon) slice
    rows_at_h = [r for r in quality_rows
                 if r['kpi_name'] == kpi and r['horizon_days'] == horizon
                 and r['evaluation_window'] == 'rolling_origin_cv']

    # 2. Compute mean RMSE per model (across folds — D-02 says 4 folds)
    model_rmse: dict[str, float] = {}
    for r in rows_at_h:
        model_rmse.setdefault(r['model_name'], []).append(r['rmse'])
    model_rmse = {m: float(np.mean(rmses)) for m, rmses in model_rmse.items()}

    # 3. Baseline = MAX(naive_dow_RMSE, naive_dow_with_holidays_RMSE) per CONTEXT.md C-spec
    baseline_dow = model_rmse.get('naive_dow', float('inf'))
    baseline_dow_h = model_rmse.get('naive_dow_with_holidays', float('inf'))
    baseline = max(baseline_dow, baseline_dow_h)
    threshold = baseline * 0.9   # ≥10% improvement gate (BCK-04)

    # 4. Per-model verdict
    verdicts = {}
    for model, rmse in model_rmse.items():
        if model in ('naive_dow', 'naive_dow_with_holidays'):
            # Baselines are not "promoted"; they're always-on per D-06.
            # Mark PASS for accounting/UI but never flip their feature_flags off.
            verdicts[model] = 'PASS'
        elif rmse <= threshold:
            verdicts[model] = 'PASS'
        else:
            verdicts[model] = 'FAIL'
    return verdicts


def _apply_gate_to_feature_flags(client, restaurant_id, verdicts: dict, horizon: int):
    """BCK-04: any model with FAIL at any horizon flips enabled=false.
    Aggregate across horizons: a model is enabled iff PASS at ALL evaluated horizons.
    """
    for model, verdict in verdicts.items():
        if model in ('naive_dow', 'naive_dow_with_holidays'):
            continue  # baselines stay always-on per D-06
        if verdict == 'FAIL':
            client.table('feature_flags').update({
                'enabled': False,
                'updated_at': datetime.now(timezone.utc).isoformat(),
            }).eq('restaurant_id', restaurant_id).eq('flag_key', f'model_{model}').execute()
```

**Aggregation rule:** A challenger model is enabled in `feature_flags` iff it PASSes at ALL evaluable horizons. Horizons in PENDING (cold-start) state do not flip a model. Horizons in UNCALIBRATED state do not flip a model.

**Confidence:** HIGH `[derived from BCK-03/BCK-04 spec + locked decisions]`

## GHA Workflow Templates

### `forecast-backtest.yml`

```yaml
name: Forecast Backtest (Phase 17 BCK-05)
on:
  schedule:
    - cron: '0 23 * * 2'   # Tuesday 23:00 UTC (CONTEXT.md specifics)
  workflow_dispatch:
    inputs:
      models:
        description: 'Comma-separated model list (omit for all enabled)'
        required: false
        default: ''

# D-07: ACCURACY-LOG.md commit needs write. All other forecast workflows are
# contents:read; this is the SOLE write-permitted forecast workflow.
permissions:
  contents: write

# Single-flight: prevent two scheduled+manual runs from racing on forecast_quality
# rows or interleaving the ACCURACY-LOG commit. cancel-in-progress=false so a
# manual workflow_dispatch waits behind the cron rather than killing it.
concurrency:
  group: forecast-backtest
  cancel-in-progress: false

jobs:
  backtest:
    runs-on: ubuntu-latest
    timeout-minutes: 30   # 5 models × 4 horizons × 4 folds × 2 KPIs = 160 fits
                          # Conservative; refine after first run.
    env:
      GITHUB_SHA: ${{ github.sha }}
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          # default fetch-depth=1 is fine; we don't need history for the commit
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

      - name: Run backtest
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
          python -m scripts.forecast.backtest "${ARGS[@]}"

      - name: Generate ACCURACY-LOG.md
        env:
          SUPABASE_URL: ${{ secrets.DEV_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.DEV_SUPABASE_SERVICE_ROLE_KEY }}
        run: |
          set -euo pipefail
          python -m scripts.forecast.write_accuracy_log

      - name: Commit ACCURACY-LOG.md
        # github-actions[bot] commits the regenerated log. No-op if no changes
        # (e.g. dispatch invoked twice in same run with identical results).
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

**Notes:**
- `[skip ci]` in commit message prevents the commit from triggering a downstream PR-gate run on itself.
- `secrets.GITHUB_TOKEN` is implicit on `permissions: contents: write` — no extra config needed.
- `git config user.email` uses GitHub's official `actions[bot]` email per `[CITED: https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/controlling-permissions-for-github_token]`.

### `forecast-quality-gate.yml`

```yaml
name: Forecast Quality Gate (Phase 17 BCK-06)
on:
  pull_request:
    paths:
      - 'scripts/forecast/**'

# Read-only: PR gate only checks DB; never commits.
permissions:
  contents: read

# Cancel superseded runs on the same PR (pushes new commits).
concurrency:
  group: forecast-quality-gate-${{ github.ref }}
  cancel-in-progress: true

jobs:
  gate:
    runs-on: ubuntu-latest
    timeout-minutes: 5   # BCK-06: <5 min hard cap
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'
          cache-dependency-path: scripts/forecast/requirements.txt
      - name: Install minimal deps (no cmdstan — read-only check)
        run: pip install supabase python-dotenv

      - name: Check gate verdicts on enabled models
        env:
          SUPABASE_URL: ${{ secrets.DEV_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.DEV_SUPABASE_SERVICE_ROLE_KEY }}
        run: |
          set -euo pipefail
          python -m scripts.forecast.quality_gate_check
          # Script exits 1 if any enabled model has FAIL verdict at any horizon
```

**Confidence:** HIGH `[VERIFIED: forecast-refresh.yml + concurrency docs]`

## ACCURACY-LOG.md Format

```markdown
# Forecast Accuracy Log

Auto-generated weekly by `.github/workflows/forecast-backtest.yml` (Tuesday 23:00 UTC).
Do not edit by hand — the next cron run will overwrite manual edits.

**Production model:** naive_dow_with_holidays (or whichever model passes the gate)

---

## Latest run: 2026-05-12 23:00 UTC

> naive-DoW-with-holidays remains production model — no challenger promoted this week.

| Model | h=7 | h=35 | h=120 | h=365 | Verdict |
|---|---|---|---|---|---|
| naive_dow | RMSE 412 | RMSE 478 | PENDING | PENDING | baseline |
| naive_dow_with_holidays | RMSE 388 | RMSE 422 | PENDING | PENDING | baseline |
| sarimax | RMSE 405 | RMSE 510 | PENDING | PENDING | FAIL (h=35: −20.8% vs baseline) |
| prophet | RMSE 401 | RMSE 445 | PENDING | PENDING | FAIL (h=7: −3.4% vs baseline) |
| ets | RMSE 422 | RMSE 489 | PENDING | PENDING | FAIL |
| theta | RMSE 410 | RMSE 462 | PENDING | PENDING | FAIL |

**Conformal CI calibration (h=35):** qhat_95 = 156 EUR (revenue_eur)

---

## History

### 2026-05-05 23:00 UTC

| Model | h=7 | h=35 | h=120 | h=365 | Verdict |
|---|---|---|---|---|---|
| naive_dow | RMSE 415 | RMSE 481 | PENDING | PENDING | baseline |
| ... | ... | ... | ... | ... | ... |

> naive-DoW-with-holidays remains production model — no challenger promoted this week.

### 2026-04-28 23:00 UTC

(prior weeks below, append-only)
```

**Honest-failure copy templates (BCK-07 SC5):**

| Scenario | Exact line |
|---|---|
| No challenger passes any horizon | `> naive-DoW-with-holidays remains production model — no challenger promoted this week.` |
| One challenger passes one horizon | `> {model_name} promoted at h={horizon}d (RMSE improvement: {pct:.1f}%); other models remain in feature-flag=false until they beat the gate.` |
| All horizons PENDING | `> Insufficient history for any horizon — gate check resumes once {N} more days of data accumulate.` |
| h=35 calibration UNCALIBRATED | `> h=35 conformal CI is uncalibrated — needs ≥2 years history; current span: {N} days.` |

**Atomic append guarantee:** Bash commit step uses `git diff --staged --quiet` to short-circuit when no diff exists; concurrency group serializes runs.

**Confidence:** HIGH `[derived from BCK-07 + CONTEXT specifics]`

## ModelAvailabilityDisclosure.svelte Extension

### Data path

Augment `/api/forecast` payload to include `backtest` field per model:

```ts
// New shape on /api/forecast response
type ForecastApiResponse = {
  // ... existing fields
  modelBacktestStatus: {
    [model: string]: {
      h7: 'PASS'|'FAIL'|'PENDING'|'UNCALIBRATED'|null;
      h35: 'PASS'|'FAIL'|'PENDING'|'UNCALIBRATED'|null;
      h120: 'PASS'|'FAIL'|'PENDING'|'UNCALIBRATED'|null;
      h365: 'PASS'|'FAIL'|'PENDING'|'UNCALIBRATED'|null;
    };
  };
};
```

Server-side query (in `/api/forecast` handler) reads the LATEST `gate_verdict` per `(model_name, horizon_days)` from `forecast_quality WHERE evaluation_window='rolling_origin_cv'`:

```ts
const { data: backtestRows } = await supabase
  .from('forecast_quality')
  .select('model_name, horizon_days, gate_verdict, evaluated_at')
  .eq('restaurant_id', restaurantId)
  .eq('evaluation_window', 'rolling_origin_cv')
  .order('evaluated_at', { ascending: false });
// Then fold into per-model x per-horizon latest verdict map
```

### UI layout

Per-row layout (drop-in replacement for current `<tr>` block at `ModelAvailabilityDisclosure.svelte:118-137`):

```svelte
<tr>
  <td>{model_label}</td>
  <td>{availability_status}</td>
  <td>{min_data}</td>
  <td>{why}</td>
  <!-- NEW: 4-cell horizon strip; each cell colored by verdict -->
  <td class="py-0.5 align-top">
    <div class="flex gap-1 text-[10px]">
      {#each ['h7','h35','h120','h365'] as h}
        <span class="rounded px-1.5 py-0.5 {verdictColor(backtest?.[h])}">
          {h.replace('h', '')}d: {verdictShort(backtest?.[h])}
        </span>
      {/each}
    </div>
  </td>
</tr>
```

Use existing `min-w-[640px]` → `min-w-[840px]` (line 105). Calendar* card scroll wrapper at line 104 already handles overflow.

**i18n keys to add (en + ja real, de/es/fr placeholder per Phase 16.1-02):**
- `model_avail_backtest_pass` → "PASS" / 合格
- `model_avail_backtest_fail` → "FAIL" / 不合格
- `model_avail_backtest_pending` → "PENDING ({days}d to go)" / 集計中（残り{days}日）
- `model_avail_backtest_uncalibrated` → "UNCALIBRATED — need 2y" / 較正前（2年要）

**Confidence:** HIGH `[VERIFIED: Read ModelAvailabilityDisclosure.svelte]`

## data_freshness_v Extension

See full SQL in §Codebase Reuse Map deliverable 8 — recommended Option A (UNION + outer MIN) preserves existing SSR contract and `FreshnessLabel.svelte` rendering rules.

**Threshold tuning consideration:** FreshnessLabel.svelte uses `>30h` yellow / `>48h` red `[VERIFIED: Read FreshnessLabel.svelte:18-19]`. BCK-08 specifies `>24h` should trigger stale badge. Three options:

| Option | Action | Tradeoff |
|---|---|---|
| **A. Tighten badge thresholds in component** | Change `>30h`→`>24h` and `>48h`→`>30h` | Affects all freshness uses (transactions ingest may also tighten) |
| **B. Add explicit forecast threshold in view** | View only emits `forecast` stage row when its age > 24h, otherwise emits a "fresh sentinel" timestamp like `now()` | Hides forecast-stage timestamps when fresh — view becomes lying |
| **C. Accept 30h tolerance** | Document that forecast freshness uses the same 30h yellow gate as transactions | BCK-08 says >24h; user-acceptable difference is small |

**Recommendation: Option A.** Phase 17 is the natural moment to tighten. Single-line change in `FreshnessLabel.svelte`.

**Confidence:** HIGH `[VERIFIED: Read]`

## Validation Architecture (Nyquist Dimension 8)

### State transitions per artifact

#### `backtest.py`

| Cold-start state | Trigger | Output |
|---|---|---|
| Empty pipeline_runs (no Phase 14 history) | First Tuesday cron after Phase 17 deploy and zero forecasts written | All horizons → PENDING; NO feature_flags flips |
| ≥8d history, ≥7d on h=7, <h+4 days for higher horizons | Cold-start partial | h=7 PASS/FAIL; h=35/120/365 PENDING |
| ≥35+4*7 days = 63 days history | h=7 + h=35 evaluable | h=7/h=35 PASS/FAIL; h=120/h=365 PENDING |
| ≥120+4*30 days = 240 days history | h=120 evaluable | h=7/h=35/h=120 PASS/FAIL; h=365 PENDING |
| ≥365+4*90 days = 725 days history | h=365 evaluable | All horizons PASS/FAIL; UNCALIBRATED at h=35 lifts when ≥730d |
| Subprocess fit fails | Any *_fit.py exits 1 in a fold | That fold's row missing; continue with remaining folds; if <2 folds succeed at a horizon, that horizon=PENDING |

#### `feature_flags` gate writer

| Initial state | Per-model fold result | Final state |
|---|---|---|
| `enabled=true` (D-06 seed) | All horizons PASS | `enabled=true` (no change) |
| `enabled=true` | Any horizon FAIL | `enabled=false` |
| `enabled=true` | All horizons PENDING | `enabled=true` (no flip — gate is silent until evaluable) |
| `enabled=false` (set by prior week) | All horizons PASS | `enabled=true` (challenger re-promoted) |

5 challenger models × 2 outcomes (pass/fail) × 1 baseline floor = 10 outcome states; PENDING handled separately.

#### `forecast-backtest.yml` GHA workflow

| Outcome | What happens |
|---|---|
| Cron fires, all folds complete green, ACCURACY-LOG diff non-empty | Commit pushed to main |
| Cron fires, all folds complete green, ACCURACY-LOG diff empty | Skip commit (already up-to-date) |
| Cron fires, backtest.py exits 1 | Workflow fails; no commit |
| Cron fires, backtest.py succeeds, generate-log step fails | Workflow fails; no commit |
| Manual workflow_dispatch fires while cron in progress | Queued (concurrency: cancel-in-progress=false) |
| 2 manual dispatches in quick succession | Second queued behind first |

#### `data_freshness_v` extension

| Transactions stage | Forecast stage | View `last_ingested_at` | FreshnessLabel rendering |
|---|---|---|---|
| Fresh (now-1h) | Fresh (now-3h) | now-3h | gray "Last updated 3h ago" |
| Fresh (now-1h) | Stale (now-25h) | now-25h | yellow (>24h after threshold tightening) |
| Fresh (now-1h) | Very stale (now-50h) | now-50h | red |
| Stale (now-30h) | Fresh (now-2h) | now-30h | yellow |
| No transactions yet | Fresh (now-2h) | now-2h | gray (graceful — system bootstrapped) |
| No data anywhere | No data anywhere | NULL (no row returned for tenant) | "No data" gray (existing fallback) |

#### `naive_dow_with_holidays.py` outputs

| Holiday flag combo on date | Bootstrapped multiplier (training period) | Forecast yhat |
|---|---|---|
| `is_holiday=0, is_school_holiday=0, is_event=0, is_strike=0` (normal day) | mean ratio ≈ 1.0 | dow_mean × 1.0 |
| `is_holiday=1` (federal holiday) | ratio < 1.0 (closed/quiet) | dow_mean × ratio |
| `is_school_holiday=1` (BE school break) | ratio varies | dow_mean × ratio |
| `is_event=1` (Berlin recurring event) | ratio > 1.0 (busy) | dow_mean × ratio |
| `is_strike=1` (BVG transit strike) | ratio depends on shop type | dow_mean × ratio |
| Mixed flags (e.g., school holiday + event) | composite ratio from joint history | dow_mean × composite |
| Missing flag combo (no historical match) | Fall back to global ratio = 1.0 | dow_mean (== plain naive_dow) |

### Minimum sample for tests

| Test | Minimum sample to distinguish states |
|---|---|
| backtest.py cold-start vs hot | 1 fixture < 8d history → PENDING; 1 fixture ≥ 8d → PASS/FAIL |
| Gate flip on FAIL | 1 model with stub RMSE = baseline × 1.0 (== gate threshold; FAIL) + 1 with RMSE = baseline × 0.85 (PASS) |
| Gate no-flip on PENDING | 1 model with empty quality_rows → no UPDATE issued |
| ConformalIntervals h=35 calibration | 4 fold residuals; assert qhat = quantile(|residuals|, 0.95) |
| ACCURACY-LOG honest-failure copy | 1 fixture where all challengers FAIL → assert "naive-DoW-with-holidays remains production model" string present |
| feature_flags read at run_all.py startup | 1 row enabled=true + 1 enabled=false → run_all.py only spawns subprocess for enabled |
| data_freshness_v staleness propagation | 1 transactions row at now-1h + 1 forecast pipeline_runs at now-30h → view returns now-30h |
| forecast-quality-gate.yml exit 1 on FAIL | DB fixture with 1 enabled model + FAIL verdict at h=7 → script exits 1 |
| ModelAvailabilityDisclosure backtest column | 1 model with `{h7:'PASS', h35:'FAIL'}` → DOM has 4 verdict pills, h35 colored red |

## Cross-cutting Risks & Landmines

### R1 — `forecast_daily` PK collision when 4 folds write same target_date

**Risk:** Existing `forecast_daily` PK is `(restaurant_id, kpi_name, target_date, model_name, run_date, granularity)` (inferred from `0050_forecast_daily.sql`). Four folds at h=7 write yhats for overlapping `target_date` values with the same `run_date` and `model_name` — PK conflict on second fold UPSERT.

**Mitigation options:**
- (a) Add `forecast_track='backtest_fold_{N}'` discriminator (track is part of PK in 0050 — verify) — 4 folds × 4 horizons = 16 distinct track values per model
- (b) Have `backtest.py` not write to `forecast_daily` at all — compute yhats in-memory and write only to `forecast_quality`. Trades less DB churn for losing per-fold visibility.
- (c) New table `forecast_backtest_daily` with `(restaurant_id, kpi_name, model_name, run_date, fold_index, horizon_days, target_date)` PK.

**Recommendation:** (b) for v1. backtest.py only writes aggregate metrics to `forecast_quality`; the per-day yhat array stays in-memory for the fold's metric computation, then is discarded. Phase 18+ can add per-fold DB visibility if needed.

**Confidence:** HIGH (well-known pattern; needs plan-check on 0050 PK definition before implementation)

### R2 — statsforecast 1.7 → 2.0 ConformalIntervals API drift

**Risk:** statsforecast 2.0 (per requirements `>=1.7,<2`) is pinned out of this repo, so 2.0 is moot. But 1.7's `ConformalIntervals` is documented as a `prediction_intervals=` kwarg passed into a model constructor; any direct instantiation outside `StatsForecast.cross_validation()` is undocumented. **Decision:** do NOT use the import; write the conformal math inline in `scripts/forecast/conformal.py` (~30 LOC). See §ConformalIntervals Integration Option 1.

`[CITED: https://nixtlaverse.nixtla.io/statsforecast/docs/tutorials/conformalprediction.html]`

### R3 — Subprocess argparse + env-var precedence ambiguity

**Risk:** Adding `--train-end` to `*_fit.py` while keeping env-var-only as the default could create a "did the env var or the flag win?" footgun.

**Mitigation:** argparse value (when explicitly passed) ALWAYS overrides the per-grain default. Document in script docstrings: "If `--train-end` is passed, it overrides `train_end_for_grain(last_actual, granularity)`. The env var path is unaffected — `train_end` is computed from `last_actual` (env-derived) when no flag is set."

### R4 — Long-horizon (120d, 365d) folds insufficient history

**Risk:** Phase 14 shipped 2026-04-30 (per STATE.md). At Phase 17's first run (Tuesday after Phase 17 ship, mid-May 2026), there is ~6 weeks of forecast-vs-actual history. h=120 needs ≥120+4×30=240 days; h=365 needs ≥725 days. Both will be PENDING for 8+ months and 2+ years respectively. ACCURACY-LOG must clearly say "PENDING — gathering N days" and not falsely report a verdict.

**Mitigation:** Cold-start guard in backtest.py at the top of the horizon loop: if `_days_of_history(restaurant_id) < horizon + N_FOLDS * (horizon // 4)`, write PENDING rows and `continue`.

### R5 — GHA timeout if 5 models × 4 folds × 4 horizons × 2 KPIs = 160 fits exceed 30 min

**Risk:** Each fit at daily grain is ~10-30s in Phase 14. 160 × 20s = 53min. **Exceeds the 30min timeout.**

**Mitigation:** Batch by KPI (one parallel job per KPI), or restrict backtest to daily granularity only (skip week/month grain — backtest at native grain doesn't need the multi-grain matrix). Recommendation: daily-only at backtest time. Calendar* charts already aggregate yhat samples to week/month.

Plan should include a timing budget step: time the first run, then adjust.

### R6 — Forecast workflow already runs nightly at 01:00 UTC; backtest at 23:00 UTC overlaps schema+row contention

**Risk:** Tuesday 23:00 UTC backtest may complete at, say, 23:30 UTC; Wednesday 01:00 UTC nightly forecast then fires. Two hours of margin is fine in normal cases, but if backtest takes >2h, contention.

**Mitigation:** Document the 2h SLA budget on backtest. Add `concurrency.group: forecast-backtest` (already in template) and additionally add a notional dependency lock — e.g., backtest could check the latest `pipeline_runs.step_name='forecast_run_all'` finished_at and refuse to start if mid-run.

### R7 — `feature_flags.enabled=false` on a load-bearing baseline

**Risk:** Operator runs `gh workflow run forecast-quality-gate.yml` with bad data; gate flips `model_naive_dow.enabled=false`. `run_all.py` then drops the only baseline → forecasts disappear from dashboard.

**Mitigation:** Hard-code in `_apply_gate_to_feature_flags` (per gate algorithm above) that `naive_dow` and `naive_dow_with_holidays` are NEVER flipped. Add a CI guard test asserting these two flag_keys are never written from gate code paths.

### R8 — `model_name='naive_dow_with_holidays'` violates a hidden CHECK constraint

**Risk:** `0050_forecast_daily.sql` may have a `CHECK (model_name IN ('sarimax','prophet',...))`.

**Mitigation:** Plan-checker greps `0050_forecast_daily.sql` for `CHECK.*model_name`. If present, migration adds the new value.

### R9 — git push from GHA on protected branch

**Risk:** If main branch protection is later turned on, `forecast-backtest.yml` will fail to push.

**Mitigation:** Verified 2026-05-06 main is **not** protected (`[VERIFIED: gh API]`). If it gets protected later, options are (a) PAT, (b) commit to a `forecast-backtest/auto-update` branch and auto-PR, (c) GitHub App with branch-protection bypass. Document in the workflow comment: "If main becomes protected, this workflow will fail; see Phase 17 RESEARCH.md §R9".

`[CITED: https://github.com/orgs/community/discussions/25305]`
`[CITED: https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/controlling-permissions-for-github_token]`

### R10 — Concurrent dashboard load reads partially-written forecast_quality during gate run

**Risk:** Dashboard SSR reads `forecast_quality` while backtest.py is mid-write. User sees a snapshot with N folds for some models and N-1 for others. Since the UI shows the latest verdict (aggregated post-write), the verdict column is missing/null for in-flight rows.

**Mitigation:** Write the `gate_verdict` column LAST in backtest.py, in a single transaction that updates all rows for that (model, horizon). Frontend treats `gate_verdict IS NULL` as "computing".

## Sources

### Primary (HIGH confidence)
- Codebase: `/Users/shiniguchi/development/ramen-bones-analytics/scripts/forecast/{run_all,naive_dow_fit,sarimax_fit,prophet_fit,ets_fit,theta_fit,last_7_eval,exog,db,grain_helpers,cumulative_uplift}.py` `[VERIFIED: Read tool]`
- Codebase: `supabase/migrations/{0014_data_freshness_v,0039_pipeline_runs_skeleton,0046_pipeline_runs_extend,0050_forecast_daily,0051_forecast_quality,0061_feature_flags}.sql` `[VERIFIED: Read tool]`
- Codebase: `.github/workflows/{forecast-refresh,external-data-refresh}.yml` `[VERIFIED: Read tool]`
- Codebase: `src/lib/components/{ModelAvailabilityDisclosure,FreshnessLabel}.svelte` and `src/routes/+page.server.ts` `[VERIFIED: Read tool]`
- GitHub API: `gh api repos/shiniguchi/ramen-bones-analytics/branches/main/protection` returns 404 "Branch not protected" `[VERIFIED: 2026-05-06]`

### Secondary (MEDIUM confidence)
- [Conformal Prediction tutorial — Nixtla](https://nixtlaverse.nixtla.io/statsforecast/docs/tutorials/conformalprediction.html) — `ConformalIntervals(h, n_windows)` constructor signature and StatsForecast-driver usage pattern
- [GitHub Actions GITHUB_TOKEN permissions docs](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/controlling-permissions-for-github_token) — `permissions: contents: write` and bot push behavior
- [github-actions[bot] push to protected branch — community discussion](https://github.com/orgs/community/discussions/25305) — fallback strategies if main is later protected

### Tertiary (LOW confidence — flag for validation)
- [Conformal Prediction with Nixtla statsforecast — Medium](https://valeman.medium.com/conformal-prediction-forecasting-with-nixtlas-statsforecast-cc39b9e30b36) — auxiliary explanation; the manual-residual quantile pattern is also textbook Vovk/Shafer split-conformal

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `forecast_daily` PK includes `forecast_track` allowing per-fold writes | §R1 / §Subprocess Fold-Driver Design | Plan must verify; if PK doesn't include track, switch to in-memory yhats (recommended Option b) |
| A2 | `forecast_daily.model_name` has no CHECK constraint excluding `naive_dow_with_holidays` | §R8 / §Schema Impact | If constraint exists, one-line ALTER + reload migration |
| A3 | All 5 `*_fit.py` `fit_and_write` functions accept `train_end` kwarg today | §Subprocess Fold-Driver Design | Verified for sarimax, naive_dow, prophet via Read; plan must verify ets/theta |
| A4 | `pipeline_runs.step_name` values for forecast = `forecast_run_all`, `forecast_sarimax`, `forecast_prophet`, `forecast_ets`, `forecast_theta`, `forecast_naive_dow` | §data_freshness_v Extension | Verified for naive_dow (`STEP_NAME = 'forecast_naive_dow'` line 50); plan must verify others |
| A5 | Manual quantile-based conformal calibration is acceptable for BCK-02 (vs. importing statsforecast `ConformalIntervals` class) | §ConformalIntervals Integration | If user wants strict statsforecast import: Option 2 / hybrid path with version-pin-aware code |
| A6 | Tightening FreshnessLabel thresholds from 30h/48h to 24h/30h is in-scope for Phase 17 | §data_freshness_v Extension | If tightening lands outside Phase 17 scope, BCK-08 spec satisfied via the pattern but threshold won't match the spec literal |
| A7 | naive_dow_with_holidays `model_name` will be the literal string `'naive_dow_with_holidays'` | §Codebase Reuse Map deliverable 2, §Schema Impact | If shorter name preferred (e.g., `'naive_dow_h'`), seed row description fields trivially update |
| A8 | Per-restaurant flag-key seeding for the single v1 tenant is fine; no admin form needed | §Schema Impact migration | Multi-tenant rollout would need an admin tool to seed flags for new tenants |

## Open Questions (RESOLVED)

1. **`forecast_daily` PK shape vs. backtest fold collision (A1)**
   - What we know: Phase 14/15 PK includes `forecast_track`; folds are stored as separate rows already in the CF case
   - What's unclear: whether `forecast_track='backtest_fold_0..3'` is a clean addition or pollutes downstream views (`forecast_with_actual_v` etc.)
   - RESOLVED: per-fold `FORECAST_TRACK='backtest_fold_{N}'` discriminator is the chosen approach (forecast_track IS in PK position 6 per 0050_forecast_daily.sql:15 — verified). RUN_DATE=eval_start (the day after train_end) is set per fold so the spawned fit's pred_dates anchor correctly. backtest.py reads back yhats from forecast_daily filtered by (model_name, run_date, forecast_track) and DELETES backtest_fold_* rows post-eval. See §R1 option (a). Plan 17-04 threads FORECAST_TRACK into 5 fit scripts; plan 17-05 sets RUN_DATE=eval_start + FORECAST_TRACK=backtest_fold_{N} per spawned subprocess.

2. **Multi-grain backtest scope**
   - What we know: BCK-01 specifies "4 horizons (7d/35d/120d/365d)" — all in days
   - What's unclear: whether the gate should also evaluate week/month grain forecasts
   - RESOLVED: daily grain only for Phase 17. Week/month evaluation is Phase 18+ (deferred per §Phase Boundary).

3. **`run_all.py` env var × `feature_flags` precedence**
   - What we know: env var `FORECAST_ENABLED_MODELS` is the current source of truth
   - What's unclear: whether feature_flags should override env (DB-first) or AND-intersect (both required)
   - RESOLVED: AND-intersect — preserves operator escape hatch via env var, lets gate veto via DB. See plan 17-06 implementation.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Python 3.12 | All forecast scripts (Phase 14 baseline) | ✓ | 3.12 (GHA setup-python step) | — |
| `statsforecast>=1.7,<2` | (Optional — manual conformal preferred) | ✓ | already in `scripts/forecast/requirements.txt:3` | Use inline NumPy quantile (recommended) |
| `numpy`, `pandas` | backtest.py metric math | ✓ | installed | — |
| `supabase-py` | DB writes | ✓ | `>=2.0,<3` | — |
| `cmdstan` | Prophet (used during backtest folds) | ✓ | cached via `actions/cache@v4` | — |
| `gh` CLI | Plan verification (this researcher only — not runtime) | ✓ | 2026-05-06 confirmed working | — |
| GHA `secrets.DEV_SUPABASE_URL` | forecast-backtest.yml + forecast-quality-gate.yml | ✓ | (used by forecast-refresh.yml) | — |
| GHA `secrets.DEV_SUPABASE_SERVICE_ROLE_KEY` | same | ✓ | (used by forecast-refresh.yml) | — |
| `GITHUB_TOKEN` with `contents: write` | forecast-backtest.yml commit step | ✓ | implicit on permissions key | — |
| Main branch unprotected | forecast-backtest.yml push | ✓ | confirmed 2026-05-06 via gh API | If protected later: §R9 |

**No missing blocking dependencies.**

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Framework | `pytest>=8.0,<9` (already in `scripts/forecast/requirements.txt:10`) |
| Config file | None at repo root for forecast tests; uses pytest discovery in `scripts/forecast/tests/` |
| Quick run command | `pytest scripts/forecast/tests/test_backtest.py -x` (NEW file Phase 17 will add) |
| Full suite command | `pytest scripts/forecast/tests/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| BCK-01 | Rolling-origin loop computes RMSE+MAPE per (model × horizon × fold) | unit | `pytest scripts/forecast/tests/test_backtest.py::test_fold_metrics -x` | ❌ Wave 0 |
| BCK-01 | Cold-start emits PENDING rows when history < horizon+4 days | unit | `pytest scripts/forecast/tests/test_backtest.py::test_cold_start_pending -x` | ❌ Wave 0 |
| BCK-02 | Conformal qhat at h=35 = 95th percentile of |fold residuals| | unit | `pytest scripts/forecast/tests/test_conformal.py::test_qhat_h35 -x` | ❌ Wave 0 |
| BCK-02 | Long horizons emit UNCALIBRATED until ≥730d | unit | `pytest scripts/forecast/tests/test_backtest.py::test_uncalibrated_threshold -x` | ❌ Wave 0 |
| BCK-03 | Gate uses MAX(naive_dow_RMSE, naive_dow_with_holidays_RMSE) as baseline | unit | `pytest scripts/forecast/tests/test_backtest.py::test_baseline_max -x` | ❌ Wave 0 |
| BCK-03 | naive_dow_with_holidays applies holiday multipliers from exog flags | unit | `pytest scripts/forecast/tests/test_naive_dow_holidays.py::test_holiday_multiplier -x` | ❌ Wave 0 |
| BCK-04 | Gate flips feature_flags.enabled=false on FAIL; never flips baselines | integration | `pytest scripts/forecast/tests/test_gate.py::test_flip_on_fail -x` | ❌ Wave 0 |
| BCK-04 | run_all.py reads enabled models from feature_flags AND env var (intersect) | integration | `pytest scripts/forecast/tests/test_run_all_feature_flags.py -x` | ❌ Wave 0 |
| BCK-05 | forecast-backtest.yml cron expression == `'0 23 * * 2'` | unit | `pytest scripts/forecast/tests/test_workflow_yaml.py::test_backtest_cron -x` | ❌ Wave 0 |
| BCK-06 | quality_gate_check.py exits 1 when enabled model has FAIL verdict | unit | `pytest scripts/forecast/tests/test_quality_gate_check.py -x` | ❌ Wave 0 |
| BCK-07 | write_accuracy_log.py emits "naive-DoW-with-holidays remains production model" string when no challenger passes | unit | `pytest scripts/forecast/tests/test_accuracy_log.py::test_honest_failure_string -x` | ❌ Wave 0 |
| BCK-07 | ACCURACY-LOG.md is append-only — prior entries preserved | unit | `pytest scripts/forecast/tests/test_accuracy_log.py::test_append_only -x` | ❌ Wave 0 |
| BCK-08 | data_freshness_v UNION returns stalest stage timestamp | integration (DB) | `pytest scripts/forecast/tests/test_data_freshness_v.py -x` | ❌ Wave 0 |
| BCK-08 | FreshnessLabel.svelte threshold tightening (24h yellow / 30h red) | unit (frontend) | `npm run test:unit -- src/lib/components/FreshnessLabel.test.ts` | ❌ Wave 0 |
| Cross | ModelAvailabilityDisclosure renders backtest column with 4 horizon pills | unit (frontend) | `npm run test:unit -- src/lib/components/ModelAvailabilityDisclosure.test.ts` | ❌ Wave 0 (extend existing test if any) |

### Sampling Rate

- **Per task commit:** `pytest scripts/forecast/tests/test_backtest.py -x` (~5s)
- **Per wave merge:** `pytest scripts/forecast/tests/ && npm run test:unit` (full)
- **Phase gate:** Full suite green + DB integration tests pass on DEV before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `scripts/forecast/tests/test_backtest.py` — covers BCK-01, BCK-02, BCK-03 (cold-start, baseline-max, gate-decision; uses fixtures from existing `conftest.py`)
- [ ] `scripts/forecast/tests/test_naive_dow_holidays.py` — covers BCK-03 holiday multiplier
- [ ] `scripts/forecast/tests/test_conformal.py` — covers BCK-02 quantile math
- [ ] `scripts/forecast/tests/test_gate.py` — covers BCK-04 feature_flags writer
- [ ] `scripts/forecast/tests/test_quality_gate_check.py` — covers BCK-06 PR gate
- [ ] `scripts/forecast/tests/test_accuracy_log.py` — covers BCK-07
- [ ] `scripts/forecast/tests/test_workflow_yaml.py` — parses YAML, asserts cron + permissions + concurrency
- [ ] `scripts/forecast/tests/test_data_freshness_v.py` — covers BCK-08 (DB integration, sets up two stages with different timestamps)
- [ ] `scripts/forecast/tests/test_run_all_feature_flags.py` — covers BCK-04 read-side integration
- [ ] (frontend) Extension to existing `ModelAvailabilityDisclosure` Vitest tests

(Existing test infrastructure: `scripts/forecast/tests/conftest.py` + 11 test files cover Phases 13-16 patterns. New tests follow the same fixtures pattern.)

## Project Constraints (from CLAUDE.md)

- **Tech stack pinned:** Python 3.12+, `statsforecast>=1.7,<2`, SvelteKit 2.x + Svelte 5, Supabase Postgres 15+, GHA free tier
- **Workflow:** `feature/phase-17-...` branch required (Stop hook + CF Pages convention); `docs/workflow.md` 5-step canonical sequence
- **Planning-docs drift gate:** Mandatory before `/gsd-ship`; ROADMAP/STATE update + tick `[x]` after phase complete
- **Default environment:** DEV unless user says local/prod
- **No `Co-authored-by: Claude` on git commits** (forbidden per CLAUDE.md)
- **Per-task QA mandatory:** push → DEV → Playwright/curl/DB verify → mark complete
- **Localhost-first for any UI change** to `ModelAvailabilityDisclosure.svelte` (Playwright MCP at localhost:5173 BEFORE DEV deploy)
- **Adversarial QA:** try to BREAK the gate; do not just confirm it works
- **Evidence before claims:** no "should work" — run the command, show the output

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries in repo or pinned in requirements.txt; verified via Read
- Architecture (subprocess pattern, GHA mirroring): HIGH — directly reuses Phase 14 patterns
- Conformal calibration approach: MEDIUM — official docs only show StatsForecast-driver path; manual quantile recommended (textbook math)
- Schema impact (forecast_quality / feature_flags / data_freshness_v): HIGH — exact migrations spec'd from existing schemas
- Common pitfalls (R1-R10): HIGH for known issues, MEDIUM for timing budget (R5)

**Research date:** 2026-05-06
**Valid until:** 2026-06-06 (30 days; statsforecast and supabase-py both stable)

## RESEARCH COMPLETE
