# Phase 17: Backtest Gate & Quality Monitoring — Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a rolling-origin cross-validation harness that scores every forecast model at 4 horizons (7d/35d/120d/365d), calibrates conformal intervals at h=35, gates model promotion on ≥10% RMSE improvement vs. a regressor-aware naive baseline, auto-commits an append-only ACCURACY-LOG weekly, and extends the existing freshness-SLO badge to cover forecast cascade pipeline stages.

**Concrete deliverables (mapped to ROADMAP BCK requirements):**

1. **`scripts/forecast/backtest.py` (BCK-01/BCK-02/BCK-03):** Manual rolling-origin CV loop — calls each existing `*_fit.py` subprocess with `--train-end` / `--eval-start` flags per fold (same subprocess pattern as `run_all.py`). 4 folds per horizon. Computes RMSE + MAPE per (model × horizon × fold) and writes rows to `forecast_quality` with `evaluation_window='rolling_origin_cv'`. Calls `statsforecast.ConformalIntervals(h=35, n_windows=4)` for conformal CI calibration at horizons ≥35d. Long horizons (120d, 365d) write `evaluation_window='rolling_origin_cv'` rows with a PENDING status until sufficient history exists. Cold-start threshold: "BACKTEST PENDING" until day 8 of production data.

2. **`scripts/forecast/naive_dow_with_holidays.py` (BCK-03):** New standalone script (does NOT modify `naive_dow_fit.py`). Holiday-adjusted multiplicative naive baseline — applies the same holiday/weather regressors available to competing models. `backtest.py` runs this alongside each model to compute the regressor-aware reference RMSE. Gate compares each model against the higher of `naive_dow` and `naive_dow_with_holidays` RMSE.

3. **`forecast-backtest.yml` GHA workflow (BCK-05):** Weekly cron Tuesday 23:00 UTC. Runs `backtest.py`, then writes ACCURACY-LOG.md and commits it to main via `GITHUB_TOKEN` (`permissions: contents: write`). Pattern mirrors `forecast-refresh.yml`.

4. **`forecast-quality-gate.yml` GHA workflow (BCK-06):** Runs on every forecast-engine PR (triggered on changes to `scripts/forecast/**`). Fails CI when gate criteria miss for any model with `feature_flags.enabled=true`. Must complete in <5 min.

5. **`docs/forecast/ACCURACY-LOG.md` (BCK-07):** Auto-committed weekly by `forecast-backtest.yml`. Append-only format: latest-week summary table at top, history section below that grows each run. Each entry includes run date, model, horizon, RMSE, gate verdict (PASS / FAIL / PENDING / UNCALIBRATED). When no model beats naive, the log honestly records "naive-DoW-with-holidays remains production model — no challenger promoted this week."

6. **Per-model `feature_flags` rows + gate writer (BCK-04):** Migration seeds 5 rows (one per model: `model_sarimax`, `model_prophet`, `model_ets`, `model_theta`, `model_naive_dow`) at `enabled=true` on deploy. `backtest.py` gate step flips `enabled=false` for any model that fails the ≥10% RMSE threshold. `run_all.py` extended to read these flags at startup and skip disabled models.

7. **`ModelAvailabilityDisclosure.svelte` extension (BCK-01/BCK-02):** Add backtest status row per horizon (PASS / FAIL / PENDING — gathering N days / UNCALIBRATED — ≥2 years data needed) to the existing component. Calendar* cards inherit it automatically with no layout changes.

8. **`data_freshness_v` extended with forecast stages (BCK-08):** Extend the existing view to include forecast pipeline cascade stages. `+page.server.ts` freshness query reads this view — no new SSR subrequest needed. `FreshnessLabel.svelte` surfaces the stale-data badge automatically when `upstream_freshness_h > 24` for any forecast stage.

**Out of scope (Phase 17):**
- Sunday zeros fix — `closed_days.py` Sunday mask needs updating separately (deferred hotfix; see Deferred Ideas)
- Phase 18+ quality surfacing beyond ModelAvailabilityDisclosure
- CI interval display in Calendar* charts — conformal calibration result is written to DB; chart rendering is a future phase concern

</domain>

<decisions>
## Implementation Decisions

### Rolling-Origin CV (backtest.py)

- **D-01:** Manual rolling-origin loop — `backtest.py` calls each existing `*_fit.py` script as a subprocess per fold, passing `--train-end` and `--eval-start` CLI flags. No adapter wrappers for SARIMAX or Prophet. Matches the existing `run_all.py` subprocess pattern exactly.
- **D-02:** 4 folds per horizon — aligns with `ConformalIntervals(n_windows=4)` already specified in BCK-01. Short horizons (7d, 35d) can run immediately with current ~12 months of data. Long horizons (120d, 365d) will be PENDING until sufficient fold depth exists.
- **D-03:** `statsforecast.cross_validation` is NOT used as the loop driver. `ConformalIntervals` from statsforecast IS used for CI calibration at h=35 after fold results are collected.

### Promotion Gate

- **D-04:** Per-model `feature_flags` rows — new migration seeds 5 rows with `(restaurant_id, flag_key='model_{name}', enabled=true)` for all current models on deploy. `backtest.py` writes `enabled=false` for failing models. `run_all.py` reads these rows at startup via DB query and builds the enabled-models list (replacing pure env-var control for gated models).
- **D-05:** New `naive_dow_with_holidays.py` script (does NOT modify `naive_dow_fit.py`). Holiday-adjusted multiplicative naive baseline that has access to the same regressors as competing models.
- **D-06:** Initial `enabled=true` for all 5 existing models — no forecast outage on Phase 17 deploy. The gate first runs on the following Tuesday 23:00 UTC and may flip models to `enabled=false` if they fail.

### ACCURACY-LOG

- **D-07:** Commit `docs/forecast/ACCURACY-LOG.md` to main via `GITHUB_TOKEN` — `forecast-backtest.yml` gets `permissions: contents: write`. No PAT required (main branch protection does not block this workflow's pushes).
- **D-08:** Append-only format — latest week summary at top, history section grows each weekly run. Entries include: run date, model, horizon, RMSE, gate verdict (PASS / FAIL / PENDING / UNCALIBRATED).

### Quality Badge Surface

- **D-09:** Extend `ModelAvailabilityDisclosure.svelte` — add a backtest status row per horizon. This component is already rendered inside Calendar* cards; no new component, no new slots. Status values: PASS / FAIL / PENDING / UNCALIBRATED.
- **D-10:** Extend `data_freshness_v` SQL view — add forecast cascade stage rows. No new SSR subrequest needed in `+page.server.ts`; `FreshnessLabel.svelte` surfaces the badge automatically.

### Claude's Discretion

- Exact CLI flag names for `--train-end` / `--eval-start` in each `*_fit.py` script (planner will check existing CLI signatures and add flags only where missing)
- DB column additions to `forecast_quality` needed for `rolling_origin_cv` rows (planner will assess if current schema covers it or if a migration adding `fold_index`, `train_end_date`, `eval_start_date` columns is needed)
- Whether `run_all.py` reads `feature_flags` per model on startup via a single bulk query or lazy per-model check
- Exact `data_freshness_v` extension approach (new UNION branch vs. separate view joined in)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §BCK-01..BCK-08 — 8 backtest requirements, all pending, all Phase 17

### Database Schema
- `supabase/migrations/0051_forecast_quality.sql` — `forecast_quality` table schema; has `evaluation_window` column that Phase 17 uses for `rolling_origin_cv` rows
- `supabase/migrations/0061_feature_flags.sql` — `feature_flags` table schema + explicit Phase 17 comment ("Phase 17 will extend this table with backtest-gate rows without schema regret")

### Forecast Pipeline
- `scripts/forecast/run_all.py` — orchestrator that Phase 17 extends (feature_flags read at startup, `evaluate_last_7` call site shows where `backtest.py` integration lands)
- `scripts/forecast/last_7_eval.py` — existing eval script; `backtest.py` follows its `compute_metrics()` pattern and DB write conventions
- `scripts/forecast/naive_dow_fit.py` — existing naive baseline; `naive_dow_with_holidays.py` is a new companion script, NOT a modification of this file
- `scripts/forecast/requirements.txt` — `statsforecast>=1.7,<2` already present; `ConformalIntervals` available without new dep

### GHA Workflows
- `.github/workflows/forecast-refresh.yml` — pattern to follow for new `forecast-backtest.yml` (permissions, concurrency, python setup, env vars)

### Frontend / UI
- `src/lib/components/ModelAvailabilityDisclosure.svelte` — component to extend for quality badge rows (D-09)
- `src/lib/components/FreshnessLabel.svelte` — existing staleness badge that auto-surfaces when `data_freshness_v` returns stale stages (D-10)
- `src/routes/+page.server.ts` — freshness SSR load function; reads `data_freshness_v` (D-10 extends this view, not this file)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/forecast/last_7_eval.py` `compute_metrics()`: Pure function computing RMSE, MAPE, mean_bias, direction_hit_rate from numpy arrays. `backtest.py` reuses it directly per fold.
- `supabase/migrations/0061_feature_flags.sql` `feature_flags` table: `(restaurant_id, flag_key)` PK already partitions per flag — Phase 17 inserts per-model rows without schema migration regret.
- `src/lib/components/FreshnessLabel.svelte`: Already color-coded (yellow >30h, red >48h). BCK-08 freshness extension requires only a `data_freshness_v` migration — no component change.
- `statsforecast.ConformalIntervals`: Already available in requirements. Import path: `from statsforecast.utils import ConformalIntervals`.

### Established Patterns
- **Subprocess-per-fit**: `run_all.py` spawns each `*_fit.py` via `subprocess.run()` with explicit `env`. `backtest.py` must follow this pattern per fold; add `--train-end` / `--eval-start` flags to each `*_fit.py` (check existing CLI parsers first).
- **`evaluation_window` column**: `forecast_quality` already has this column. Phase 14 writes `'last_7_days'`; Phase 17 writes `'rolling_origin_cv'`. No schema change needed for that distinction.
- **`contents: read` in all current forecast workflows**: `forecast-backtest.yml` is the ONLY workflow that needs `contents: write` (for ACCURACY-LOG commit). Keep other workflows at `contents: read`.
- **RLS bypass via service_role**: All existing Python DB writes use the service_role key. `backtest.py` and the gate script follow the same pattern via `scripts/forecast/db.py`.

### Integration Points
- `run_all.py` startup: add a `_get_enabled_models(client, restaurant_id)` call that queries `feature_flags WHERE flag_key LIKE 'model_%' AND enabled=true` — returns the effective enabled-models list, replacing (or supplementing) `FORECAST_ENABLED_MODELS` env var.
- `ModelAvailabilityDisclosure.svelte`: reads backtest status from a new `forecast_quality_summary_v` view or from the existing `forecast_quality` table via `/api/forecast` payload expansion — planner decides the data path.
- `data_freshness_v`: add a UNION branch for `forecast` stage rows sourced from `pipeline_runs` (where `step_name IN ('forecast_run_all', 'forecast_backtest')`) — `FreshnessLabel.svelte` renders automatically.

</code_context>

<specifics>
## Specific Ideas

- `docs/forecast/ACCURACY-LOG.md` honest-failure language (from ROADMAP SC5): "naive-DoW-with-holidays remains production model — no challenger promoted this week" — this exact wording should appear when no model passes the gate.
- `ConformalIntervals(h=35, n_windows=4)` — these exact parameters are specified in BCK-01; do not change them.
- GHA schedule for `forecast-backtest.yml`: `cron: '0 23 * * 2'` (Tuesday 23:00 UTC) — matches BCK-05 spec.
- `forecast-quality-gate.yml` triggered on `paths: ['scripts/forecast/**']` — runs on every forecast-engine PR.
- Gate threshold: ≥10% RMSE improvement vs. the HIGHER of naive_dow and naive_dow_with_holidays RMSE at each horizon — exact per BCK-03.

</specifics>

<deferred>
## Deferred Ideas

- **Sunday zeros hotfix** — `closed_days.py` Sunday mask needs updating for the restaurant that shifted to 7-day operation (Sundays marked as closed in historical training data; shop now open 7 days/week since Feb/Mar). This affects ALL forecasts, not just backtests. The backtest gate's relative RMSE comparison remains valid even with Sunday zeros — all models are equally wrong. Fix belongs in a standalone pipeline patch before Phase 17's first weekly backtest run to prevent contaminated baselines.
- **Conformal CI rendering in Calendar* charts** — Phase 17 writes calibrated CI bounds to the DB; rendering them as narrower/wider chart confidence bands is Phase 18+ territory.
- **Phase 18+ quality dashboard** — A dedicated model quality view beyond the ModelAvailabilityDisclosure rows.

</deferred>

---

*Phase: 17-Backtest Gate & Quality Monitoring*
*Context gathered: 2026-05-06*
