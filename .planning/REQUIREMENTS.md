# Requirements: Ramen Bones Analytics

**Defined:** 2026-04-13
**Core Value:** A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see.

## v1 Requirements

Requirements for initial release. Each maps to exactly one roadmap phase.

### Foundation (Tenancy, Auth, Security)

- [ ] **FND-01**: Supabase Postgres project initialized with `restaurants` and `memberships` tables (multi-tenant schema from day 1, even though v1 has one tenant)
- [ ] **FND-02**: Custom access token hook injects `restaurant_id` claim into Supabase Auth JWT from `memberships` table
- [x] **FND-03**: RLS policies enforced on every tenant-scoped table using `auth.jwt()->>'restaurant_id'`
- [x] **FND-04**: Security-definer wrapper-view pattern documented and applied to the first materialized view (RLS does not natively propagate to MVs)
- [x] **FND-05**: Two-tenant isolation integration test (seed tenant A and tenant B, assert tenant A session can never read tenant B rows) runs in CI on every PR
- [x] **FND-06**: User can log in with email + password via Supabase Auth and the session persists across browser refreshes
- [x] **FND-07**: Card-hash customer identifier is never stored alongside PAN, PII, or raw card data
- [x] **FND-08**: All timestamps stored as `timestamptz`; every analytical query derives `business_date` from a tenant-configured timezone to eliminate day-boundary drift

### Ingestion (Pre-joined CSV → Transactions)

- [x] **ING-01**: Loader script reads `orderbird_data/5-JOINED_DATA_*/ramen_bones_order_items.csv` (pre-joined per-order-item data) and upserts rows into a Supabase `stg_orderbird_order_items` staging table
- [x] **ING-02**: Ingest is idempotent via natural key `(restaurant_id, source_tx_id)` where `source_tx_id = order_id` — re-running produces zero diffs
- [x] **ING-03**: Normalization promotes staged rows to `transactions` with documented handling of voids, refunds, tips (Trinkgeld), brutto vs netto (VAT), and service charge; `business_date` derived at query time via tenant timezone
- [x] **ING-04**: `card_hash = sha256(wl_card_number || restaurant_id)` computed in the loader before any DB write; cash customers (no Worldline card number) are NULL and excluded from cohort analytics
- [x] **ING-05**: Founder has manually reviewed ≥20 real rows from the CSV to confirm field semantics before any MV is written

### Analytics SQL Models

- [x] **ANL-01**: `cohort_mv` materialized view — the load-bearing trunk — computes first-visit cohort assignment per customer (card hash) with configurable cohort grain (daily / weekly / monthly)
- [x] **ANL-02**: `retention_curve_v` (wrapper over cohort MV) exposes retention rate by cohort × periods-since-first-visit, with survivorship-bias guard (horizon-clip cohorts that haven't had enough elapsed time)
- [x] **ANL-03**: `ltv_mv` / `ltv_v` computes LTV-to-date per cohort with a visible data-depth caveat (3–12 months of history only, no 12-month projection)
- [x] **ANL-04**: `kpi_daily_mv` / `kpi_daily_v` aggregates revenue, transaction count, and avg ticket per business_date
- [x] **ANL-05**: `frequency_v` exposes repeat visit rate and visit-frequency distribution
- [x] **ANL-06**: `new_vs_returning_v` splits revenue and tx count between first-time and repeat customers
- [x] **ANL-07**: All MVs refresh nightly via `pg_cron` using `REFRESH MATERIALIZED VIEW CONCURRENTLY` (unique index mandatory on every MV)
- [x] **ANL-08**: SvelteKit frontend reads ONLY from `*_v` wrapper views — raw tables and MVs have `REVOKE ALL` on `authenticated` role
- [x] **ANL-09**: CI check greps for any frontend query referencing `*_mv` or raw tables directly and fails the build

### Mobile Reader UI (SvelteKit on Cloudflare Pages)

- [x] **UI-01**: SvelteKit 2 + Svelte 5 + `adapter-cloudflare` project deploys to Cloudflare Pages with `@supabase/ssr` for auth
- [x] **UI-02**: Mobile-first layout at 375px baseline — single-column card stream, no desktop-only sidebar
- [x] **UI-03**: Login screen using Supabase Auth (email + password), redirects to dashboard on success
- [x] **UI-04**: Revenue KPI cards (today / this week / this month, avg ticket, tx count) shown at the top of the dashboard
- [x] **UI-05**: First-visit acquisition cohort chart (daily/weekly/monthly toggle) rendered with LayerChart
- [x] **UI-06**: Retention curve chart per cohort, mobile-legible (limited series, touch-friendly tooltips)
- [x] **UI-07**: Customer LTV view with visible data-depth caveat
- [x] **UI-08**: Repeat visit rate + visit-frequency distribution view
- [x] **UI-09**: Preset date-range chips (Today / 7d / 30d / 90d / All) — no custom date-range builder on mobile
- [x] **UI-10**: Empty / sparse-data states handled gracefully (cohorts with too little history show a message, not a broken chart)
- [x] **UI-11**: Every PR verified at 375px viewport before merge

### Insights & Forkability

- [x] **INS-01**: Nightly Supabase Edge Function calls Claude Haiku via Anthropic API with tenant KPI payload and writes a natural-language summary to an `insights` table
- [x] **INS-02**: Prompt and post-generation validation forbid the LLM from emitting numbers not in the input payload (digit-guard regex + deterministic template fallback on validation failure)
- [x] **INS-03**: Dashboard renders the latest insight card for the logged-in tenant; gracefully hides if no insight exists
- [x] **INS-04**: Anthropic API key stored as a Supabase secret; never exposed to client or committed
- [x] **INS-05**: Repository is public and forkable with a README describing one-click deploy (Cloudflare Pages + Supabase project + GHA secrets)
- [x] **INS-06**: `.env.example` documents every required environment variable for self-hosters

## v1.1 Requirements — Dashboard Redesign

**Defined:** 2026-04-15
**Milestone goal:** Replace v1.0 KPI-tile dashboard with a chart-first, richly-filterable analytics surface on a pragmatic star schema.

### Filter Foundation

- [x] **FLT-01**: Custom date-range picker replaces the 5 fixed preset chips; supports both preset shortcuts (7d/30d/90d/All) and an arbitrary from/to selection
- [x] **FLT-02**: Global day / week / month granularity toggle applied consistently across every time-series card (not per-card)
- [x] **FLT-03**: Sales-type dropdown filter (all / INHOUSE / TAKEAWAY) applied across all filterable cards
- [x] **FLT-04**: Payment-method dropdown filter — auto-populated from `SELECT DISTINCT payment_method` at page load, no hardcoded whitelist
- [x] **FLT-05**: Card issuing-country dropdown filter — auto-populated from `SELECT DISTINCT wl_issuing_country`, supports "DE only" / "non-DE only" / individual countries
- [ ] **FLT-06**: Repeater-bucket dropdown filter against `lifetime_bucket` (all / first_timer / 2x / 3x / 4-5x / 6+) — **SUPERSEDED by v1.2** (visit_seq replaces lifetime_bucket approach)
- [x] **FLT-07**: All 6 filters compile to zod-validated query params; no dynamic SQL strings anywhere; SSR load function composes WHERE clauses from validated params only

### Data Model — Column Promotion

- [x] **DM-01**: `transactions` table gains `wl_issuing_country` (char(2)) + `card_type` (text) columns via migration `0018_transactions_country_cardtype.sql`
- [x] **DM-02**: One-shot backfill populates both columns from `stg_orderbird_order_items` first-row-per-invoice, verified against ≥20 invoices
- [x] **DM-03**: CSV loader writes both columns on future ingests, preserving idempotency on re-run

### Data Model — Star Schema (SUPERSEDED by v1.2)

- [ ] **DM-04**: `dim_customer` MV — **SUPERSEDED by v1.2 VA-01** (visit_seq approach replaces star schema)
- [ ] **DM-05**: `fct_transactions` MV — **SUPERSEDED by v1.2 VA-01** (visit-attribution MV replaces fct_transactions)
- [ ] **DM-06**: `fct_transactions` indexes — **SUPERSEDED by v1.2**
- [ ] **DM-07**: `refresh_analytics_mvs()` DAG ordering — **SUPERSEDED by v1.2 VA-01**
- [ ] **DM-08**: `ci-guards` extension — **SUPERSEDED by v1.2 VA-03**

### Chart Rollup MVs (SUPERSEDED by v1.2)

- [ ] **CHT-01**: `mv_new_customers_daily` — **SUPERSEDED by v1.2 VA-04/VA-05**
- [ ] **CHT-02**: `mv_repeater_daily` — **SUPERSEDED by v1.2 VA-04/VA-05**
- [ ] **CHT-03**: `mv_retention_monthly` — **SUPERSEDED by v1.2 VA-06**
- [ ] **CHT-04**: `mv_inter_visit_histogram` — **SUPERSEDED by v1.2**

### Chart Components (SUPERSEDED by v1.2)

- [ ] **CHT-05**: `NewCustomersChart.svelte` — **SUPERSEDED by v1.2 VA-05**
- [ ] **CHT-06**: `RepeaterAttributionChart.svelte` — **SUPERSEDED by v1.2 VA-04**
- [ ] **CHT-07**: `CohortRetentionChart.svelte` — **SUPERSEDED by v1.2 VA-06**
- [ ] **CHT-08**: `InterVisitHistogramChart.svelte` — **SUPERSEDED by v1.2**
- [ ] **CHT-09**: All charts honor 6 filters — **SUPERSEDED by v1.2** (2 filters)
- [ ] **CHT-10**: 375px viewport verification — carried forward as v1.2 standard

### Bug Fixes (SUPERSEDED by v1.2)

- [ ] **BUG-01**: NewVsReturningCard empty on range=all — **SUPERSEDED** (new_vs_returning_v being dropped in VA-03)
- [ ] **BUG-02**: LTV chart sparse bars — **SUPERSEDED** (ltv_v being dropped in VA-03; replaced by VA-07)

## v1.2 Requirements — Dashboard Simplification & Visit Attribution

**Defined:** 2026-04-16
**Milestone goal:** Strip dashboard to 7 core charts with per-transaction visit-count attribution, simplify filters to cash/card + inhouse/takeaway, fix SSR performance lag.

### Data Model

- [ ] **VA-01**: Each transaction has a `visit_seq` integer — the card_hash's nth visit (1st, 2nd, 3rd...) via `ROW_NUMBER() OVER (PARTITION BY card_hash ORDER BY occurred_at)`. Materialized in a new MV with visit-attribution columns, refreshed nightly.
- [ ] **VA-02**: Each transaction has an `is_cash` boolean — derived from payment_method (replaces full payment_method filter granularity with binary cash/card)
- [ ] **VA-03**: Drop unused views/MVs: `frequency_v`, `new_vs_returning_v`, `ltv_v`, country filter UI components (`CountryMultiSelect.svelte`, `_applyCountryFilter`, `wl_issuing_country` on `transactions_filterable_v`). Clean up dead code paths.

### Charts

- [x] **VA-04**: Calendar revenue chart — stacked bars by visit-count bucket (1st/2nd/3rd/4x/5x/6x/7x/8x+) per day/week/month granularity, respects all filters
- [x] **VA-05**: Calendar customer counts chart — same visit-count breakdown per day/week/month, respects all filters
- [x] **VA-06**: Retention curve chart — weekly/monthly first-time acquisition cohort retention rates, respects all filters
- [x] **VA-07**: LTV per customer chart — individual or bucketed customer lifetime value distribution, respects all filters
- [x] **VA-08**: Calendar order item counts chart — broken down by order item name (from `stg_orderbird_order_items.item_name`), per day/week/month, respects all filters
- [x] **VA-09**: First-time date cohort total revenue chart — sum of all lifetime revenue per acquisition cohort (weekly/monthly), respects all filters
- [x] **VA-10**: First-time date cohort average LTV chart — average lifetime value per customer per acquisition cohort (weekly/monthly), respects all filters

### Filters & UX

- [x] **VA-11**: Filters simplified to inhouse/takeaway + cash/card only — all tiles and charts respect both filters (no unscoped reference tiles)
- [x] **VA-12**: Granularity/range toggle is client-side (no full SSR round-trip) — target <200ms perceived response
- [x] **VA-13**: Drop 2 of 3 revenue reference cards — keep 1 revenue card using the active date range/granularity, respects all filters

## v1.3 Requirements — External Data & Forecasting Foundation

**Defined:** 2026-04-27
**Milestone goal:** Ingest free external signals (weather, holidays, events), build a multi-horizon forecasting engine, render forecast overlays on the revenue chart, and attribute campaign uplift via Interrupted Time Series counterfactuals.
**Driver:** Friend-owner started a marketing campaign 2026-04-14; current MDE analysis cannot detect <20% lifts in <6 weeks at current σ. Pre-campaign era 2025-06-11 → 2026-04-13 (10 months) is the natural ITS control period.

### Foundation (Phase 12.0 — Decisions & Guards)

- [ ] **FND-09**: `tools/its_validity_audit.py` committed to repo and runs weekly via GHA cron, surfacing concurrent-intervention warnings (price hikes, hour shifts, new menu items launched coincidentally with the campaign era)
- [ ] **FND-10**: CI grep guard fails the build on `auth.jwt()->>'tenant_id'` references in `supabase/migrations/` — multi-tenant JWT claim in this codebase is `restaurant_id`, not `tenant_id`
- [ ] **FND-11**: All v1.3 cron schedules anchored in UTC (not Berlin local) with ≥60-minute gaps between cascade stages; CI test asserts no schedule overlap under either CET or CEST

### External Data Ingestion (Phase 12.1)

- [ ] **EXT-01**: `weather_daily` table populated from a pluggable provider (default `brightsky` for production, `open-meteo` for local dev — toggled via `WEATHER_PROVIDER` env var) with daily backfill from 2025-06-11 and 7-day-forward forecast
- [ ] **EXT-02**: `holidays` table populated by `python-holidays` covering federal + Berlin (BE) state holidays including Internationaler Frauentag (Berlin only)
- [ ] **EXT-03**: `school_holidays` table populated via raw `httpx` against `ferien-api.de/api/v1/holidays/BE/{year}.json` (replacing the abandoned `ferien-api` PyPI wrapper) — covers all 5-6 BE state-school break blocks per year
- [ ] **EXT-04**: `transit_alerts` table populated from BVG RSS with German keyword matching for `Streik`/`Warnstreik`; primary URL verified during planning, fallback URL documented
- [ ] **EXT-05**: `recurring_events` table populated from a hand-curated `recurring_events.yaml` (15-20 Berlin city events per year); pg_cron annual-refresh reminder fires every September 15 to update the next year
- [ ] **EXT-06**: `pipeline_runs` audit table records every fetch run with `started_at`, `completed_at`, `row_count`, `upstream_freshness_h`, and `success`/`failure` status — readable by downstream forecast Python and by the dashboard freshness badge
- [ ] **EXT-07**: `shop_calendar` table records each restaurant's open/closed days for 365 days forward; closed days are mapped to `NaN` (not zero) before forecast model fits to prevent demand-underestimate bias
- [ ] **EXT-08**: All 5 ingest tables enforce the hybrid-RLS pattern — location-keyed shared tables (`weather_daily`/`holidays`/`school_holidays`/`transit_alerts`/`recurring_events`) use `using (true)`; tenant-scoped tables (`pipeline_runs`/`shop_calendar`/`campaign_calendar`) use `auth.jwt()->>'restaurant_id'`; CI two-tenant isolation test extended to cover them
- [ ] **EXT-09**: `external-data-refresh.yml` GHA workflow runs nightly at 00:00 UTC, completes in <5 min on `ubuntu-latest`, writes to all 5 ingest tables, and populates `pipeline_runs`

### Forecasting Engine — BAU Track (Phase 12.2)

- [ ] **FCS-01**: `forecast_daily` table stores forecasts in long format with columns `(restaurant_id, kpi_name, target_date, model_name, horizon_days, run_date, forecast_track, yhat, yhat_lower, yhat_upper, yhat_samples)` where `forecast_track ∈ {bau, cf}` enables a single schema for both tracks
- [ ] **FCS-02**: SARIMAX (statsmodels) fits nightly with weather/holidays/school-holiday/event exog regressors and writes 365d-forward forecast covering every `(target_date, horizon_days)` combination
- [ ] **FCS-03**: Prophet fits nightly with `yearly_seasonality=False` hard-pinned until `len(history) >= 730 days` — guards against the silent auto-flip at 2026-06-11 fitting Fourier ghosts on a single annual cycle
- [ ] **FCS-04**: ETS, Theta, and a naive same-DoW baseline model all fit nightly producing comparable 365d forecasts in the same `forecast_daily` table
- [ ] **FCS-05**: Chronos-Bolt-Tiny + NeuralProphet fit behind feature flags (off by default in production); CPU-only torch wheel keeps install size under 250 MB on GHA; HuggingFace cache persisted between runs
- [ ] **FCS-06**: SARIMAX exog matrix flavor (`X_train` columns/order ↔ `X_predict` columns/order) verified identical at fit and score time; unit test fails if regressor drift detected between training and inference
- [ ] **FCS-07**: `last_7_eval.py` runs nightly per model, scoring the last 7 actual days against each model's prior 7-day-ahead forecast; results write to `forecast_quality` with `evaluation_window='last_7_days'` and feed the hover-popup accuracy display
- [ ] **FCS-08**: `forecast_daily_mv` materialized view exposes the latest run per `(restaurant_id, kpi, target_date, model, horizon, forecast_track)`; raw MV has `REVOKE ALL` on `authenticated`/`anon`; `forecast_with_actual_v` wrapper view is the only surface the app reads
- [ ] **FCS-09**: `forecast-refresh.yml` GHA workflow runs nightly at 01:00 UTC (≥60 min after external-data), completes <10 min, writes BAU forecasts; failure populates `pipeline_runs` and surfaces a stale-data badge on next dashboard load
- [ ] **FCS-10**: `pg_cron` `refresh_analytics_mvs()` extended to refresh `forecast_daily_mv` after Python writes complete (03:00 UTC), preserving the `REFRESH MATERIALIZED VIEW CONCURRENTLY` + unique-index pattern
- [ ] **FCS-11**: Sample-path resampling for granularity toggle happens server-side: 1000 paths × 365d × N models stored in `yhat_samples jsonb`; client receives only aggregated mean + 95% CI per requested granularity (day/week/month)

### Forecast Chart UI (Phase 12.3)

- [ ] **FUI-01**: `RevenueForecastCard.svelte` renders actual revenue + SARIMAX BAU forecast line + 95% CI uncertainty band on the existing dashboard at 375px
- [ ] **FUI-02**: Chart defaults to 1 forecast line + naive baseline + CI band only; additional models (Prophet, Chronos, NeuralProphet, ensemble median) are toggle-on via `ForecastLegend.svelte` to prevent mobile spaghetti
- [ ] **FUI-03**: `HorizonToggle.svelte` lets the owner switch between `7d` / `5w` / `4mo` / `1yr` horizons; X-axis re-zooms; same forecast table, different slice; default is 7d
- [ ] **FUI-04**: `ForecastHoverPopup.svelte` (tap-to-pin on mobile) shows: forecast value + 95% CI for that date, horizon (days from today), last-7-actual-days RMSE/MAPE/bias/direction-hit-rate, cumulative deviation since campaign launch, last-refit timestamp
- [ ] **FUI-05**: `EventMarker.svelte` overlays vertical lines for campaign-start (red ▌), federal holidays (dashed green |), school-holiday-block boundaries (teal background shading), recurring events (yellow |), BVG strike days (red bar); ≤50 markers default with progressive disclosure for longer horizons
- [ ] **FUI-06**: Granularity toggle (day/week/month) on the forecast card re-buckets forecast samples server-side via `/api/forecast?granularity=`; client receives only mean+CI, never raw 1000-path arrays
- [ ] **FUI-07**: `/api/forecast`, `/api/forecast-quality`, `/api/campaign-uplift` are deferred endpoints behind `LazyMount` per the Phase 11 SSR pattern; all use canonical `locals.safeGetSession()` (not `getClaims()` direct) and set `Cache-Control: private, no-store`
- [ ] **FUI-08**: Empty-state ("Forecast generating, check back tomorrow") shown until first forecast lands; stale-data badge ("Data ≥24h stale — last refresh: …") shown when `pipeline_runs.upstream_freshness_h > 24` for any cascade stage; uncalibrated-CI badge shown for the 365d horizon while history < 2 years
- [ ] **FUI-09**: All v1.3 frontend components verified at `localhost:5173` via Chrome MCP (per `.claude/CLAUDE.md` localhost-first rule) BEFORE any DEV deploy QA

### ITS Uplift Attribution — Track-B Counterfactual (Phase 12.4)

- [ ] **UPL-01**: `campaign_calendar` table records each campaign's `start_date`, `end_date`, `name`, `channel`, and `notes`; tenant-scoped with admin-only writes (V1: seeded via Supabase Studio SQL editor; admin form deferred)
- [ ] **UPL-02**: Track-B counterfactual fits on pre-campaign data only — `TRAIN_END = campaign_start_date − 7 days` (anticipation buffer); `pipeline_runs.fit_train_end` records the cutoff and CI test asserts no campaign-era row is included in any Track-B fit
- [ ] **UPL-03**: `revenue_comparable_eur` derived KPI excludes new menu items launched coincidentally with campaign era (per `tools/its_validity_audit.py` findings 2026-04-27); Track-B fits on this baseline-comparable revenue, not raw revenue
- [ ] **UPL-04**: `campaign_uplift_v` exposes per-campaign-window `Σ(actual − Track-B)` with 95% Monte Carlo CI from 1000 sample paths; cumulative-since-launch shown as a running total per (campaign, model)
- [x] **UPL-05**: `naive_dow_uplift_eur` cross-check column included in `campaign_uplift_v` — sanity check against false positives from trend extrapolation in the declining 10-month pre-period — _closed by Phase 16.1-03 (sarimax-vs-naive_dow divergence warning surfaced inside CampaignUpliftCard disclosure panel as `divergence-warning` testid)_
- [x] **UPL-06**: `CampaignUpliftCard.svelte` renders per-campaign cumulative uplift on the dashboard; never reports a single-point estimate without CI — _closed by Phase 16.1-03 (D-05..D-11 plain-language regime: tier-aware hero replaces literal "CI overlaps zero" string with one of 7 i18n keys; statistical detail with CI bounds available via inline "How is this calculated? ›" disclosure panel; secondary line always pairs point estimate with `lo`/`hi` bounds)_
- [ ] **UPL-07**: `cumulative_uplift.py` runs nightly after Track-B forecast completes; quarterly off-week reminder fires from `feature_flags` table on 2026-10-15 (~6 months post-campaign) to re-anchor the counterfactual

### Backtest Gate & Quality Monitoring (Phase 12.5)

- [x] **BCK-01**: `backtest.py` runs `statsforecast.cross_validation` with rolling-origin folds at 4 horizons (7d / 35d / 120d / 365d), computing RMSE + MAPE per (model × horizon × fold)
- [x] **BCK-02**: `ConformalIntervals(h=35, n_windows=4)` calibrates 95% CIs at horizons ≥35d; long horizons (120d, 365d) carry an `uncalibrated — ≥2 years data needed` UI badge until the 2-year mark
- [x] **BCK-03**: Backtest comparisons use a regressor-aware naive baseline (same exog regressors as competing models) — prevents unfair gate against models that benefit from weather/holidays features
- [x] **BCK-04**: Promotion gate: any model promoted from feature-flag to production must beat naive same-DoW baseline by ≥10% RMSE on rolling-origin out-of-sample, computed per horizon; failure blocks the deploy workflow
- [x] **BCK-05**: `forecast-backtest.yml` GHA workflow runs weekly on Tuesday 23:00 Berlin; results write to `forecast_quality` with `evaluation_window='rolling_origin_cv'`
- [x] **BCK-06**: `forecast-quality-gate.yml` runs on every forecast-engine PR; fails CI when gate criteria miss for any model already promoted to production
- [x] **BCK-07**: `docs/forecast/ACCURACY-LOG.md` auto-committed weekly with RMSE history per (model × horizon)
- [x] **BCK-08**: Freshness-SLO check on every `+page.server.ts` load: if `pipeline_runs.upstream_freshness_h > 24` for any cascade stage, dashboard renders the stale-data badge

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Multi-Tenant Onboarding
- **ONB-01**: Self-service signup flow for new restaurant owners
- **ONB-02**: Admin UI to provision a new tenant (restaurant + membership + scraper credentials)
- **ONB-03**: Orderbird credential onboarding wizard

### Scale & Integrations
- **INT-01**: Orderbird ISV Partner API integration (replaces Playwright scraper)
- **INT-02**: Additional POS integrations (Square, Toast, Lightspeed)
- **INT-03**: Hourly refresh via webhook (when ISV API supports it)

### Advanced Analytics
- **ADV-01**: Time-of-day / day-of-week heatmap
- **ADV-02**: At-risk customer list (cohort regulars gone quiet)
- **ADV-03**: Segment chips (high-value vs casual vs one-time)
- **ADV-04**: Menu-item level cohort analysis

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time / streaming data | Daily refresh covers 99% of decisions; webhooks add complexity and no ISV API yet |
| Onboarding / signup flow for v1 | Single tenant, manual provisioning is sufficient |
| Paid tier / billing | Free + forkable is the business model |
| Slide / PDF report generation | Phone dashboard is the delivery vehicle |
| Embedded notebooks in user-facing UI | Notebooks are the dev environment, not the product |
| Non-Orderbird POS integrations | Scope creep risk; v2 at earliest |
| Desktop-first layout | Phone is the primary viewing surface |
| Looker / Metabase / external BI embedding | Product requirement is a custom mobile UI |
| CSV export of cohort data | Owner isn't going to re-analyze in Excel |
| Customizable dashboard / widget builder | Non-technical user, confusion risk, anti-feature |
| AI chat / "ask your data" | Hallucination risk, anti-feature per research |
| Email digests / push notifications | v1 is pull-based; add only if validated |
| Full Marketing Mix Modeling (PyMC-Marketing, Meridian, Robyn) | Need ≥3 marketing channels — Instagram-only in v1.3; defer to v1.4+ |
| Item-level demand forecasting | Need ≥18mo per-item history; revenue+tx-count granularity is enough for v1.3 |
| Real-time / hourly forecast refresh | Daily covers 99% of decisions; ISV API not approved; CF Workers CPU budget |
| Per-customer churn predictions | Sparse opt-in tracking + creepy + low signal at 1 location |
| Multi-shop forecast scaling | Single tenant in v1; multi-tenant-ready schema, but model-tuning per shop deferred |
| Deep-learning forecasters (TFT, DeepAR) | Need ≥2 years data + GPU; SARIMAX wins on this scale |
| Custom date-range picker on the forecast card | Horizon chips (7d/5w/4mo/1yr) are sufficient — adding the picker on top is mobile UI clutter |
| Cohort triangle / heatmap viz | Unreadable on phone; deferred to v2 |
| Custom date-range picker on mobile | Preset chips only |
| Fully configurable filter builder | Non-technical user; preset segments only |
| 12-month LTV projection | Not enough history; LTV-to-date only, with caveat |

## Traceability

Each requirement maps to exactly one roadmap phase.

### v1.0 (shipped)

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 1 — Foundation | Pending |
| FND-02 | Phase 1 — Foundation | Pending |
| FND-03 | Phase 1 — Foundation | Complete |
| FND-04 | Phase 1 — Foundation | Complete |
| FND-05 | Phase 1 — Foundation | Complete |
| FND-06 | Phase 1 — Foundation | Complete |
| FND-07 | Phase 1 — Foundation | Complete |
| FND-08 | Phase 1 — Foundation | Complete |
| ING-01 | Phase 2 — Ingestion | Complete |
| ING-02 | Phase 2 — Ingestion | Complete |
| ING-03 | Phase 2 — Ingestion | Complete |
| ING-04 | Phase 2 — Ingestion | Complete |
| ING-05 | Phase 2 — Ingestion | Complete |
| ANL-01 | Phase 3 — Analytics SQL | Complete |
| ANL-02 | Phase 3 — Analytics SQL | Complete |
| ANL-03 | Phase 3 — Analytics SQL | Complete |
| ANL-04 | Phase 3 — Analytics SQL | Complete |
| ANL-05 | Phase 3 — Analytics SQL | Complete |
| ANL-06 | Phase 3 — Analytics SQL | Complete |
| ANL-07 | Phase 3 — Analytics SQL | Complete |
| ANL-08 | Phase 3 — Analytics SQL | Complete |
| ANL-09 | Phase 3 — Analytics SQL | Complete |
| UI-01 | Phase 4 — Mobile Reader UI | Complete |
| UI-02 | Phase 4 — Mobile Reader UI | Complete |
| UI-03 | Phase 4 — Mobile Reader UI | Complete |
| UI-04 | Phase 4 — Mobile Reader UI | Complete |
| UI-05 | Phase 4 — Mobile Reader UI | Complete |
| UI-06 | Phase 4 — Mobile Reader UI | Complete |
| UI-07 | Phase 4 — Mobile Reader UI | Complete |
| UI-08 | Phase 4 — Mobile Reader UI | Complete |
| UI-09 | Phase 4 — Mobile Reader UI | Complete |
| UI-10 | Phase 4 — Mobile Reader UI | Complete |
| UI-11 | Phase 4 — Mobile Reader UI | Complete |
| INS-01 | Phase 5 — Insights & Forkability | Complete |
| INS-02 | Phase 5 — Insights & Forkability | Complete |
| INS-03 | Phase 5 — Insights & Forkability | Complete |
| INS-04 | Phase 5 — Insights & Forkability | Complete |
| INS-05 | Phase 5 — Insights & Forkability | Complete |
| INS-06 | Phase 5 — Insights & Forkability | Complete |

### v1.1 (Phases 6-7 complete; Phases 8-11 superseded by v1.2)

| Requirement | Phase | Status |
|-------------|-------|--------|
| FLT-01 | Phase 6 — Filter Foundation | Complete |
| FLT-02 | Phase 6 — Filter Foundation | Complete |
| FLT-03 | Phase 6 — Filter Foundation | Complete |
| FLT-04 | Phase 6 — Filter Foundation | Complete |
| FLT-05 | Phase 7 — Column Promotion | Complete |
| FLT-06 | — | Superseded by v1.2 |
| FLT-07 | Phase 6 — Filter Foundation | Complete |
| DM-01 | Phase 7 — Column Promotion | Complete |
| DM-02 | Phase 7 — Column Promotion | Complete |
| DM-03 | Phase 7 — Column Promotion | Complete |
| DM-04 | — | Superseded by v1.2 |
| DM-05 | — | Superseded by v1.2 |
| DM-06 | — | Superseded by v1.2 |
| DM-07 | — | Superseded by v1.2 |
| DM-08 | — | Superseded by v1.2 |
| CHT-01 | — | Superseded by v1.2 |
| CHT-02 | — | Superseded by v1.2 |
| CHT-03 | — | Superseded by v1.2 |
| CHT-04 | — | Superseded by v1.2 |
| CHT-05 | — | Superseded by v1.2 |
| CHT-06 | — | Superseded by v1.2 |
| CHT-07 | — | Superseded by v1.2 |
| CHT-08 | — | Superseded by v1.2 |
| CHT-09 | — | Superseded by v1.2 |
| CHT-10 | — | Superseded by v1.2 |
| BUG-01 | — | Superseded by v1.2 |
| BUG-02 | — | Superseded by v1.2 |

### v1.2

| Requirement | Phase | Status | Evidence |
|-------------|-------|--------|----------|
| VA-01 | Phase 8 — Visit Attribution Data Model | Pending | 09-03 (gap closure: tx_id text fix) |
| VA-02 | Phase 8 — Visit Attribution Data Model | Pending | 09-03 (gap closure: is_cash JOIN fix) |
| VA-03 | Phase 8 — Visit Attribution Data Model | Pending | — |
| VA-04 | Phase 10 — Charts | Complete | — |
| VA-05 | Phase 10 — Charts | Complete | — |
| VA-06 | Phase 10 — Charts | Complete | — |
| VA-07 | Phase 10 — Charts | Complete | — |
| VA-08 | Phase 10 — Charts | Complete | — |
| VA-09 | Phase 10 — Charts | Complete | — |
| VA-10 | Phase 10 — Charts | Complete | — |
| VA-11 | Phase 9 — Filter Simplification & Performance | Complete | 09-01, 09-02, 09-03, 09-04, 09-05 |
| VA-12 | Phase 9 — Filter Simplification & Performance | Complete | 09-01, 09-02, 09-03, 09-04, 09-05 |
| VA-13 | Phase 9 — Filter Simplification & Performance | Complete | 09-01, 09-02, 09-03, 09-04, 09-05 |

### v1.3

| Requirement | Phase | Status | Evidence |
|-------------|-------|--------|----------|
| FND-09 | Phase 12 — Foundation: Decisions & Guards | Pending | — |
| FND-10 | Phase 12 — Foundation: Decisions & Guards | Pending | — |
| FND-11 | Phase 12 — Foundation: Decisions & Guards | Pending | — |
| EXT-01 | Phase 13 — External Data Ingestion | Pending | — |
| EXT-02 | Phase 13 — External Data Ingestion | Pending | — |
| EXT-03 | Phase 13 — External Data Ingestion | Pending | — |
| EXT-04 | Phase 13 — External Data Ingestion | Pending | — |
| EXT-05 | Phase 13 — External Data Ingestion | Pending | — |
| EXT-06 | Phase 13 — External Data Ingestion | Pending | — |
| EXT-07 | Phase 13 — External Data Ingestion | Pending | — |
| EXT-08 | Phase 13 — External Data Ingestion | Pending | — |
| EXT-09 | Phase 13 — External Data Ingestion | Pending | — |
| FCS-01 | Phase 14 — Forecasting Engine: BAU Track | Pending | — |
| FCS-02 | Phase 14 — Forecasting Engine: BAU Track | Pending | — |
| FCS-03 | Phase 14 — Forecasting Engine: BAU Track | Pending | — |
| FCS-04 | Phase 14 — Forecasting Engine: BAU Track | Pending | — |
| FCS-05 | Phase 14 — Forecasting Engine: BAU Track | Pending | — |
| FCS-06 | Phase 14 — Forecasting Engine: BAU Track | Pending | — |
| FCS-07 | Phase 14 — Forecasting Engine: BAU Track | Pending | — |
| FCS-08 | Phase 14 — Forecasting Engine: BAU Track | Pending | — |
| FCS-09 | Phase 14 — Forecasting Engine: BAU Track | Pending | — |
| FCS-10 | Phase 14 — Forecasting Engine: BAU Track | Pending | — |
| FCS-11 | Phase 14 — Forecasting Engine: BAU Track | Pending | — |
| FUI-01 | Phase 15 — Forecast Chart UI | Pending | — |
| FUI-02 | Phase 15 — Forecast Chart UI | Pending | — |
| FUI-03 | Phase 15 — Forecast Chart UI | Pending | — |
| FUI-04 | Phase 15 — Forecast Chart UI | Pending | — |
| FUI-05 | Phase 15 — Forecast Chart UI | Pending | — |
| FUI-06 | Phase 15 — Forecast Chart UI | Pending | — |
| FUI-07 | Phase 15 — Forecast Chart UI | Pending | — |
| FUI-08 | Phase 15 — Forecast Chart UI | Pending | — |
| FUI-09 | Phase 15 — Forecast Chart UI | Pending | — |
| UPL-01 | Phase 16 — ITS Uplift Attribution | Pending | — |
| UPL-02 | Phase 16 — ITS Uplift Attribution | Pending | — |
| UPL-03 | Phase 16 — ITS Uplift Attribution | Pending | — |
| UPL-04 | Phase 16 — ITS Uplift Attribution | Partial | Plan 16-07 (DDL + 2 wrapper views on DEV; UI surfacing in Plan 16-09) |
| UPL-05 | Phase 16 + 16.1 — ITS Uplift Attribution + Friend-Persona | Closed | Plan 16-07 (column live in campaign_uplift_v) + Plan 16.1-03 (divergence warning surfaced in disclosure panel) |
| UPL-06 | Phase 16 + 16.1 — ITS Uplift Attribution + Friend-Persona | Closed | Plan 16.1-03 (tier-aware plain-language hero + CI bounds in secondary line + statistical disclosure panel) |
| UPL-07 | Phase 16 — ITS Uplift Attribution | Pending | — |
| BCK-01 | Phase 17 — Backtest Gate & Quality Monitoring | Complete | Plan 17-05 (rolling-origin CV driver) + 17-04 (argparse retrofit) |
| BCK-02 | Phase 17 — Backtest Gate & Quality Monitoring | Complete | Plans 17-02 (conformal.py), 17-05 (qhat_h35 logging), 17-09 (UI surfacing) |
| BCK-03 | Phase 17 — Backtest Gate & Quality Monitoring | Complete | Plans 17-03 (naive_dow_with_holidays + 119ad45 fix), 17-05 (R7 baseline guard) |
| BCK-04 | Phase 17 — Backtest Gate & Quality Monitoring | Complete | Plans 17-01 (migration 0067 schema + feature_flags seed), 17-05 (gate writer), 17-06 (AND-intersect) |
| BCK-05 | Phase 17 — Backtest Gate & Quality Monitoring | Complete | Plan 17-07 (forecast-backtest.yml — 5 PASS + 1 PARTIAL: workflow_dispatch returns 404 on feature branch, resolves post-merge) |
| BCK-06 | Phase 17 — Backtest Gate & Quality Monitoring | Complete | Plan 17-08 (forecast-quality-gate.yml — PARTIAL: same 404-on-feature-branch structural cause as BCK-05; resolves post-merge) |
| BCK-07 | Phase 17 — Backtest Gate & Quality Monitoring | Complete | Plan 17-07 (write_accuracy_log.py + ACCURACY-LOG.md — PARTIAL: commit-back depends on workflow firing, resolves post-merge) |
| BCK-08 | Phase 17 — Backtest Gate & Quality Monitoring | Complete | Plans 17-01 (data_freshness_v UNION + FreshnessLabel 24h threshold), 17-09 (badge surfacing) |

**Coverage:**
- v1.0 requirements: 39 total (shipped)
- v1.1 requirements: 14 active (Phases 6-7 complete), 12 superseded by v1.2
- v1.2 requirements: 13 total, 13 mapped
- v1.3 requirements: 47 total, 47 mapped (FND-09..11 → Phase 12; EXT-01..09 → Phase 13; FCS-01..11 → Phase 14; FUI-01..09 → Phase 15; UPL-01..07 → Phase 16; BCK-01..08 → Phase 17)
- Orphaned: 0

---
*Requirements defined: 2026-04-13; v1.3 added 2026-04-27*
*Last updated: 2026-04-27 — v1.3 traceability resolved: 47/47 requirements mapped to Phases 12-17 by gsd-roadmapper*
