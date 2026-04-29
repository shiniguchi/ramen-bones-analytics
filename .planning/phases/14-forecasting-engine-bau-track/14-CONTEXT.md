# Phase 14: Forecasting Engine — BAU Track - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 14 ships the **nightly forecast engine (BAU track only)** — Python model fits writing 365-day-forward predictions to `forecast_daily`, a last-7-day evaluator populating `forecast_quality`, and a `forecast_daily_mv` materialized view with wrapper view for the SvelteKit app.

Concrete deliverables:

1. `forecast_daily` table (long format) with `forecast_track='bau'` default, `yhat_samples` jsonb (200 sample paths), `exog_signature` jsonb, `horizon_days` generated column — keyed on `(restaurant_id, kpi_name, target_date, model_name, run_date, forecast_track)`.
2. `forecast_quality` table storing per-model nightly evaluation results with `evaluation_window` discriminator (`'last_7_days'` for Phase 14; `'rolling_origin_cv'` added in Phase 17).
3. `forecast_daily_mv` — latest run per `(restaurant_id, kpi_name, target_date, model_name, forecast_track)` with unique index for `REFRESH MATERIALIZED VIEW CONCURRENTLY`; `REVOKE ALL` on `authenticated`/`anon`.
4. `forecast_with_actual_v` — RLS-scoped wrapper view joining forecast + actual KPIs; the only surface the SvelteKit app reads.
5. Five model fits per night: SARIMAX (primary), Prophet (`yearly_seasonality=False`), ETS, Theta, Naive same-DoW. Chronos-Bolt-Tiny + NeuralProphet behind `FORECAST_ENABLED_MODELS` env var (off by default).
6. `last_7_eval.py` — nightly evaluator scoring the last 7 actual days against each BAU model's prior forecast; writes to `forecast_quality`.
7. `forecast-refresh.yml` GHA workflow at `0 1 * * *` UTC; writes `pipeline_runs` rows per model; failure surfaces stale-data badge.
8. `pg_cron` `refresh_analytics_mvs()` extended to include `forecast_daily_mv` (03:00 UTC).
9. One-time weather backfill from 2021-01-01 via Bright Sky for climatological norm computation.

Out of scope: Track-B counterfactual fits (Phase 16), `campaign_calendar`/`campaign_uplift_v` tables (Phase 16), `baseline_items_v`/`revenue_comparable_eur` KPI (Phase 16), rolling-origin CV backtest gate (Phase 17), `feature_flags` DB table (Phase 17), UI (Phase 15).

</domain>

<decisions>
## Implementation Decisions

### Carry-forward from Phase 12/13 (re-stated for downstream agents)

- **C-01 — Mechanical rename rule (Phase 12 D-03):** Every `tenant_id` reference in PROPOSAL §7 schema sketches becomes `restaurant_id`. Every `auth.jwt()->>'tenant_id'` becomes `auth.jwt()->>'restaurant_id'`. CI Guard 7 catches regressions.
- **C-02 — UTC cron schedule (Phase 12 D-12):** `forecast-refresh.yml` at `0 1 * * *` UTC (CET 02:00, CEST 03:00). ≥60-min gap after Phase 13's `external-data-refresh.yml` at `0 0 * * *` UTC. Guard 8 enforces.
- **C-03 — `pipeline_runs` writes (Phase 13 pattern):** Each model fit writes one `pipeline_runs` row with `step_name`, `status`, `row_count`, `upstream_freshness_h`, `error_msg`. Follow Phase 13's `pipeline_runs_writer.py` pattern.
- **C-04 — Prophet yearly_seasonality=False (STATE strategic decision):** Hard-pinned until `len(history) >= 730`. Unit test asserts the flag stays False until 2027-06-11.
- **C-05 — Sample-path resampling mandatory + server-side (STATE strategic decision):** Clients receive only aggregated mean + 95% CI per requested granularity. Never raw sample arrays.
- **C-06 — Hybrid RLS (STATE strategic decision):** `forecast_daily` and `forecast_quality` are tenant-scoped via `auth.jwt()->>'restaurant_id'`. `REVOKE ALL` on MVs from `authenticated`/`anon`.

### Closed-Day Handling (G-01)

- **D-01 — y=NaN + is_open regressor for exog-capable models (SARIMAX, Prophet).** Closed days (`shop_calendar.is_open=false`) are NaN in the target series. `is_open` binary regressor encodes the signal. At predict time, `yhat` is forced to 0 post-hoc for any date where `shop_calendar.is_open=false`.
- **D-02 — No explicit changepoints for the Mon/Tue regime shift.** The `is_open` regressor handles the Feb 3 / Mar 2 2026 closure-to-open transition naturally. No hardcoded changepoint dates in Prophet or step regressors in SARIMAX.
- **D-03 — Filter to open days only for no-exog models (ETS, Theta, Naive DoW).** These train on open-day-only series (NaN rows dropped, contiguous index reset). Predict 365 open-day values; map back to calendar dates using `shop_calendar.is_open=true` dates. Closed dates get `yhat=0`.

### Sample-Path Storage + TTL (G-02)

- **D-04 — 200 sample paths (not 1000).** 200 paths give stable 95% CI percentiles (±0.7% relative error) at ~25 MB per nightly run instead of ~125 MB. Well within the 500 MB Supabase free tier.
- **D-05 — Keep latest run only.** `forecast_daily_mv` collapses to the latest run per key. Historical `forecast_daily` rows keep `yhat`/`yhat_lower`/`yhat_upper` but `yhat_samples` is NULLed for older `run_date`s. Weekly pg_cron janitor: `UPDATE forecast_daily SET yhat_samples = NULL WHERE run_date < (SELECT MAX(run_date) - 1 FROM forecast_daily WHERE restaurant_id = forecast_daily.restaurant_id AND model_name = forecast_daily.model_name)`.

### Weather Regressor Fallback (G-03)

- **D-06 — Climatological norms for long-horizon weather exog.** Multi-year per-day-of-year averages computed from 4-5 years of Berlin historical weather. Standard practice in forecasting literature.
- **D-07 — One-time Bright Sky backfill from 2021-01-01.** Phase 13's `weather_daily` has data from 2025-06-11 onward. Phase 14 backfills 2021-01-01 to 2025-06-10 (~1,600 rows) via Bright Sky historical API. Per-DoY norms computed from the full 4-5 year window. Stored as 366 rows in a `weather_climatology` lookup (or computed inline via SQL).
- **D-08 — 3-tier cascade at predict time.** Exog matrix uses: (1) actual weather for past dates, (2) Bright Sky forecast for days 1-~14, (3) climatological norms for days ~15-365. `exog_signature` jsonb logs the source flavor per row (`'archive'`, `'forecast'`, `'climatology'`).

### Feature Flag Mechanism (G-04)

- **D-09 — Env var only for v1.** `FORECAST_ENABLED_MODELS='sarimax,prophet,ets,theta,naive_dow'` on `forecast-refresh.yml`. Adding a model = one workflow file edit + PR. No `feature_flags` DB table in Phase 14.
- **D-10 — `feature_flags` table deferred to Phase 17.** Phase 17 creates it for the backtest promotion gate. Phase 15 UI reads env-var-controlled model availability from `forecast_daily_mv` (if a model has rows, the UI can show it).

### Claude's Discretion

- Python project structure under `scripts/forecast/` — one file per model, shared helpers, orchestrator; mirrors `scripts/external/` pattern from Phase 13.
- `forecast_quality` table exact column set beyond what PROPOSAL §7 + REQUIREMENTS specify (planner reconciles the §7 sketch with the hover-popup spec's bias + direction_hit_rate fields).
- Migration numbering (continues after Phase 13's 0041-0047; planner picks the next available slot).
- `weather_climatology` storage approach (dedicated lookup table vs inline SQL computation from `weather_daily`).
- Exact SARIMAX order `(p,d,q)(P,D,Q,s)` — PROPOSAL suggests `(1,0,1)(1,1,1,7)` but planner/researcher may tune.
- Exact Prophet `changepoint_prior_scale` and `seasonality_prior_scale` values.
- Per-model error handling (try/except per model like Phase 13's per-source pattern; exit 0 if at least one model succeeds).
- `forecast_quality.evaluation_window` column (not in §7 sketch but required by FCS-07) — planner adds it during schema reconciliation.

</decisions>

<specifics>
## Specific Ideas

- **KPIs forecast in Phase 14:** `revenue_eur` and `invoice_count` only. `revenue_comparable_eur` is deferred to Phase 16 (requires `baseline_items_v` which depends on `campaign_calendar`).
- **`forecast_track` column ships in Phase 14** with `DEFAULT 'bau'` — schema is ready for Phase 16's Track-B without ALTER. The ROADMAP SC#1 explicitly requires this.
- **Per-model `step_name` in `pipeline_runs`:** `forecast_sarimax`, `forecast_prophet`, `forecast_ets`, `forecast_theta`, `forecast_naive_dow`, `forecast_eval_last7`. Deterministic, queryable downstream.
- **Closed-day post-hoc zeroing is a shared utility** — all 5+ models go through the same `zero_closed_days(predictions, shop_calendar)` function. Single source of truth.
- **Weather backfill is a one-time script** (`scripts/forecast/backfill_weather_history.py`), not part of the nightly cron. Run once after Phase 14 lands, before first forecast run.
- **`pg_cron refresh_analytics_mvs()` re-registration:** Migration 0040 dropped the analytics cron. Phase 14 needs to re-register the job to include `forecast_daily_mv` in the refresh DAG at 03:00 UTC — or trigger MV refresh from the forecast GHA workflow via PostgREST RPC (matching the ingest-driven pattern from 0040). Planner picks the approach that aligns with the current trigger-based architecture.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor) MUST read these before planning or implementing.**

### Driving artifacts
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` — 1484-line v1.3 spec; **§7 schema sketches** for `forecast_daily` + `forecast_quality` (apply C-01 rename rule); **§13 two-track architecture** (BAU regressor wiring table per model); **§14 failure modes** + freshness SLO; **§5 prediction lines catalog** (Tier A/B/C priority); **§11 KISS / no-do list** (what NOT to build)
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §7 lines 827-865 — `forecast_daily` and `forecast_quality` SQL sketches (source of truth for column layout; `tenant_id` → `restaurant_id` rename applies)
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §13 lines 1024-1036 — per-model regressor wiring table (which models use which exog columns)

### Locked decisions from prior phases
- `.planning/phases/12-forecasting-foundation/12-CONTEXT.md` — D-01 (anticipation cutoff −7d), D-02 (brightsky default), D-03 (rename rule), D-12 (UTC cron contract), D-13 (cascade gap ≥60 min), D-14 (Guard 8 cron-schedule enforcement)
- `.planning/phases/13-external-data-ingestion/13-CONTEXT.md` — D-04 (`scripts/external/` file layout), D-05 (fetcher return signature), D-06/D-07 (failure isolation + exit-code semantics), D-08/D-09 (`shop_calendar` schema + loader)

### Project-level
- `.planning/STATE.md` "v1.3 Strategic Decisions (from research synthesis 2026-04-27)" — load-bearing summary; sample-path mandate, Prophet yearly_seasonality pin, exog leakage guard, mobile chart defaults
- `.planning/STATE.md` "Load-Bearing Architectural Rules" §4 — GHA schedules Python; pg_cron schedules SQL refreshes only; communication via `pipeline_runs`
- `.planning/ROADMAP.md` "Phase 14: Forecasting Engine — BAU Track" — six success criteria this CONTEXT.md is bound to
- `.planning/REQUIREMENTS.md` FCS-01..FCS-11 — the eleven requirements Phase 14 closes
- `CLAUDE.md` (project root) — non-negotiables: $0/mo budget, multi-tenant-ready, RLS on every new table

### Migration patterns
- `supabase/migrations/0010_cohort_mv.sql` — canonical `auth.jwt()->>'restaurant_id'` RLS pattern
- `supabase/migrations/0025_item_counts_daily_mv.sql` — latest `refresh_analytics_mvs()` definition (DAG ordering reference)
- `supabase/migrations/0039_pipeline_runs_skeleton.sql` — Phase 12 skeleton; Phase 13 extends in 0046
- `supabase/migrations/0040_drop_analytics_crons.sql` — dropped daily cron; ingest-driven refresh pattern; Phase 14 must decide whether to re-register pg_cron for forecast MV or use RPC trigger

### CI guards
- `scripts/ci-guards.sh` Guards 1-8 — Guard 7 (`tenant_id` regression) + Guard 8 (cron schedule) both apply to Phase 14 migrations and workflows
- `scripts/ci-guards/check-cron-schedule.py` — already lists `forecast-refresh` as a cascade stage; Phase 14's workflow must match

### Workflow patterns
- `.github/workflows/external-data-refresh.yml` (Phase 13) — closest template for `forecast-refresh.yml` (cron + workflow_dispatch + Python + Supabase secrets)
- `.github/workflows/its-validity-audit.yml` (Phase 12) — Python + GHA pattern reference

### Existing forecast-adjacent code
- `scripts/external/` (Phase 13) — Python project structure to mirror (`run_all.py` orchestrator + per-source modules + `pipeline_runs_writer.py` + `db.py`)
- `tools/its_validity_audit.py` (Phase 12) — Python script pattern in repo

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`scripts/external/pipeline_runs_writer.py`** (Phase 13) — shared helper for `pipeline_runs` row writes. Phase 14's forecast scripts reuse the same writer for `step_name='forecast_*'` rows.
- **`scripts/external/db.py`** (Phase 13) — Supabase service-role client setup. Phase 14's `scripts/forecast/db.py` follows the same pattern (or imports directly).
- **`supabase/migrations/0025_item_counts_daily_mv.sql`** — latest `refresh_analytics_mvs()` function body; Phase 14 extends it to include `forecast_daily_mv` in the DAG.
- **`scripts/ci-guards/check-cron-schedule.py`** (Phase 12) — already has `forecast-refresh` in the cascade stage list; Phase 14's `forecast-refresh.yml` cron string must match.
- **`config/shop_hours.yaml`** (Phase 13) — `shop_calendar` source; Phase 14 reads `shop_calendar` table for closed-day handling.
- **Phase 13's `weather_daily` table** — source for both short-range weather forecasts and historical data for climatological norms.

### Established Patterns

- **One migration per logical unit** — codebase invariant since 0001. Phase 14 follows.
- **Service-role Supabase client for batch writes** — `scripts/external/db.py` pattern. Phase 14 adopts.
- **`pipeline_runs` as cascade freshness telemetry** — STATE §4. Every model fit writes one row.
- **Per-source try/except → `pipeline_runs` row → continue** — Phase 13 failure isolation pattern. Phase 14's per-model fits mirror this.
- **GHA workflow_dispatch for manual runs** — Phase 13's backfill input. Phase 14 adds `workflow_dispatch` with optional `models` input for selective re-runs.
- **Ingest-driven MV refresh (migration 0040)** — daily pg_cron dropped; refresh triggered on-demand via PostgREST RPC. Phase 14 may follow this pattern for `forecast_daily_mv`.

### Integration Points

- **`supabase/migrations/`** receives 3-4 new migrations: `forecast_daily`, `forecast_quality`, `forecast_daily_mv` + wrapper view, weather history backfill (optional migration or script).
- **`scripts/forecast/`** (new Python directory) — model fit scripts, orchestrator, evaluator.
- **`.github/workflows/forecast-refresh.yml`** (new) — seventh GHA workflow in repo.
- **`tests/external/` or `tests/forecast/`** (new) — unit tests for model fits, exog assembly, closed-day handling, sample-path generation.
- **`tests/integration/tenant-isolation.test.ts`** — extended with `forecast_daily` and `forecast_quality` cases.
- **`requirements.txt` / `pyproject.toml`** — adds `statsmodels`, `prophet==1.3.0`, `statsforecast`, `utilsforecast` (Chronos + NeuralProphet deps only when feature-flagged on).

</code_context>

<deferred>
## Deferred Ideas

- **Track-B counterfactual fits** — Phase 16. `forecast_track='cf'` rows written by `counterfactual_fit.py` with pre-campaign-only training data.
- **`campaign_calendar`, `campaign_uplift_v`** — Phase 16.
- **`baseline_items_v`, `revenue_comparable_eur` KPI** — Phase 16.
- **`feature_flags` DB table** — Phase 17. Backtest promotion gate writes `enabled=true` after model passes.
- **Rolling-origin CV backtest** — Phase 17. `forecast_quality` with `evaluation_window='rolling_origin_cv'`.
- **Conformal interval calibration** — Phase 17 (`ConformalIntervals(h=35, n_windows=4)`).
- **NeuralProphet + Chronos-Bolt-Tiny in production** — behind env-var feature flag; enable only after Phase 17 backtest gate confirms ≥10% RMSE improvement.
- **Forecast UI** — Phase 15. `RevenueForecastCard`, horizon toggles, event markers.
- **`/api/forecast` endpoint** — Phase 15. Deferred endpoint behind `LazyMount` per Phase 11 SSR pattern.

</deferred>

---

*Phase: 14-forecasting-engine-bau-track*
*Context gathered: 2026-04-29*
