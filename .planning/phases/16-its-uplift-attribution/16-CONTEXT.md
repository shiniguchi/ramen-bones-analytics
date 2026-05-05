# Phase 16: ITS Uplift Attribution — Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship a single dedicated `CampaignUpliftCard` on the dashboard that answers **"did the 2026-04-14 campaign work?"** via a **Track-B counterfactual fit on pre-campaign era only**, with cumulative `actual − Track-B` per campaign window, 95% Monte Carlo CIs (1000 bootstrap resamples from 200 stored sample paths), and **honest "CI overlaps zero — no detectable lift" labeling** when warranted.

**Concrete deliverables:**

1. `campaign_calendar` table — schema per 12-PROPOSAL §7 lines 867-880 with `tenant_id → restaurant_id` rename (Phase 12 D-03 / CI Guard 7); seeded with the 2026-04-14 friend-owner campaign as the first row; tenant-scoped read via `auth.jwt()->>'restaurant_id'`; writes via `service_role` / Supabase Studio (admin form deferred to v1.4).
2. `baseline_items_v` view — items first seen ≥7 days before the tenant's earliest `campaign_calendar.start_date`. Schema per 12-PROPOSAL §7 lines 787-804.
3. `kpi_daily_with_comparable_v` view — extends `kpi_daily_mv` with a `revenue_comparable_eur` column derived from `baseline_items_v ⋈ stg_orderbird_order_items`. Schema per 12-PROPOSAL §7 lines 806-825.
4. `counterfactual_fit.py` — fits each of the 5 BAU models on pre-campaign data only (`TRAIN_END = min(campaign_calendar.start_date) − 7 days`), writes `forecast_track='cf'` rows to `forecast_daily` with `pipeline_runs.fit_train_end` recording the cutoff per refit. Wired into `scripts/forecast/run_all.py` via a `--track={bau,cf,both}` flag (default `both`).
5. `cumulative_uplift.py` — runs nightly after Track-B fits complete; computes per-campaign-window `Σ(actual − Track-B)` from `forecast_with_actual_v` joined to `campaign_calendar`; writes outcomes accessible via `campaign_uplift_v`.
6. `campaign_uplift_v` view — per-campaign-window cumulative uplift in EUR with 95% MC CI (1000 bootstrap resamples from `forecast_daily.yhat_samples` — 200 stored paths × 5 resampling = 1000 inferred samples per window) AND a `naive_dow_uplift_eur` cross-check column; cumulative-since-launch as a running total per `(campaign, model)`.
7. `feature_flags` table per 12-PROPOSAL §7 lines 1122-1140 (rename `tenant_id → restaurant_id`); Phase 17 extends with backtest-gate rows. One row inserted at migration time: `(restaurant_id, 'offweek_reminder', false, 'fire on 2026-10-15 to re-anchor the counterfactual')`.
8. `/api/campaign-uplift` endpoint — extend the Phase 15 stub (URL stable per Phase 15 D-08); reads from `campaign_uplift_v`; returns per-campaign cumulative uplift, 95% CI bounds, naive_dow cross-check, last_run.
9. `CampaignUpliftCard.svelte` — slots between `InvoiceCountForecastCard` and `DailyHeatmapCard` on the dashboard; hero number + inline cumulative-uplift sparkline (LayerChart `Spline` + low-opacity `Area` CI band) + tap-to-pin tooltip explaining the 7d anticipation buffer + "CI overlaps zero" honest label rule when applicable.
10. `EventMarker.svelte` campaign-start sourcing — wire `campaign_calendar` rows into `/api/forecast`'s `events` array (currently sources holiday / school / recurring / transit_strike at `src/routes/api/forecast/+server.ts:163-170` but NOT `campaign_start`). The component itself ships in Phase 15 with the `campaign_start` marker type already.
11. CI grep guard — forbid Track-B fits on raw `revenue_eur`; enforces "fit on `revenue_comparable_eur` only" per ROADMAP SC#3. New row in `scripts/ci-guards.sh`.
12. Sensitivity-analysis log at `tests/forecast/cutoff_sensitivity.md` — uplift estimate at multiple cutoffs (`-14d`, `-7d`, `-1d`) per ROADMAP SC#2.

**Out of scope (deferred):**

- Rolling-origin CV backtest gate (Phase 17 — `evaluation_window='rolling_origin_cv'` rows).
- Conformal interval calibration (Phase 17).
- Admin form for `campaign_calendar` writes (v1.4 — Studio writes for v1).
- ConformalIntervals or formal trend-test for ITS validity (Phase 17 backtest harness handles this).
- Automatic 2026-10-15 reminder UI banner — surfaces as one InsightCard narrative line, not a banner.
- BSTS / CausalImpact retro deep-dive (12-PROPOSAL §6 row 10 — out of scope, retro-only).
- New marker types on `EventMarker` beyond what Phase 15 ships.
- Campaign markers on `CalendarRevenueCard` / `CalendarCountsCard` overlays (Phase 15 deliberately scoped calendar overlays to forecast lines + CI bands only).

</domain>

<decisions>
## Implementation Decisions

### Carry-forward (re-stated for downstream agents)

- **C-01 — `tenant_id → restaurant_id` rename rule (Phase 12 D-03 / Guard 7).** Every `campaign_calendar`, `baseline_items_v`, `kpi_daily_with_comparable_v`, `feature_flags`, `campaign_uplift_v` schema sketch from 12-PROPOSAL §7 must mechanically rename `tenant_id` to `restaurant_id` (column AND `auth.jwt()->>'tenant_id'` filter expressions).
- **C-02 — UTC cron contract (Phase 12 D-12).** `forecast-refresh.yml` weekly schedule from Phase 15 D-16 (`0 7 * * 1` UTC) keeps. Track-B fits and `cumulative_uplift.py` run as additional steps inside the same workflow — no new cron file. Guard 8 still enforces.
- **C-03 — `pipeline_runs` writes (Phase 13 pattern).** Each Track-B model fit writes one row with `step_name='cf_<model>'` and `fit_train_end` populated (new column added in this phase). `cumulative_uplift.py` writes `step_name='cumulative_uplift'`. `feature_flags` reminder fires writing `step_name='offweek_reminder'`, `status='reminder'`.
- **C-04 — Anticipation cutoff −7d (Phase 12 D-01).** `TRAIN_END = min(campaign_calendar.start_date) − 7 days`. Hard-coded behavior in `counterfactual_fit.py`. CI test asserts no `forecast_track='cf'` row was written using a `fit_train_end ≥ min(campaign_calendar.start_date)`.
- **C-05 — Sample-path resampling server-side (Phase 14 C-05).** Clients receive only aggregated mean + 95% CI. Never raw sample arrays. `campaign_uplift_v` returns aggregated CI bounds only.
- **C-06 — Hybrid RLS (Phase 14 C-06).** All new tables/views: `auth.jwt()->>'restaurant_id'` filter; `REVOKE ALL` on any new MV from `authenticated`/`anon`; wrapper view-only access from SvelteKit.
- **C-07 — `forecast_track='cf'` semantics (Phase 14 D-12).** CF rows already supported in `forecast_daily` schema (migration 0050) and `forecast_daily_mv` discriminator (0053, 0057). Phase 16 just starts populating them.
- **C-08 — Phase 15 D-08 endpoint URL stability.** `/api/campaign-uplift` URL contract stays. Phase 16 extends the response payload; the existing single-number `cumulative_deviation_eur` field stays for back-compat, plus new fields: `ci_lower`, `ci_upper`, `naive_dow_uplift_eur`, `model`, `campaigns[]`.
- **C-09 — `EventMarker.svelte` carry-forward (Phase 15 D-09 / FUI-05).** Component already ships with `campaign_start` marker type and is slotted in `RevenueForecastCard.svelte:174` + `InvoiceCountForecastCard.svelte:174`. Phase 16 adds the data source in `/api/forecast/+server.ts:163-170`.
- **C-10 — `granularity` discriminator (Phase 15 D-15).** `forecast_daily` already has `granularity` in PK (migration 0057). Phase 16's CF fits write `granularity='day'` only — daily fit is the ITS contract; weekly/monthly are summed in `campaign_uplift_v`.
- **C-11 — Localhost-first UI verification (Phase 15 D-12 / `.claude/CLAUDE.md`).** `CampaignUpliftCard.svelte` MUST be verified via Chrome MCP at `localhost:5173` BEFORE any DEV deploy QA.
- **C-12 — `Tooltip.Root` snippet contract (Phase 15 D-05).** Tap-to-pin tooltip uses `{#snippet children({ data })}` form; never `let:data`.
- **C-13 — `touchEvents: 'auto'` on LayerChart `<Chart>` wrapper (Phase 15 D-13).**

### NEW Phase 16 decisions

- **D-01 — `campaign_calendar` schema.**

  Mechanical port of 12-PROPOSAL §7 lines 867-880 with the `tenant_id → restaurant_id` rename. Fields: `campaign_id text PK`, `restaurant_id uuid NOT NULL REFERENCES restaurants(id)`, `start_date date NOT NULL`, `end_date date NOT NULL`, `name text`, `channel text` (e.g., 'instagram'), `notes text`. RLS `auth.jwt()->>'restaurant_id'` for select; no insert/update/delete policy (Studio writes via service_role only). Migration seeds the 2026-04-14 row with `name='First paid Instagram campaign'`, `channel='instagram'`.

- **D-02 — `baseline_items_v` derivation.**

  Items first seen ≥7 days BEFORE the tenant's earliest `campaign_calendar.start_date`. The 7-day buffer matches C-04 anticipation cutoff. Schema per 12-PROPOSAL §7 lines 787-804 with `tenant_id → restaurant_id` rename. Driven by `min(occurred_at::date)` over `stg_orderbird_order_items` grouped by `(restaurant_id, item_name)`.

- **D-03 — `kpi_daily_with_comparable_v` (NOT a new MV).**

  Wrapper view extending `kpi_daily_mv` with a `revenue_comparable_eur` column from `stg_orderbird_order_items ⋈ baseline_items_v` per 12-PROPOSAL §7 lines 806-825. Reasoning: `kpi_daily_mv`'s shape is load-bearing for the entire dashboard; the comparable column is a Track-B-only concern; views are cheaper than dedicated MVs at 1-tenant scale. Counterfactual fits read from this view; calendar/forecast cards continue reading `kpi_daily_mv` unchanged.

- **D-04 — CI grep guard for raw-revenue Track-B regression.**

  New `scripts/ci-guards.sh` row asserts `counterfactual_fit.py` (or any file in `scripts/forecast/`) does NOT contain `kpi_name='revenue_eur'` in a query that writes `forecast_track='cf'`. The CF write must always read from `kpi_daily_with_comparable_v.revenue_comparable_eur`. Implements ROADMAP SC#3.

- **D-05 — `pipeline_runs.fit_train_end` audit column.**

  New nullable `date` column on `pipeline_runs` via migration. Populated by every `cf_*` step row; NULL for BAU rows (back-compat). CI test asserts no `forecast_track='cf'` row in `forecast_daily` has its `(restaurant_id, model_name, run_date)` matching a `pipeline_runs.fit_train_end ≥ min(campaign_calendar.start_date)`.

- **D-06 — `counterfactual_fit.py` orchestration.**

  Extend `scripts/forecast/run_all.py` with a `--track={bau,cf,both}` flag (default `both`). Reuses the existing per-model fit modules — each model gets a `fit_track_b()` function that takes `train_end` and writes `forecast_track='cf'` rows. KISS over a parallel orchestrator.

- **D-07 — Track-B granularity: daily fit only.**

  `granularity='day'` for all `forecast_track='cf'` rows. Weekly/monthly windows are summed inside `campaign_uplift_v` from daily uplift. Matches the "uplift is computed daily then summed per window" semantics. Avoids the 3× compute cost of fitting CF at all 3 grains separately and the ITS-attribution-at-monthly-grain interpretation problem.

- **D-08 — `campaign_uplift_v` schema + 1000-MC-CI strategy.**

  Per-row key: `(restaurant_id, campaign_id, model_name, window_kind)` where `window_kind ∈ {'campaign_window', 'cumulative_since_launch'}`. Columns:
  - `cumulative_uplift_eur` — `Σ(actual_value − yhat)` over the window
  - `ci_lower_eur`, `ci_upper_eur` — 95% bounds from 1000 bootstrap resamples
  - `naive_dow_uplift_eur` — sanity cross-check using `model_name='naive_dow'` track-B
  - `n_days`, `as_of_date`

  **1000-MC-CI implementation:** Phase 14 D-04 stores 200 sample paths per `forecast_daily` row in `yhat_samples jsonb`. The 95% CI for the windowed sum is computed inside `cumulative_uplift.py` by drawing 1000 bootstrap resamples from the 200 stored paths (sample-with-replacement at the path level), summing each bootstrap's `(actual − sample_path)` over the window, and taking the 2.5%/97.5% quantiles. Read-once-write-once into `campaign_uplift_v` via a backing table or daily refresh — implementation choice deferred to planner. UPL-04's "1000 Monte Carlo CIs from 1000 sample paths" is satisfied as 1000 bootstrap resamples; storage stays at 200 paths per row (Phase 14 D-04 unchanged).

- **D-09 — `naive_dow_uplift_eur` UI surfacing rule.**

  Column lives in `campaign_uplift_v` per UPL-05. `CampaignUpliftCard` surfaces it ONLY as a divergence warning when:
  - SARIMAX uplift sign differs from naive uplift sign, OR
  - `|sarimax_uplift − naive_uplift| / max(|sarimax_uplift|, 1) > 0.5` (>50% magnitude divergence)

  Otherwise hidden from the card; available in API/SQL for QA. Default state shows SARIMAX uplift as the headline. Avoids cluttering the card with a noise number when models agree.

- **D-10 — `feature_flags` table + off-week reminder mechanism.**

  Introduce now per 12-PROPOSAL §7 lines 1122-1140 (`tenant_id → restaurant_id` rename). Phase 17 extends with backtest-gate rows — no schema regret. Migration seeds one row: `(restaurant_id, 'offweek_reminder', false, '2026-10-15')`. The `cumulative_uplift.py` script checks the flag's date column on every run; on or after 2026-10-15 with `enabled=false`, fires:
  1. `pipeline_runs` row with `step_name='offweek_reminder', status='reminder', error_msg='Time to plan an off-week to re-anchor the counterfactual'`
  2. Insight narrative line — Phase 16 extends the next nightly InsightCard generation prompt to include the active reminder. Existing InsightCard narrative pipeline (Phase 5) already handles arbitrary text injection.

  After insertion, the script flips `feature_flags.enabled=true` to prevent repeat firings (until quarterly re-arm — out of scope for this phase, manual flip).

- **D-11 — `CampaignUpliftCard` placement and visualization.**

  **Placement:** Slot between `InvoiceCountForecastCard` and `DailyHeatmapCard` on `+page.svelte`. Mental model: "where revenue is going (forecast) → tx count (forecast) → did the campaign cause it? (uplift) → look-back KPIs". Wrapped in `LazyMount` per Phase 11 D-03.

  **Visual:** Hero number ("Cumulative uplift since 2026-04-14: +€X,XXX" or "CI overlaps zero — no detectable lift") + inline 280px-wide cumulative-uplift sparkline (LayerChart `Spline` + low-opacity `Area` CI band, `fill-opacity={0.06}` matching Phase 15 D-17). Tap-to-pin tooltip via `Tooltip.Root` snippet contract (Phase 15 D-05) explaining the 7d anticipation buffer in plain language. Mobile-first KISS — owner reads one number; sparkline is secondary context for shape-of-uplift.

  **Honest-label rule (UPL-06):** When `ci_lower_eur ≤ 0 ≤ ci_upper_eur` for the sarimax uplift, the hero number is replaced with "CI overlaps zero — no detectable lift" and the point estimate appears below in a dimmer style as `±€X,XXX (95% CI)`. Never show a single-point estimate without its CI band.

- **D-12 — `EventMarker` campaign-start data source.**

  Extend `/api/forecast/+server.ts:163-170` `events` array with rows from `campaign_calendar` mapped to `{ type: 'campaign_start', date, label }`. The wrapper-view query that produces `holidayRows`, `schoolRows`, `recurRows`, `transitRows` adds a fifth: `campaignRows` from `campaign_calendar`. `clampEvents()` already handles `campaign_start` (priority 5 — highest) per `src/lib/forecastEventClamp.ts:25`. EventMarker renders red 3px vertical line per FUI-05 visual encoding.

  **Out of scope this phase:** Wiring EventMarker into `CalendarRevenueCard` / `CalendarCountsCard`. Phase 15 deliberately scoped calendar overlays to forecast lines + CI bands only; EventMarker layout assumes the time-scale forecast card chart wrapper.

- **D-13 — Sensitivity-analysis log structure.**

  `tests/forecast/cutoff_sensitivity.md` — committed once during Phase 16 plan execution. Generates by running `counterfactual_fit.py --train-end-offset {-14,-7,-1}` against the 5 BAU models on revenue_comparable_eur, then summing each result over the 2026-04-14 → today window. Markdown table: rows = `(model, cutoff_offset)`, columns = `cumulative_uplift_eur`, `ci_lower`, `ci_upper`. Demonstrates ITS robustness (or lack thereof) to anticipation-buffer choice.

### Claude's Discretion

- Migration numbering: 0058 → 0063 (continues after 0057). Planner picks exact slot per dependency order.
- Order of migrations: `campaign_calendar` → `baseline_items_v` → `kpi_daily_with_comparable_v` → `feature_flags` → `campaign_uplift_v` → `pipeline_runs.fit_train_end` ALTER (one migration per logical unit, Phase 14 invariant).
- Exact 1000-bootstrap algorithm in `cumulative_uplift.py` — sample-with-replacement at the path level; planner can refine to a Bayesian-bootstrap or per-day path-resampling if statistically preferable.
- `campaign_uplift_v` backing — direct view over `forecast_daily` joined to `campaign_calendar` + actuals, OR a `campaign_uplift` table populated nightly by `cumulative_uplift.py` with a wrapper view. Planner picks based on query-cost analysis.
- `CampaignUpliftCard` exact pixel sizing, typography, and the "CI overlaps zero" copy phrasing — UI auditor reviews at localhost-first gate.
- Whether `cumulative_uplift.py` is one orchestrator script or split per-campaign / per-model — KISS default is single script; planner can split if test-isolation demands.
- Quarterly off-week reminder copy text — first-pass placeholder; product copy refinement deferred.

</decisions>

<specifics>
## Specific Implementation Pointers

- **2026-04-14 campaign metadata.** Friend-owner's first paid Instagram campaign. Seed `campaign_calendar` with `(campaign_id='friend-owner-2026-04-14', restaurant_id=<friend_owner_uuid>, start_date='2026-04-14', end_date='2026-04-14', name='First paid Instagram campaign', channel='instagram', notes='Hardcoded campaign date pre-Phase 16; now generalized via campaign_calendar')`.
- **Noise items (already filtered by `tools/its_validity_audit.py`).** Onsen EGG, Tantan, Hell beer launched in the campaign era; `baseline_items_v` excludes them via the "first seen ≥7 days before campaign start" rule. Pop up menu is stochastic noise (per `NOISE_ITEMS = {"pop up menu"}` at `tools/its_validity_audit.py:53`); keep that exclusion list aligned with `baseline_items_v` semantics or document that the `_v` derivation already accomplishes the same exclusion.
- **`forecast_daily.yhat_samples` stays at 200 paths.** Phase 14 D-04 storage budget unchanged. The 1000-MC-CI in UPL-04 is satisfied via bootstrap resampling inside `cumulative_uplift.py`, not via increased storage.
- **`forecast_with_actual_v` already joins forecast + actual KPIs.** Phase 14 migration 0054. `campaign_uplift_v` joins this against `campaign_calendar` for windowed sums, plus `forecast_daily.yhat_samples` for the bootstrap CI.
- **`/api/campaign-uplift` is the single API consumer.** SvelteKit `CampaignUpliftCard.svelte` self-fetches on mount via `LazyMount`. No SSR load-function blocking.
- **`forecast_track='cf'` MV row count growth.** 5 models × 1 grain (day) × 2 KPIs (revenue_comparable, invoice_count) × ~365 days × 1 tenant = ~3650 rows per refresh added to `forecast_daily_mv`. Total MV row count after Phase 16: existing BAU (5 × 3 × 2 × ~365) + CF (~3650) ≈ ~14,600 rows. Well within Supabase free tier.
- **`cumulative_uplift.py` runs LAST in the cascade.** Inside `forecast-refresh.yml` workflow: ingest → BAU fits → CF fits → `cumulative_uplift.py` → MV refresh via `refresh_forecast_mvs()`. Each step writes `pipeline_runs`; freshness propagates per Phase 14 D-12 / Phase 13 pattern.
- **Card divergence-warning threshold tuning.** D-09's >50% threshold and sign-disagreement rule are first-pass; UI auditor + first real campaign data may suggest tightening to 30% or adding a magnitude-floor (uplift > €100/day to trigger). Planner can adjust based on a synthetic-data smoke test.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor) MUST read these before planning or implementing.**

### Driving artifacts
- `.planning/ROADMAP.md` "Phase 16: ITS Uplift Attribution" — 6 success criteria, 7 requirements (UPL-01..UPL-07)
- `.planning/REQUIREMENTS.md` UPL-01..UPL-07 (lines 193-199) — the seven requirements Phase 16 closes

### Locked decisions from prior phases
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §7 lines 787-825 — `baseline_items_v` + `kpi_daily_with_comparable_v` SQL sketches (apply C-01 rename)
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §7 lines 827-865 — `forecast_daily` + `forecast_quality` schema (already shipped Phase 14, referenced for column layout)
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §7 lines 867-902 — `campaign_calendar` + `campaign_uplift_v` SQL sketches (apply C-01 rename)
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §7 lines 1122-1140 — `feature_flags` table sketch (apply C-01 rename)
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §11 lines 957-964 — Honest framing rule for "uplift" vs "deviation from forecast" (load-bearing label discipline)
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §13 — ITS validity assumptions, concurrent-intervention warnings, anticipation cutoff rationale
- `.planning/phases/12-forecasting-foundation/12-CONTEXT.md` — D-01 (anticipation cutoff −7d), D-03 (rename rule), D-12 (UTC cron), D-13 (cascade gap ≥60min), D-14 (Guard 8 enforcement)
- `.planning/phases/14-forecasting-engine-bau-track/14-CONTEXT.md` — D-04 (200 sample paths), D-05 (latest-run-only janitor), D-09 (env-var feature flag), D-12 (workflow_dispatch from ingest), D-15 (native simulation for SARIMAX/Prophet), D-16 (bootstrap residuals for ETS/Theta/Naive), D-17 (`exog.py`), D-18 (3-tier weather cascade)
- `.planning/phases/15-forecast-backtest-overlay/15-CONTEXT.md` — D-08 (`/api/campaign-uplift` URL stable through Phase 16), D-15 (`granularity` discriminator), D-16 (weekly Monday cron), D-09 (EventMarker shipped with `campaign_start` type), D-13 (touchEvents 'auto'), D-12 (localhost-first gate), C-13 (Tooltip.Root snippet)
- `.planning/phases/11-ssr-perf-recovery/11-CONTEXT.md` — D-03 (deferred /api/* + LazyMount + clientFetch pattern)

### Project-level
- `.planning/STATE.md` "v1.3 Strategic Decisions" — sample-path mandate, Prophet yearly_seasonality pin, exog leakage guard
- `.planning/STATE.md` "Load-Bearing Architectural Rules" §4 — GHA schedules Python; pg_cron schedules SQL refreshes only; communication via `pipeline_runs`
- `.planning/PROJECT.md` — non-negotiables: $0/mo budget, multi-tenant-ready, RLS on every new table, mobile-first 375px
- `CLAUDE.md` (project root) — localhost-first UI verification, planning-docs drift gate, no `Co-authored-by: Claude` in commits
- `.claude/CLAUDE.md` — Stop hook localhost-qa-gate; planning-docs drift validator

### Migration patterns
- `supabase/migrations/0010_cohort_mv.sql` — canonical `auth.jwt()->>'restaurant_id'` RLS pattern
- `supabase/migrations/0050_forecast_daily.sql` — `forecast_track`, `yhat_samples`, generated `horizon_days` (already in place)
- `supabase/migrations/0053_forecast_daily_mv.sql` — wrapper-view + REVOKE pattern
- `supabase/migrations/0055_refresh_forecast_mvs.sql` — RPC pattern; Phase 16 reuses (no new RPC)
- `supabase/migrations/0057_forecast_daily_granularity.sql` — `granularity` discriminator already in PK; Phase 16 writes `granularity='day'` for CF
- `supabase/migrations/0040_drop_analytics_crons.sql` — ingest-driven refresh model; Phase 16 follows
- `supabase/migrations/0046_pipeline_runs_extend.sql` — pattern for ALTER on `pipeline_runs`

### CI guards
- `scripts/ci-guards.sh` Guards 1-8 — Guard 7 (`tenant_id` regression) + Guard 8 (cron schedule) apply to Phase 16 migrations and workflows
- `scripts/ci-guards/check-cron-schedule.py` — already lists `forecast-refresh` as a cascade stage
- NEW Guard 9 (D-04) — forbid Track-B fits on raw `revenue_eur`; enforce `kpi_daily_with_comparable_v.revenue_comparable_eur` only

### Workflow patterns
- `.github/workflows/forecast-refresh.yml` (Phase 14 + 15 update) — extend with Track-B fit step + `cumulative_uplift.py` step; same `0 7 * * 1` UTC weekly cron (Phase 15 D-16)
- `.github/workflows/its-validity-audit.yml` (Phase 12) — Python + GHA pattern reference

### Existing forecast-adjacent code
- `scripts/forecast/run_all.py` — extend with `--track={bau,cf,both}` flag (D-06)
- `scripts/forecast/{sarimax,prophet,ets,theta,naive_dow}_fit.py` — each gets a `fit_track_b(train_end)` function or a `track` param
- `scripts/forecast/exog.py` (Phase 14 D-17) — reused for CF predict matrix; same 3-tier weather cascade
- `scripts/forecast/sample_paths.py` — bootstrap-resample helper; `cumulative_uplift.py` imports
- `scripts/forecast/db.py` (Phase 14) — Supabase service-role client; Phase 16 reuses
- `scripts/external/pipeline_runs_writer.py` (Phase 13) — extend with `fit_train_end` field (D-05)

### Existing UI surfaces to extend or wire
- `src/routes/api/forecast/+server.ts` lines 163-170 — events array; add `campaign_start` source from `campaign_calendar` (D-12)
- `src/routes/api/campaign-uplift/+server.ts` — extend payload (Phase 15 stub); URL stable per C-08
- `src/lib/forecastConfig.ts` — `CAMPAIGN_START` constant retired (Phase 15 stub-only); `CampaignUpliftCard` reads from API instead. CI grep guard (D-04 / NEW Guard 10) forbids the `2026-04-14` literal reappearing anywhere in `src/`
- `src/lib/components/EventMarker.svelte` — already handles `campaign_start` type; no component changes needed
- `src/lib/components/RevenueForecastCard.svelte:174`, `InvoiceCountForecastCard.svelte:174` — already slot `EventMarker`; auto-pick-up new events
- `src/routes/+page.svelte` — add `<CampaignUpliftCard />` slot inside `LazyMount` between `InvoiceCountForecastCard` (line 286) and `DailyHeatmapCard` (line 312)

### Memory pointers
- `.claude/memory/feedback_svelte5_tooltip_snippet.md` — `Tooltip.Root` + `{#snippet children}` (C-12)
- `.claude/memory/feedback_layerchart_mobile_scroll.md` — `touchEvents: 'auto'` default (C-13)
- `.claude/memory/feedback_localhost_first_ui_verify.md` — Chrome MCP localhost gate (C-11)
- `.claude/memory/feedback_sql_cross_check_per_chart.md` — partition-sum cross-checks; D-08's `naive_dow_uplift_eur` follows this discipline
- `.claude/memory/feedback_chrome_mcp_ui_qa.md` — drive Chrome MCP QA myself on UI fixes
- `.claude/memory/project_silent_error_isolation.md` — verify with auth'd JWT, not just E2E fixtures (applies to wrapper-view RLS testing)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`scripts/forecast/run_all.py`** — extend with `--track` flag (D-06). Per-model fit modules already isolated.
- **`scripts/forecast/exog.py`** (Phase 14 D-17) — `build_exog_matrix(dates, restaurant_id, mode='fit'|'predict')` reused unchanged for CF predict matrix; the 3-tier weather cascade (actual → forecast → climatology) handles long-horizon CF projections naturally.
- **`scripts/forecast/sample_paths.py`** (Phase 14) — bootstrap-residual generator for ETS/Theta/Naive_DoW; `cumulative_uplift.py` imports the same module for the 1000-bootstrap CI computation.
- **`scripts/external/pipeline_runs_writer.py`** (Phase 13) — extend with optional `fit_train_end` field for D-05.
- **`src/lib/components/EventMarker.svelte`** (Phase 15) — already supports `campaign_start` type with red 3px vertical line; Phase 16 just feeds it data.
- **`src/lib/forecastEventClamp.ts:25`** — `clampEvents` already prioritizes `campaign_start: 5` (highest priority); progressive disclosure already correct.
- **`src/routes/api/campaign-uplift/+server.ts`** (Phase 15 stub) — URL contract stable; payload shape extends.
- **`tools/its_validity_audit.py`** (Phase 12) — `NOISE_ITEMS = {"pop up menu"}` and the 14-day-window concurrent-intervention check; `baseline_items_v` (D-02) generalizes the same logic into SQL.
- **`forecast_with_actual_v`** (Phase 14 migration 0054) — RLS-scoped wrapper joining forecast + actuals; `campaign_uplift_v` builds on top.

### Established Patterns
- **One migration per logical unit** — codebase invariant since 0001. Phase 16 follows: 6 migrations (campaign_calendar, baseline_items_v, kpi_daily_with_comparable_v, feature_flags, campaign_uplift_v, pipeline_runs.fit_train_end ALTER).
- **Wrapper view + REVOKE on MVs** — Phase 1 template; Phase 16 follows for any new MV (`campaign_uplift_v` may be a view OR a table+MV pair).
- **Service-role Supabase client for batch writes** — `scripts/forecast/db.py` pattern; CF fits reuse.
- **Per-source try/except → `pipeline_runs` row → continue** — Phase 13/14 failure isolation; CF fits per model follow.
- **Ingest-driven MV refresh** — migration 0040 / Phase 14 D-11; CF rows refreshed alongside BAU via `refresh_forecast_mvs()` RPC.
- **GHA workflow_dispatch + cron** — Phase 13/14 dual trigger; Phase 15 D-16 already scheduled at `0 7 * * 1` UTC.
- **Wrapper-view-only access from SvelteKit** — Phase 1 invariant; CI Guard 1 enforces.

### Integration Points
- **`supabase/migrations/`** receives 6 new migrations (0058–0063 range; planner picks exact slots).
- **`scripts/forecast/`** gets `counterfactual_fit.py` + `cumulative_uplift.py` + extended `run_all.py`.
- **`.github/workflows/forecast-refresh.yml`** extends with Track-B fit step + `cumulative_uplift.py` step (no new workflow file).
- **`tests/forecast/`** receives `cutoff_sensitivity.md` (sensitivity analysis log) + `test_counterfactual_fit.py` + `test_cumulative_uplift.py` + `test_baseline_items_v.py` + extended `tests/integration/tenant-isolation.test.ts` for `campaign_calendar`, `feature_flags`, `campaign_uplift_v`.
- **`scripts/ci-guards.sh`** receives Guard 9 (raw-revenue Track-B regression forbid) + Guard 10 (CAMPAIGN_START literal forbid in src/ outside `campaign_calendar` migration).
- **`src/routes/api/forecast/+server.ts`** receives the 5th event source (`campaign_calendar`).
- **`src/routes/api/campaign-uplift/+server.ts`** receives extended payload.
- **`src/lib/components/CampaignUpliftCard.svelte`** is a NEW component.
- **`src/routes/+page.svelte`** receives one new card slot (between line 286 and line 312).
- **`src/lib/forecastConfig.ts`** — `CAMPAIGN_START` constant retired (deletion); CI grep guard prevents reappearance.

</code_context>

<deferred>
## Deferred Ideas

- **Admin form for `campaign_calendar` writes** — v1.4. V1 uses Supabase Studio.
- **Banner-on-dashboard for the off-week reminder** — current design uses InsightCard narrative line; banner can be added later if owner ignores the line.
- **EventMarker on `CalendarRevenueCard` / `CalendarCountsCard` overlays** — Phase 15 deliberately scoped calendar overlays to forecast-only; if user demand emerges, a future phase wires EventMarker into the calendar cards' SVG layer.
- **Conformal interval calibration for the uplift CI** — Phase 17. Phase 16 uses bootstrap-from-stored-paths only.
- **Rolling-origin CV backtest gate for CF models** — Phase 17 (`evaluation_window='rolling_origin_cv'`).
- **BSTS / CausalImpact retro deep-dive** — out of scope per 12-PROPOSAL §6 row 10 (retro-only, monthly cadence).
- **Quarterly auto-rearming of the off-week reminder** — Phase 16 ships one reminder; quarterly cadence is manual flip until v1.4.
- **Multi-campaign UI** — V1 has one campaign row; `campaign_uplift_v` schema supports many; UI shows them sequentially. If/when the friend runs more campaigns, a campaign selector can be added without schema change.
- **Naive-DoW divergence-warning threshold tuning** — D-09 first-pass threshold (50% magnitude OR sign disagreement); planner/UI auditor may tighten after first real-data smoke test.

</deferred>

---

*Phase: 16-its-uplift-attribution*
*Context gathered: 2026-05-01*
*Decisions follow recs-first working style — user accepted A/B/C/D defaults; no override discussion needed*
