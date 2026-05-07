# Roadmap: Ramen Bones Analytics

**Created:** 2026-04-13
**Granularity:** standard
**Parallelization:** enabled
**Coverage:** 39/39 v1 + 14/14 v1.1 + 13/13 v1.2 + 47/47 v1.3 + 2/2 v1.4 requirements mapped
**v1.3 shipped:** 2026-05-06 (Phases 12–17; PRs #17, #22, #26, #28, #29, #30)
**v1.4 opened:** 2026-05-07 (Phase 18 — single-feature milestone)

## Core Value

A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see — without needing a data team, a dashboard tool, or a deck.

## Phases

<details>
<summary>v1.0 MVP (Phases 1-5) — SHIPPED 2026-04-15</summary>

- [x] **Phase 1: Foundation** — Multi-tenant schema, auth, RLS, wrapper-view template, CI guards
- [x] **Phase 2: Ingestion** — Pre-joined CSV loader → staging → normalized transactions
- [x] **Phase 3: Analytics SQL** — Cohort/LTV/KPI/frequency MVs with wrapper views and survivorship guardrails
- [x] **Phase 4: Mobile Reader UI** — SvelteKit dashboard on Cloudflare Pages at 375px baseline
- [x] **Phase 5: Insights & Forkability** — Claude Haiku narrative card; v1 shipped to friend

</details>

<details>
<summary>v1.1 Dashboard Redesign (Phases 6-7) — Partial (Phases 8-11 superseded by v1.2)</summary>

- [x] **Phase 6: Filter Foundation** — Custom date-range picker, day/week/month toggle, 4 dropdown filters wired through zod-validated SSR params
- [x] **Phase 7: Column Promotion** — Lift `wl_issuing_country` + `card_type` from staging into `transactions` via migration + loader + backfill

</details>

<details>
<summary>v1.2 Dashboard Simplification & Visit Attribution (Phases 8-11) — SHIPPED 2026-04-21</summary>

- [x] **Phase 8: Visit Attribution Data Model** — visit_seq MV, is_cash flag, drop unused views/MVs
- [x] **Phase 9: Filter Simplification & Performance** — Simplify to cash/card + inhouse/takeaway, client-side granularity toggle, drop 2 revenue cards
- [x] **Phase 10: Charts** — 7 charts (calendar revenue, calendar counts, retention curve, LTV per customer, order item counts, cohort total revenue, cohort avg LTV)
- [x] **Phase 11: SSR Performance & Recovery** — Clamp `'all'` range at SSR boundary, defer 4 lifetime-unbounded queries to `/api/*` + LazyMount, cap `fetchAll` pages — restores deployed CF Pages site after Worker Error 1102 took it offline

</details>

<details>
<summary>✅ v1.3 External Data & Forecasting Foundation (Phases 12–17) — SHIPPED 2026-05-06</summary>

- [x] **Phase 12: Foundation — Decisions & Guards** — ITS validity audit script + CI grep guard (`tenant_id` → `restaurant_id`) + UTC-anchored cron schedule contract
- [x] **Phase 13: External Data Ingestion** — 5 ingest tables (weather/holidays/school/transit/events) + pipeline_runs + shop_calendar + GHA workflow + backfill from 2025-06-11 — PR #17
- [x] **Phase 14: Forecasting Engine — BAU Track** — SARIMAX/Prophet/ETS/Theta/Naive nightly fits + sample-path resampling + last_7_eval + forecast_daily_mv — PR #22
- [x] **Phase 15: Forecast Chart UI** — v2 (Forecast Backtest Overlay) shipped 2026-05-01 — PR #26
- [x] **Phase 16: ITS Uplift Attribution** — campaign_calendar + Track-B counterfactual fit + campaign_uplift_v + CampaignUpliftCard — PR #28
- [x] **Phase 16.1: Friend-Persona UX Polish** — past-forecast continuity + Forecast card scroll parity + Calendar* tooltip forecast data + CampaignUpliftCard plain-language regime — PR #28
- [x] **Phase 16.2: Friend-Persona QA Gap Closure** — 7 issues fixed (date-range perf, tooltip multi-model, SVG z-order, Prophet revert, CampaignUpliftCard chart primitives) — PR #28
- [x] **Phase 16.3: Dashboard Cleanup + Events Everywhere** — deleted RevenueForecastCard/InvoiceCountForecastCard/ForecastHoverPopup; EventBadgeStrip wired into every date-axis chart — PR #29
- [x] **Phase 17: Backtest Gate & Quality Monitoring** — rolling-origin CV at 4 horizons + ConformalIntervals + ≥10% RMSE gate + freshness-SLO badges + ACCURACY-LOG — PR #30

</details>

<details open>
<summary>v1.4 Weekly Campaign Read (Phase 18) — IN PLANNING (opened 2026-05-07)</summary>

- [ ] **Phase 18: Weekly Counterfactual Window** — replace CampaignUpliftCard cumulative-since-launch headline with per-ISO-week (Mon–Sun) counterfactual + bar-chart history of all completed weeks (CI whiskers, color-coded by significance, tap-to-scrub hero)

</details>

## Phase Details

<details>
<summary>v1.0 Phase Details (Phases 1-5)</summary>

### Phase 1: Foundation
**Goal**: Multi-tenant data plane is provably isolated and day-boundary-correct before any analytical SQL is written
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08
**Success Criteria** (what must be TRUE):
  1. A logged-in user can only read rows for their own `restaurant_id`, verified by a two-tenant CI integration test that seeds tenants A and B and asserts zero cross-reads in every wrapper view
  2. A user can sign in with email/password via Supabase Auth and the session survives a browser refresh
  3. The first materialized view (`kpi_daily_mv`) has a unique index, a `_v` wrapper view, and `REVOKE ALL` on the underlying MV from `authenticated`/`anon` — establishing the template every later MV copies
  4. Every analytical query derives `business_date` via `AT TIME ZONE r.timezone`, with a test fixture at 23:45 Berlin landing in the correct business day
  5. CI grep guards fail the build on raw `_mv` references from `src/`, `getSession` on server, `REFRESH MATERIALIZED VIEW` without `CONCURRENTLY`, and `card_hash` joined to PII columns
**Plans**: 6 plans
  - [x] 01-01-PLAN.md — Bootstrap repo (Node + Supabase CLI + Vitest) + tenancy/transactions migrations
  - [x] 01-02-PLAN.md — Custom Access Token Hook migration + Dashboard registration doc
  - [x] 01-03-PLAN.md — kpi_daily_mv wrapper-view template + v1 seed migration
  - [x] 01-04-PLAN.md — SvelteKit hooks/login reference files under docs/reference
  - [x] 01-05-PLAN.md — CI grep guards script + 3 GHA workflows (guards/tests/migrations)
  - [x] 01-06-PLAN.md — Vitest integration suite (7 tests) + README forker quickstart
**UI hint**: yes

### Phase 2: Ingestion
**Goal**: The pre-joined Orderbird CSV loads idempotently into `stg_orderbird_order_items` and normalizes into `transactions` with documented semantics confirmed against real rows
**Depends on**: Phase 1
**Requirements**: ING-01, ING-02, ING-03, ING-04, ING-05
**Success Criteria** (what must be TRUE):
  1. A loader script reads `orderbird_data/5-JOINED_DATA_*/ramen_bones_order_items.csv` and upserts rows into `stg_orderbird_order_items`
  2. Re-running the loader produces zero diffs in `transactions` — natural-key upsert on `(restaurant_id, source_tx_id)` is provably idempotent
  3. A SQL normalization step promotes staged rows to `transactions` with documented, unit-tested handling of voids, refunds, tips, and brutto vs netto
  4. `card_hash = sha256(wl_card_number || restaurant_id)` is computed in the loader before any DB write
  5. The loader is re-runnable: dropping a newer CSV into the folder and re-running brings `transactions` current without data loss or duplicates
**Plans**: 4 plans (complete)

### Phase 3: Analytics SQL
**Goal**: The cohort trunk and its leaves (retention, LTV, KPIs, frequency, new/returning) are queryable through wrapper views with survivorship guards baked into SQL
**Depends on**: Phase 1, Phase 2
**Requirements**: ANL-01, ANL-02, ANL-03, ANL-04, ANL-05, ANL-06, ANL-07, ANL-08, ANL-09
**Success Criteria** (what must be TRUE):
  1. `cohort_mv` assigns each `card_hash` to a first-visit cohort via `MIN(occurred_at) GROUP BY card_hash`
  2. All wrapper views return tenant-scoped rows only, with raw `_mv` locked behind `REVOKE ALL`
  3. LTV and retention outputs clip to the shortest cohort's observable horizon
  4. `pg_cron` refreshes every MV nightly with `REFRESH MATERIALIZED VIEW CONCURRENTLY`
**Plans**: 5 plans (complete)

### Phase 4: Mobile Reader UI
**Goal**: The friend opens the dashboard on their phone and reads revenue, cohorts, LTV, frequency, and new-vs-returning at a 375px viewport
**Depends on**: Phase 1, Phase 3
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, UI-09, UI-10, UI-11
**Success Criteria** (what must be TRUE):
  1. SvelteKit 2 + Svelte 5 + `adapter-cloudflare` deploys to Cloudflare Pages at 375px with no horizontal scroll
  2. Revenue KPI cards, cohort retention, LTV, repeat visit, and frequency each render as a card with touch tooltips and graceful empty states
  3. Preset date-range chips are the only global filter and every PR is verified at 375px
**Plans**: 5 plans (complete)
**UI hint**: yes

### Phase 5: Insights & Forkability
**Goal**: A nightly plain-English insight card lands on the dashboard, and any restaurant owner can fork the repo and self-host
**Depends on**: Phase 3, Phase 4
**Requirements**: INS-01, INS-02, INS-03, INS-04, INS-05, INS-06
**Success Criteria** (what must be TRUE):
  1. Nightly Edge Function calls Claude Haiku with KPI payload and writes to `insights` table
  2. Digit-guard regex rejects hallucinated numbers, falling back to a deterministic template
  3. Dashboard renders the latest insight card for the logged-in tenant
  4. Public repo is forkable with README + `.env.example`
**Plans**: 9 plans (complete)

</details>

<details>
<summary>v1.1 Phase Details (Phases 6-7)</summary>

### Phase 6: Filter Foundation
**Goal**: A shared filter bar (date range, granularity, sales type, payment method) drives every v1.0 card through a single zod-validated SSR pipeline
**Depends on**: Phase 5
**Requirements**: FLT-01, FLT-02, FLT-03, FLT-04, FLT-07
**Success Criteria**:
  1. A user can pick an arbitrary date range, granularity, and 2 dropdown filters, and every v1.0 card re-renders with correctly scoped numbers at 375px
  2. SSR load function composes WHERE clauses from zod-validated query params only — no dynamic SQL
  3. Payment-method dropdown is populated from `SELECT DISTINCT` — no hardcoded whitelist
  4. All dropdowns surface an "All" sentinel that cleanly degrades to no-op WHERE clause
**Plans**: 5 plans (complete)
**UI hint**: yes

### Phase 7: Column Promotion
**Goal**: `transactions.wl_issuing_country` and `transactions.card_type` are populated for every row so downstream views can use them
**Depends on**: Phase 6
**Requirements**: DM-01, DM-02, DM-03, FLT-05
**Success Criteria**:
  1. Migration adds both columns; existing rows stay intact
  2. Backfill populates both columns for all historical transactions; spot-checked against CSV
  3. Loader writes both columns on future ingests with idempotency preserved
  4. Country dropdown filter wired through existing filter schema
**Plans**: 4 plans (complete)

</details>

<details>
<summary>v1.2 Phase Details (Phases 8-11)</summary>

### Phase 8: Visit Attribution Data Model
**Goal**: Every transaction carries its card_hash's nth-visit number and a binary cash/card flag; unused views and dead code are removed
**Depends on**: Phase 7
**Requirements**: VA-01, VA-02, VA-03
**Success Criteria** (what must be TRUE):
  1. Each transaction with a non-NULL card_hash has a `visit_seq` integer (1, 2, 3...) computed via `ROW_NUMBER() OVER (PARTITION BY card_hash ORDER BY occurred_at)`, verified by a fixture of 3+ customers with known visit sequences
  2. Each transaction has an `is_cash` boolean derived from `payment_method`, verified by asserting known cash and card transactions map correctly
  3. The visit-attribution MV has a unique index, an RLS wrapper view, and `REVOKE ALL` on the raw MV — following the project's established pattern
  4. `frequency_v`, `new_vs_returning_v`, `ltv_v`, `CountryMultiSelect.svelte`, `_applyCountryFilter`, and the `wl_issuing_country` column on `transactions_filterable_v` are all dropped; CI passes with zero references to the removed artifacts
  5. `refresh_analytics_mvs()` includes the new visit-attribution MV in the correct DAG position; nightly cron verified green for at least 1 run
**Plans:** 2 plans
Plans:
  - [x] 08-01-PLAN.md — visit_attribution_mv + wrapper view + test helper + refresh function + integration tests
  - [x] 08-02-PLAN.md — Drop dead SQL views + frontend cleanup (components, queries, country filter)

### Phase 9: Filter Simplification & Performance
**Goal**: The filter bar shows only inhouse/takeaway + cash/card, granularity/range toggles respond in under 200ms (no SSR round-trip), and the dashboard shows 1 revenue card instead of 3
**Depends on**: Phase 8
**Requirements**: VA-11, VA-12, VA-13
**Success Criteria** (what must be TRUE):
  1. The filter bar shows exactly 2 filters: inhouse/takeaway (sales type) and cash/card — the country dropdown, payment-method multi-select, and repeater-bucket dropdown are gone from the UI
  2. Changing granularity (day/week/month) or date range re-renders charts in under 200ms perceived response without a full page navigation or SSR round-trip — the data is fetched once and re-bucketed client-side
  3. The dashboard shows 1 revenue reference card (using active date range and granularity) instead of the previous 3 fixed cards (today/7d/30d); the card respects both filters
  4. All remaining tiles and charts respect both filters — no unscoped reference tiles exist anywhere on the dashboard
**Plans:** 5/5 plans complete (3 planned + 2 gap closures)
Plans:
  - [x] 09-01-PLAN.md — Data foundation: transactions_filterable_v + is_cash, filter schema, dashboard store, SegmentedToggle
  - [x] 09-02-PLAN.md — UI wiring: FilterBar rewrite, +page.server.ts simplify, 2 KPI tiles, replaceState, delete dead components
  - [x] 09-03-PLAN.md — Gap closure: fix 0020/0022 t.id→source_tx_id + tx_id type (text), correct 08-CONTEXT D-04
  - [x] 09-04-PLAN.md — Gap closure: reactive filters state in dashboardStore — fix UAT Tests 7/9 (stale FilterBar labels/aria-checked after replaceState)
  - [x] 09-05-PLAN.md — Gap closure: reactive date subtitle via getWindow() + mergeSearchParams URL composition helper — fix UAT Tests 7 (date subtitle frozen) & 9 (URL params stripped on sequential clicks)
**UI hint**: yes

### Phase 10: Charts
**Goal**: 7 charts render on the dashboard with visit-count attribution breakdowns, all honoring both filters, verified at 375px
**Depends on**: Phase 8, Phase 9
**Requirements**: VA-04, VA-05, VA-06, VA-07, VA-08, VA-09, VA-10
**Success Criteria** (what must be TRUE):
  1. Calendar revenue chart renders stacked bars by visit-count bucket (1st/2nd/3rd/4x/5x/6x/7x/8x+) per day/week/month granularity; the owner can see "how much revenue came from 3rd-timers on Tuesday"
  2. Calendar customer counts chart renders the same visit-count breakdown; the owner can see "how many 2nd-timers came in this week"
  3. Retention curve chart renders weekly and monthly first-time acquisition cohort retention rates with horizon-clip to prevent survivorship bias
  4. LTV per customer chart renders individual or bucketed customer lifetime value distribution
  5. Calendar order item counts chart renders item-name breakdown (from `stg_orderbird_order_items.item_name`) per granularity period — the owner can see which menu items sell most
  6. First-time date cohort total revenue and average LTV charts render per acquisition cohort (weekly/monthly); the owner can compare "did my January cohort spend more than my March cohort?"
  7. All 7 charts render at 375px viewport with touch-friendly tooltips, graceful empty states, and both filters (inhouse/takeaway + cash/card) applied
**Plans**: 8 plans
Plans:
  - [x] 10-01-PLAN.md — Wave 0 RED test scaffolds + 90-day seed extension + CF Pages unblock decision
  - [x] 10-02-PLAN.md — Migration 0023: extend transactions_filterable_v with visit_seq + card_hash
  - [x] 10-03-PLAN.md — Migrations 0024/0025: customer_ltv_mv + item_counts_daily_mv + refresh DAG
  - [x] 10-04-PLAN.md — Client libs: chartPalettes + ltvBins + itemCountsRollup + cohortAgg + dashboardStore ext
  - [x] 10-05-PLAN.md — Calendar charts: VA-04 CalendarRevenueCard + VA-05 CalendarCountsCard + VisitSeqLegend
  - [x] 10-06-PLAN.md — VA-07 LtvHistogramCard + VA-08 CalendarItemsCard with top-8+Other rollup
  - [x] 10-07-PLAN.md — VA-09 CohortRevenueCard + VA-10 CohortAvgLtvCard + VA-06 D-17 hint
  - [x] 10-08-PLAN.md — SSR fan-out + +page.svelte composition in D-10 order + LazyMount measurement checkpoint
**UI hint**: yes

### Phase 11: SSR Performance & Recovery
**Goal**: The deployed Cloudflare Pages site stays serviceable under all date-range inputs — no CF Error 1102 "Worker exceeded resource limits" from SSR overfetch
**Depends on**: Phase 10
**Requirements**: (none — urgent bug-fix phase inserted after production outage 2026-04-21; root cause in `.planning/debug/cf-pages-ssr-cpu-1102.md`)
**Success Criteria** (what must be TRUE):
  1. `chipToRange('all')` resolves `from` to the tenant's earliest `business_date` (or `FROM_FLOOR='2024-01-01'`), never `'1970-01-01'`
  2. `parseFilters` soft-clamps `from < '2024-01-01'` and `to > today + 365d` so bookmarked URLs with pathological dates cannot trigger CF Workers CPU blowup
  3. SSR `+page.server.ts` runs at most 6 Supabase queries per load (down from 11); the 4 lifetime-unbounded queries (kpi-daily, customer-ltv, repeater-lifetime, retention) serve from deferred `/api/*` endpoints behind `LazyMount` + `clientFetch`
  4. `fetchAll` defaults to `DEFAULT_MAX_PAGES=50` (matching CF Pages Free's 50-subrequest cap); `HARD_MAX_PAGES=1000` preserved as last-resort guard
  5. Every new `/api/*` endpoint uses canonical `locals.safeGetSession()` (not `getClaims()` direct) and sets `Cache-Control: private, no-store`
  6. Production curls: `/?range=all` returns 303 (never 404 size=9); `/login` returns 200 with `x-sveltekit-page: true` header
**Plans**: 3 plans
  - [x] 11-01-PLAN.md — Range clamp at SSR boundary + `fetchAll DEFAULT_MAX_PAGES=50`
  - [x] 11-02-PLAN.md — Defer 4 lifetime queries to `/api/*` + LazyMount/clientFetch primitives (atomic SSR cleanup + client wiring)
  - [x] 11-03-PLAN.md — Dev-only SSR timing log + CF Pages Free tripwire comment

</details>

### Phase Details — Current Milestone (v1.3)

### Phase 12: Foundation — Decisions & Guards
**Goal**: Lock the cross-cutting decisions and CI guards that every later v1.3 phase depends on — ITS validity audit committed and runnable, JWT-claim rename guard active, all v1.3 cron schedules anchored in UTC
**Depends on**: Phase 11 (v1.2 complete)
**Requirements**: FND-09, FND-10, FND-11
**Success Criteria** (what must be TRUE):
  1. `tools/its_validity_audit.py` exists in the repo, runs locally without errors, and is wired to a weekly GHA workflow that posts results to `pipeline_runs` (or a stand-in until Phase 13 creates that table) and surfaces concurrent-intervention warnings (price hikes, hour shifts, new menu items) for the 2026-04-14 campaign era
  2. CI grep guard added to `scripts/ci-guards.sh` (or equivalent) fails the build on any `auth.jwt()->>'tenant_id'` reference inside `supabase/migrations/` — codebase claim is `restaurant_id`; a deliberate red-team migration in tests verifies the guard fires
  3. v1.3 GHA cron schedule contract documented (target: `external-data` 00:00 UTC, `forecast-refresh` 01:00 UTC, `forecast-mv-refresh` 03:00 UTC, `forecast-backtest` Tuesday 23:00 UTC) with CI test that asserts no schedule overlap under either CET (UTC+1) or CEST (UTC+2) and ≥60-minute gap between cascade stages
  4. Discuss-phase artifact `.planning/phases/12-forecasting-foundation/12-CONTEXT.md` ratifies anticipation cutoff (`campaign_start − 7 days`), the `WEATHER_PROVIDER=brightsky` production default, and the `restaurant_id` rename of every §7 schema sketch in `12-PROPOSAL.md`
**Plans**: 4 plans
  - [ ] 12-01-PLAN.md — `pipeline_runs` skeleton migration (D-07/D-08) + DEV schema push
  - [ ] 12-02-PLAN.md — `tools/its_validity_audit.py` + weekly GHA cron (FND-09)
  - [ ] 12-03-PLAN.md — Guard 7 (`tenant_id` regression) + red-team fixture (FND-10)
  - [ ] 12-04-PLAN.md — Guard 8 cron-schedule contract (FND-11)

### Phase 13: External Data Ingestion
**Goal**: Five external-data tables (weather, holidays, school holidays, transit alerts, recurring events) plus operational tables (`pipeline_runs`, `shop_calendar`) populate nightly from a single GHA workflow, backfilled from 2025-06-11
**Depends on**: Phase 12
**Requirements**: EXT-01, EXT-02, EXT-03, EXT-04, EXT-05, EXT-06, EXT-07, EXT-08, EXT-09
**Success Criteria** (what must be TRUE):
  1. `weather_daily`, `holidays`, `school_holidays`, `transit_alerts`, `recurring_events` tables all populated with rows from 2025-06-11 onward; `weather_daily` extends 7 days into the future via the configured provider (default `brightsky` for production, `open-meteo` switchable via `WEATHER_PROVIDER` env var); `holidays` includes Internationaler Frauentag (Berlin BE state); `school_holidays` covers all 5–6 BE break blocks per year via raw `httpx` against `ferien-api.de` (the abandoned PyPI wrapper is NOT used)
  2. `pipeline_runs` audit table records `started_at`, `completed_at`, `row_count`, `upstream_freshness_h`, `success`/`failure`/`fallback` status for every fetch run and is the single source of truth for downstream freshness checks
  3. `shop_calendar` populated 365 days forward per restaurant; closed days flagged `is_open=false` and treated as `NaN` (not zero) at forecast-fit time — verifiable by `select count(*) from shop_calendar where date > current_date and date <= current_date + 365 >= 365`
  4. Hybrid-RLS enforced: shared location-keyed tables (`weather_daily`/`holidays`/`school_holidays`/`transit_alerts`/`recurring_events`) use `for select using (true)` with `REVOKE INSERT/UPDATE/DELETE` on `authenticated`/`anon`; tenant-scoped tables (`pipeline_runs`/`shop_calendar`) use `auth.jwt()->>'restaurant_id'`; the existing two-tenant CI isolation test is extended to cover all 7 new tables
  5. `external-data-refresh.yml` GHA workflow runs nightly at 00:00 UTC, completes in <5 minutes on `ubuntu-latest`, writes rows to all 5 ingest tables, populates `pipeline_runs`, and never fails the cascade silently — a deliberate Open-Meteo failure in CI surfaces a `fallback` status row, not an exception
  6. `recurring_events.yaml` (15–20 hand-curated Berlin events per year) loads via `PyYAML`, and a pg_cron annual-refresh reminder fires every September 15 to nag the maintainer to update the next year's events
**Plans**: TBD

### Phase 14: Forecasting Engine — BAU Track
**Goal**: SARIMAX (primary) + Prophet (yearly_seasonality hard-pinned False) + ETS + Theta + Naive same-DoW baseline fit nightly per restaurant, write 365-day-forward forecasts to `forecast_daily` with 1000-path samples for correct multi-day CI aggregation; nightly last-7-day evaluator populates `forecast_quality`
**Depends on**: Phase 13
**Requirements**: FCS-01, FCS-02, FCS-03, FCS-04, FCS-05, FCS-06, FCS-07, FCS-08, FCS-09, FCS-10, FCS-11
**Success Criteria** (what must be TRUE):
  1. `forecast_daily` long-format table stores rows keyed on `(restaurant_id, kpi_name, target_date, model_name, horizon_days, run_date, forecast_track)` with `forecast_track` defaulting to `'bau'`; SARIMAX/ETS/Theta/Naive write rows nightly; Prophet writes rows nightly with `yearly_seasonality=False` until `len(history) >= 730` (unit test asserts the flag stays False until 2027-06-11); Chronos-Bolt-Tiny + NeuralProphet sit behind `FORECAST_ENABLED_MODELS` env-var feature flags (off by default in production)
  2. SARIMAX exog matrix flavor (column set + ordering) verified identical at fit and predict time via a unit test that fails when the regressor signature drifts; `forecast_daily.exog_signature` (or equivalent) records the source flavor (`archive` vs `forecast` vs `climatology`) for every fit
  3. `last_7_eval.py` runs nightly per BAU model, scoring the last 7 actual days against each model's prior 7-day-ahead forecast; results write to `forecast_quality` with `evaluation_window='last_7_days'`; Track-B (`forecast_track='cf'`) is explicitly skipped (structurally unverifiable past campaign-start cutoff)
  4. `forecast_daily_mv` collapses to "latest run per `(restaurant_id, kpi_name, target_date, model_name, forecast_track)`" with a unique index supporting `REFRESH MATERIALIZED VIEW CONCURRENTLY`; `REVOKE ALL` from `authenticated`/`anon`; `forecast_with_actual_v` wrapper view (RLS-scoped via `auth.jwt()->>'restaurant_id'`) is the only surface the SvelteKit app reads; CI grep guard forbids any `from('forecast_daily')` or `from('forecast_daily_mv')` in `src/`
  5. `forecast-refresh.yml` GHA workflow runs nightly at 01:00 UTC (≥60 min after Phase 13's external-data fetch), completes in <10 min, writes BAU forecasts; failure populates `pipeline_runs` and a freshness check on the SvelteKit load triggers a stale-data badge on the next dashboard load; `pg_cron`'s `refresh_analytics_mvs()` is extended to refresh `forecast_daily_mv` after Python writes complete
  6. Sample-path resampling for granularity toggle is server-side: 1000 paths × 365d × N models stored in `forecast_daily.yhat_samples jsonb`; clients receive only aggregated `mean + 95% CI` per requested granularity (day/week/month) — never raw sample arrays — verified by a payload-budget assertion on the `/api/forecast` response (Phase 15 consumes this; the contract is owned here)
**Plans**: TBD

### Phase 15: Forecast Chart UI
**Goal**: Friend-owner opens the dashboard on her phone at 375px and sees actual revenue + SARIMAX BAU forecast + 95% CI band, with horizon chips, model legend toggle, hover popup showing per-horizon RMSE/MAPE/last-refit, event markers for campaign-start/holidays/strikes, and stale-data badge when upstream fetches missed
**Depends on**: Phase 14 (after schema + first model land — parallel-eligible per research synthesis 30–40% schedule compression)
**Requirements**: FUI-01, FUI-02, FUI-03, FUI-04, FUI-05, FUI-06, FUI-07, FUI-08, FUI-09
**Success Criteria** (what must be TRUE):
  1. `RevenueForecastCard.svelte` renders actual revenue + SARIMAX BAU forecast line + 95% CI uncertainty band at 375px with no horizontal scroll; default state shows 1 forecast line + naive baseline + CI band only (additional models opt-in via `ForecastLegend.svelte` chips, default OFF on mobile to prevent spaghetti)
  2. `HorizonToggle.svelte` lets the owner switch between `7d` / `5w` / `4mo` / `1yr` (default `7d`); X-axis re-zooms client-side; same forecast table, different slice; granularity toggle (day/week/month) re-buckets sample paths server-side via `/api/forecast?granularity=` and the client never receives raw 1000-path arrays
  3. `ForecastHoverPopup.svelte` (tap-to-pin on mobile per Svelte 5 `Tooltip.Root` + `{#snippet children}` pattern) shows: forecast value + 95% CI for that date, horizon (days from today), last-7-actual-days RMSE/MAPE/bias/direction-hit-rate, cumulative deviation since campaign launch, last-refit timestamp; `EventMarker.svelte` overlays campaign-start (red), federal holidays (dashed green), school-holiday-block backgrounds (teal), recurring events (yellow), BVG strike days (red bar) with progressive disclosure (≤50 markers visible at default zoom)
  4. `/api/forecast`, `/api/forecast-quality`, `/api/campaign-uplift` are all deferred endpoints behind `LazyMount` per the Phase 11 SSR pattern; all use canonical `locals.safeGetSession()` (not `getClaims()` direct) and set `Cache-Control: private, no-store`
  5. Empty-state ("Forecast generating, check back tomorrow") shown until first forecast lands; stale-data badge ("Data ≥24h stale — last refresh: …") shown when `pipeline_runs.upstream_freshness_h > 24` for any cascade stage; uncalibrated-CI badge shown for the 365d horizon while history < 2 years
  6. All v1.3 frontend components verified at `localhost:5173` via Chrome MCP (per `.claude/CLAUDE.md` localhost-first rule) BEFORE any DEV deploy QA — including a 375px iPhone-SE-equivalent screenshot showing only 1 forecast line + CI band by default and zero `invalid_default_snippet` console warnings from `Tooltip.Root`
**Plans**: TBD
**UI hint**: yes

### Phase 16: ITS Uplift Attribution
**Goal**: Friend-owner sees a single dedicated card on the dashboard answering "did the 2026-04-14 campaign work?" via Track-B counterfactual fit on pre-campaign era only, with cumulative `actual − Track-B` per campaign window, 95% Monte Carlo CIs, and honest "CI overlaps zero — no detectable lift" labeling when warranted
**Depends on**: Phase 14 (BAU forecast must be stable before counterfactual is meaningful) + Phase 15 (UI scaffolding for the new card)
**Requirements**: UPL-01, UPL-02, UPL-03, UPL-04, UPL-05, UPL-06, UPL-07
**Success Criteria** (what must be TRUE):
  1. `campaign_calendar` table records each campaign's `start_date`, `end_date`, `name`, `channel`, `notes`; tenant-scoped via `auth.jwt()->>'restaurant_id'` for read; writes via `service_role` / Supabase Studio for V1 (admin form deferred to v1.4); the 2026-04-14 friend-owner campaign is seeded as the first row
  2. Track-B counterfactual fits on pre-campaign data only — `TRAIN_END = campaign_start_date − 7 days` (anticipation buffer); `pipeline_runs.fit_train_end` records the cutoff for every CF refit; CI test asserts no `forecast_track='cf'` row was written using a `fit_train_end` ≥ `min(campaign_calendar.start_date)`; sensitivity analysis log at `tests/forecast/cutoff_sensitivity.md` shows uplift estimate at multiple cutoffs (`-14d`, `-7d`, `-1d`)
  3. `revenue_comparable_eur` derived KPI excludes new menu items launched coincidentally with the campaign era (per `tools/its_validity_audit.py` 2026-04-27 findings: Onsen EGG, Tantan, Hell beer); Track-B fits on this baseline-comparable revenue — never on raw revenue (a CI grep guard forbids the regression)
  4. `campaign_uplift_v` exposes per-campaign-window `Σ(actual − Track-B)` with 95% Monte Carlo CI from 1000 sample paths AND a `naive_dow_uplift_eur` cross-check column (sanity check against trend-extrapolation false positives in the declining 10-month pre-period); cumulative-since-launch shown as a running total per `(campaign, model)`
  5. `CampaignUpliftCard.svelte` renders the per-campaign cumulative uplift on the dashboard at 375px; explicitly displays "CI overlaps zero — no detectable lift" when 95% CI includes 0; never reports a single-point estimate without its CI band; tap-to-pin tooltip explains the 7-day anticipation buffer in plain language
  6. `cumulative_uplift.py` runs nightly after Track-B forecast completes; quarterly off-week reminder fires from a `feature_flags` table on 2026-10-15 (~6 months post-campaign) to re-anchor the counterfactual; `EventMarker.svelte` overlays campaign-start markers on `RevenueForecastCard.svelte` from Phase 15
**Plans:** 13/13 plans executed
Plans:
  **Wave 1 — Schema (parallel-safe; closes with [BLOCKING] supabase db push) ✓ complete 2026-05-02**
  - [x] 16-01-PLAN.md — campaign_calendar migration + 2026-04-14 seed
  - [x] 16-02-PLAN.md — baseline_items_v migration (TDD — first-seen ≥7d derivation)
  - [x] 16-03-PLAN.md — kpi_daily_with_comparable_v migration (revenue_comparable_eur)
  - [x] 16-04-PLAN.md — feature_flags + pipeline_runs.fit_train_end migrations + db push (BLOCKING)
  **Wave 2 *(blocked on Wave 1 completion)* — Track-B Python pipeline (closes with [BLOCKING] db push for migration 0062 + DB CHECK)**
  - [x] 16-05-PLAN.md — counterfactual_fit.py + run_all.py --track flag (Track-B fits)
  - [x] 16-06-PLAN.md — cumulative_uplift.py — bootstrap CI math + per-day rows for sparkline (TDD)
  - [x] 16-07-PLAN.md — campaign_uplift_v + campaign_uplift_daily_v + DB CHECK constraint + Wave-2 db push
  **Wave 3 *(blocked on Wave 2 completion)* — API + UI (closes with localhost-first Chrome MCP gates)**
  - [x] 16-08-PLAN.md — /api/campaign-uplift extended payload (daily[] array) + /api/forecast events campaign_start source
  - [x] 16-09-PLAN.md — CampaignUpliftCard.svelte + dashboard slot + retire CAMPAIGN_START
  - [x] 16-10-PLAN.md — EventMarker campaign_start E2E + Phase 15 forecast cards smoke test
  **Wave 4 *(blocked on Wave 3 completion)* — Hardening ✓ complete 2026-05-04**
  - [x] 16-11-PLAN.md — CI Guard 9 (raw-revenue Track-B) + Guard 10 (2026-04-14 literal) + red-team fixtures
  - [x] 16-12-PLAN.md — tests/forecast/cutoff_sensitivity.md log + check_cutoff_sensitivity.sh (4 Wave-2 hotfixes folded in: mig 0065/0066, pred_dates anchor, started_at probe; sarimax 1.139 + prophet 0.890 PASS in [0.8, 1.25])
  - [x] 16-13-PLAN.md — forecast-refresh.yml workflow extension + DEV smoke test (4m9s, 80 campaign_uplift rows)

  **Cross-cutting constraints (must_haves.truths shared across plans):**
  - `auth.jwt()->>'restaurant_id'` RLS filter on every new table/view (Plans 01, 02, 03, 04, 07)
  - `pipeline_runs.fit_train_end < min(campaign_calendar.start_date) − 7 days` for every `forecast_track='cf'` row (Plans 04, 05, 11)
  - Track-B fits read `kpi_daily_with_comparable_v.revenue_comparable_eur`, NEVER raw `revenue_eur` — DB CHECK + grep Guard 9 (Plans 05, 07, 11)
  - Server-side aggregation only — `yhat_samples` arrays NEVER leave the API boundary (Plans 06, 08)
  - Localhost-first Chrome MCP verification BEFORE any DEV deploy QA on UI plans (Plans 09, 10)
**UI hint**: yes

### Phase 16.1: Friend-Persona UX Polish (INSERTED, EXPANDED 2026-05-04)
**Goal**: Close the **four** friend-persona acceptance gaps from the 2026-05-04 owner Chrome MCP localhost reviews (morning + afternoon): (1) Calendar* + Forecast cards render past-forecast continuously over the windowed range anchored on last complete period (day=start-of-week-17 if last_actual=2026-04-27; week=last 5 complete weeks; month=last 4 complete months); (2) Forecast cards (`RevenueForecastCard`, `InvoiceCountForecastCard`) get horizontal-scroll parity with Calendar* cards; (3) Calendar* `Tooltip.Root` shows per-visible-model forecast values when both bar data and forecast row exist on a bucket; (4) CampaignUpliftCard plain-language regime tiering + supportive chart-context labels so a non-statistical owner can state in her own words what it tells her. Owner-blocking for v1.3 friend-persona acceptance.
**Depends on**: Phase 16 (CampaignUpliftCard exists; campaign_uplift_v populated). Phase 17 backtest gate stays separate; 16.1 ships the smallest backtest-row-generation subset needed for the windowing display.
**Requirements**: derived from `.planning/backlog/forecast-overlay-on-stacked-bars.md` + `.planning/backlog/campaign-uplift-card-plain-language.md` + 2026-05-04 afternoon owner feedback #1–4 captured in `16.1-CONTEXT.md` D-13..D-20 (no new UPL/EXT/FCS/FUI/BCK requirement IDs — closes existing UPL-05 + UPL-06 + FUI-09 persona-acceptance gaps)
**Success Criteria** (what must be TRUE):
  1. `CalendarRevenueCard.svelte` and `CalendarCountsCard.svelte` render past-forecast Spline (solid faded `stroke-opacity={0.7}`) + future-forecast Spline (dashed `4 4`) per visible model + continuous CI Area band per model (`fillOpacity={0.06}`); covering `[window_start_per_grain, today + horizon]` continuously with NO gaps
  2. **Forecast windowing per granularity (D-14)**: day grain anchors on `start_of_week(latest_complete_week_ending_before_or_on(last_actual_date))` (Monday-anchored); week grain anchors 4 complete weeks before that (= last 5 complete weeks); month grain anchors 3 complete months before `start_of_month(latest_complete_month)` (= last 4 complete months). Definition relative to `last_actual_date`, not `today`.
  3. **Pipeline + API ship continuous forecast rows over the windowed range (D-15)**: `forecast_with_actual_v` contains rows for every period in `[window_start, today + horizon]` per `(kpi, model, granularity)` — verifiable via `SELECT COUNT(DISTINCT target_date) FROM forecast_with_actual_v WHERE granularity='day'` matching the expected row count. No gaps (e.g., Apr 28-29 must be present when last_actual=Apr 27 and today=May 4).
  4. **Forecast cards x-axis parity (D-17)**: `RevenueForecastCard.svelte` and `InvoiceCountForecastCard.svelte` get the same horizontal-scroll wrapper as Calendar* cards (chart-touch-safe overflow-x-auto + dynamic `chartW = computeChartWidth(totalSlots, cardW)` + scroll-to-today-at-60% effect); past + future Spline split also applied to these cards
  5. **Calendar* tooltip shows forecast data (D-16)**: `Tooltip.Root` body in CalendarRevenueCard + CalendarCountsCard renders existing visit_seq/cash/total rows AND a new per-visible-model section with `formatEUR(yhat_mean*100)` (revenue) or `formatIntShort(yhat_mean)` (counts); model display labels via new i18n keys (`forecast_model_*` per locale)
  6. **CampaignUpliftCard regime + supportive labels (D-05..D-11 + D-18)**: hero adapts to maturity tier (`<14d` / `14-28d` / `>=28d` × CI-overlaps-zero matrix, 7 i18n keys from 16.1-02); inline "How is this calculated? ›" disclosure (collapsed by default); NEW chart-context labels (~5 new i18n keys × 5 locales) — hero subtitle, sparkline Y/X axis labels, counterfactual baseline marker
  7. **Mobile bundle budget unchanged**: no new chart library dependency; reuse existing LayerChart primitives + `chartPalettes` + `format` helpers
  8. **Localhost-first Chrome MCP verification at 375×667 in `ja` AND `en` locales** BEFORE any DEV deploy (per `.claude/CLAUDE.md` localhost-first rule); zero console errors / `invalid_default_snippet` warnings on any modified component; backend SQL migrations (if any) ship via `migrations.yml workflow_dispatch` on the feature branch BEFORE the visual QA at DEV (per `feedback_migrations_workflow_dispatch.md`)
  9. **Friend-persona acceptance**: owner reads any of the four cards (Calendar*, Forecast*, CampaignUpliftCard) at 375px and **states in her own words what it's telling her** without asking for translation
  10. **Planning-docs drift gate passes** (`.claude/scripts/validate-planning-docs.sh`)
**Plans**: 5 plans (1 done, 4 planned — ready to execute)
Plans:
  **Wave 1 (keystone — backend; parallel with done plan)**
  - [x] 16.1-04-PLAN.md (PLANNED) — Pipeline forecast windowing fix per D-14/D-15. **Locked: Option B (Forecast-from-window-start)** — single edit to `scripts/forecast/grain_helpers.py` (`window_start_for_grain` + extended `pred_dates_for_grain`); cascades via existing kwarg threading to sarimax/naive_dow/ets/theta fits + Prophet (Path A wire OR Path B skip-with-SUMMARY). NO migration. NO MV redefinition. NO API change. NO Phase 17 preemption.
  - [x] 16.1-02-PLAN.md (DONE) — i18n keys for CampaignUpliftCard plain-language regime (13 keys × 5 locales; shipped in `de61cc5`)
  **Wave 2 (UI — depends on 16.1-04 + 16.1-02; parallel within wave)**
  - [x] 16.1-01-PLAN.md (DONE 2026-05-04) — Calendar* past-forecast overlay (CalendarRevenueCard + CalendarCountsCard split-Spline past/future + continuous CI band) + Tooltip.Root expansion with per-visible-model rows (D-16). Re-applied stashed scaffold via `git stash pop` (clean). Tasks 1-5 shipped (1567a59 / 0918ecc / 644e8a5 / 0695056 / 151b5c6); Task 6 Chrome MCP gate auto-approved per workflow.auto_advance=true and folded into phase-final QA.
  - [x] 16.1-03-PLAN.md (DONE 2026-05-04) — CampaignUpliftCard tier-aware plain-language hero (3 maturity tiers × CI matrix → 7 i18n keys; D-05..D-11) + plain secondary line + inline "How is this calculated? ›" disclosure trigger + collapsible panel (statistical detail / anticipation note / divergence warning) + 4 D-18 supportive labels (subtitle / sparkline Y label above-Chart / X caption / baseline legend chip). Locale-aware date via Intl.DateTimeFormat. 4 new i18n keys × 5 locales. Tasks 1-3 shipped (4bdabf7 / 6d518c8 / 8cb008c); Task 4 Chrome MCP gate auto-approved per workflow.auto_advance=true and folded into phase-final QA.
  - [x] 16.1-05-PLAN.md (DONE 2026-05-04) — RevenueForecastCard + InvoiceCountForecastCard horizontal-scroll parity (D-17) + past/future Spline split shipped. Lifts `CalendarRevenueCard.svelte:194-263` wrapper verbatim — `bind:this={scrollerRef}` + `bind:clientWidth={cardW}` + `width={chartW}` + scroll-to-today RAF lands today at ~60% viewport on first paint (`todayPct = pastBuckets / totalSlots`). Past Spline (faded solid `stroke-opacity={0.7}`) + future Spline (dashed `'4 4'`); `curve={curveMonotoneX}` preserved on both branches per cards' pre-existing styling. CI Area band continuous (`fillOpacity={0.06}`). xDomain UNCHANGED — data-driven `[parseISO(allDates[0]), parseISO(allDates[allDates.length-1])]` auto-picks-up windowed leftmost target_date post-D-15 because there are no bars to define a competing anchor (intentional architectural difference from Calendar* cards). D-16 tooltip extension OUT OF SCOPE (Forecast cards delegate to `<ForecastHoverPopup>`). C-02/C-03 invariants preserved. Tasks 1+2 shipped (ab43c28 / ed8bf22); Task 3 Chrome MCP gate auto-approved per workflow.auto_advance=true and folded into phase-final QA.
**UI hint**: yes

### Phase 16.2: Friend-Persona QA Gap Closure (INSERTED 2026-05-05)
**Goal**: Close the 7 issues the friend-owner surfaced during the 2026-05-05 SC9 persona test of Phase 16.1, captured verbatim with screenshots in `.planning/feedback/16.1-friend-2026-05-05/HANDOFF.md`. The dashboard must remain owner-acceptable across all 5 modified cards on her phone (375×667) in `ja` locale: no UI freeze on date-range changes, tooltips honor model-selection state and align dots to lines, forecast Splines render in front of bars, Prophet past-projection no longer hallucinates an exponential trend, and CampaignUpliftCard renders the counterfactual baseline + axis tick marks the owner asked for.
**Depends on**: Phase 16.1 (5/5 plans complete; SC9 surfaced these 7 issues against the merged 16.1 implementation). Continues on the same `feature/phase-16-its-uplift-attribution` branch.
**Requirements**: derived from `.planning/feedback/16.1-friend-2026-05-05/HANDOFF.md` items #1–7 (no new requirement IDs — closes residual gaps in UPL-05 / UPL-06 / FUI-01 / FUI-09 friend-persona acceptance plus a Risk 2 carryover from 16.1-04 Task 4b)
**Success Criteria** (what must be TRUE):
  1. **Date-range filter responsive (item 1)**: changing date range or granularity (e.g., April + day grain) re-renders all charts in <500ms perceived response — no UI freeze, no SvelteKit `replaceState` re-fetch loop, no quadratic chartXDomain recomputation. Verified via Chrome MCP user-timing measurements at 375×667 against the documented baseline range that hung 16.1.
  2. **Forecast tooltip respects model selection AND aligns dots (item 2)**: `RevenueForecastCard.svelte` + `InvoiceCountForecastCard.svelte` `Tooltip.Root` (a) renders rows for every selected model — and only selected models — on every hovered bucket where data exists; (b) per-Spline `Highlight` dots land ON the corresponding Spline path within ±1px (verified by DOM inspection at 3 sample x-positions). The current symptom — only 1 of N selected models shown, dots drifting off-line — does not reproduce after the fix.
  3. **Visit-cohort tooltip layout fixed (item 3)**: the visit-number `Tooltip.Root` model section in `RepeaterCohortRevenueCard.svelte` / `CalendarItemsCard.svelte` (whichever variant ships D-16 model rows) renders `<label-LEFT> <value-RIGHT>` per row consistently — no flipped rows, no rows wrapping with the value pushed to the next line. Visual parity with the upper visit-cohort rows of the same tooltip.
  4. **Forecast Splines render in front of bars (item 4)**: `<Spline past>` and `<Spline future>` blocks render AFTER `<Bars>` in source order in `CalendarRevenueCard.svelte` + `CalendarCountsCard.svelte`. SVG paint order verified — past + future + CI band sit on top of stacked bars at every grain.
  5. **Visit-number week/month forecast coverage verified (item 5)**: SQL audit `SELECT DISTINCT model_name, granularity FROM forecast_with_actual_v WHERE granularity IN ('week','month') AND kpi_name='revenue_eur'` documented in CONTEXT.md. If sarimax/ets/theta exist in DB but are filtered in UI → wire them into the visit-number cards. If they don't exist by design → document as planned scope (deferred to a future phase) and update the model-selector to show only the available models without rendering empty options.
  6. **Prophet past-projection neutralized (item 6)**: Prophet does NOT render an exponentially-growing past-yhat line ahead of campaign era. Concretely: revert 16.1-04 Task 4b's window_start kwarg from `scripts/forecast/prophet_fit.py` (Path B fallback documented in `16.1-04-PLAN.md` as the explicit Risk 2 contingency); past-Spline branch becomes empty for Prophet only; future-Spline continues to render normally; `.planning/learnings/` records "Prophet `predict()` on past dates produces stationary-trend projection backward — Path A unsafe without CV harness" for future phases.
  7. **CampaignUpliftCard chart primitives complete (item 7)**: sparkline renders (a) a horizontal counterfactual baseline `<Rule y={0} stroke-dasharray="4 4">` (or equivalent) so the owner can see the "no campaign baseline" she's been told about by the legend chip; (b) Y-axis tick labels in € (e.g., `−€500`, `€0`, `+€500`) and X-axis tick labels in days-since-launch (e.g., `0`, `7`, `14`, `21`). The W4 LOCKED decision (Y-label as `<p>` ABOVE Chart) is preserved — only adding tick marks, not rotating the axis label.
  8. **Localhost-first Chrome MCP verification at 375×667 in `ja` AND `en` locales** BEFORE any DEV deploy (per `.claude/CLAUDE.md` localhost-first rule); zero console errors / `invalid_default_snippet` warnings on any modified component; backend pipeline regen (if Path B revert touches Python) ships via `migrations.yml` / `forecast-refresh.yml` `workflow_dispatch` on the feature branch BEFORE the visual QA at DEV.
  9. **Friend-persona re-acceptance**: owner re-runs the 5-card persona test at 375px in `ja` locale and confirms all 7 issues are resolved without surfacing new ones.
  10. **Planning-docs drift gate passes** (`.claude/scripts/validate-planning-docs.sh`)
**Plans**: 7 plans (all complete 2026-05-05)
Plans:
  **Wave 1 (parallel — independent investigations / pipeline regen)**
  - [x] 16.2-01-PLAN.md — Item 1 date-range freeze investigation + fix (PARTIAL — 71% blocking reduction, single-cascade residual deferred to v1.4 per user-accepted decision 2026-05-05)
  - [x] 16.2-04-PLAN.md — Item 5 visit-number week/month forecast coverage SQL audit (path A — DB has only naive_dow + prophet at week/month; selector already data-driven, no code change)
  - [x] 16.2-05-PLAN.md — Item 6 Prophet Path B revert (3 sites + cleanup step in prophet_fit.py) + forecast-refresh.yml workflow_dispatch regen + .planning/learnings/16.2-prophet-past-projection-path-b.md entry
  **Wave 2 (parallel — UI fixes; depend on Wave 1 perf fix for smooth visual QA)**
  - [x] 16.2-02-PLAN.md — Item 2 RevenueForecastCard + InvoiceCountForecastCard tooltip multi-model rows + per-Spline Highlight binding via points={{ fill: ... }} Circle config
  - [x] 16.2-03-PLAN.md — Items 3+4 (merged) CalendarRevenueCard + CalendarCountsCard tooltip model row flex layout fix + Spline z-order verification (path 3 — DOM evidence confirms paths-after-rects)
  - [x] 16.2-06-PLAN.md — Item 7 CampaignUpliftCard Rule baseline + Y-axis € ticks + X-axis day-number ticks (W4 Y-label preserved per D-18)
  **Wave 3 (sequential — phase-final QA gate)**
  - [x] 16.2-07-PLAN.md — Cross-card localhost QA aggregated (en + ja spot-check); DEV final QA deferred to /gsd-ship; STATE/ROADMAP update + drift gate
**UI hint**: yes

### Phase 16.3: Dashboard Cleanup + Events Everywhere (INSERTED 2026-05-06)
**Goal**: Friend-persona feedback (2026-05-06) — the two dedicated forecast cards (`RevenueForecastCard`, `InvoiceCountForecastCard`) don't drive any business decision for the owner; remove them. The vertical event-marker overlay currently confined to those two cards (campaigns / holidays / school holidays / recurring events / transit strikes) DOES help her reason about the calendar — bring it to every remaining dashboard chart via a new mobile-first per-bucket badge strip that scales across day / week / month grains and elegantly handles overlapping events (e.g. strike-on-holiday) and high event density (week / month buckets carrying 5+ events). Pure UI simplification + cross-chart event overlay; no pipeline, no SQL, no Phase 17 preemption.
**Depends on**: Phase 16.2 (events ship to UI via `/api/forecast` payload; pipeline stays intact). Phase 17 backtest gate is unaffected. Continues on a fresh `feature/phase-16.3-dashboard-cleanup-events-everywhere` branch off main post-16.2-merge.
**Requirements**: derived from 2026-05-06 owner conversation (no new req IDs — UX simplification + cross-chart event overlay; closes residual UPL-05 / FUI-09 friend-persona-acceptance gaps around event visibility outside the forecast cards)
**Success Criteria** (what must be TRUE):
  1. **Forecast cards removed**: `src/lib/components/RevenueForecastCard.svelte`, `src/lib/components/InvoiceCountForecastCard.svelte`, and `src/lib/components/ForecastHoverPopup.svelte` deleted from disk; their imports + slots in `src/routes/+page.svelte` removed; `npm run check` (svelte-check) stays green; no broken imports anywhere in `src/`.
  2. **Forecast pipeline preserved**: `/api/forecast` endpoint, `forecast_daily` / `forecast_with_actual_v` / forecast cron / `forecast_quality`, `forecastOverlay.svelte.ts`, `ForecastLegend.svelte`, `ModelAvailabilityDisclosure.svelte`, `forecastEventClamp.ts`, and `EventMarker.svelte` all remain on disk and functional. Verified: `CalendarRevenueCard` + `CalendarCountsCard` + `CampaignUpliftCard` still render their existing past-forecast / counterfactual content end-to-end on DEV.
  3. **`EventBadgeStrip` component delivered**: new component renders a fixed-height horizontal strip of badges aligned to the parent chart's x-axis. One badge per **bucket** (not per event). Single-event bucket → badge tinted with the event type's existing color (campaign=red `#dc2626`, holiday=green `#16a34a`, recurring=yellow `#eab308`, school_holiday=teal `#5eead4`, transit_strike=red `#dc2626` — same palette as `EventMarker.svelte` lines 60-113). Multi-event bucket → mixed/striped badge with a count number (`2`, `3`, `5+`).
  4. **Per-bucket popup**: tap or hover on any badge opens a popup listing every event in that bucket, each row showing date / type / label. Cap visible rows at ~10 with a "show all" expander on month grain. Reuses the existing `ForecastHoverPopup.svelte` styling pattern (after that file is deleted, lift its CSS into the new popup or into a shared util — planning will decide).
  5. **`EventBadgeStrip` wired into every applicable chart**: `CalendarRevenueCard.svelte`, `CalendarCountsCard.svelte`, `CohortRetentionCard.svelte` (if it has a date-based x-axis at the active grain), `RepeaterCohortRevenueCard.svelte` / VA-09 visit-sequence transaction-count chart (期間別取引件数 — 来店回数別), and any other chart on `+page.svelte` whose x-axis is date-based. Planning inventories the full list; QA confirms no chart with a date axis is missed.
  6. **Mobile QA at 375×667 via Chrome MCP**: badges meet a ≥44×44px tap-target minimum; no horizontal overflow on any chart card; popup is fully readable without truncation; events from a busy week (school-holiday week with multiple national holidays) all surface inside one bucket popup; verified in `ja` AND `en` locales.
  7. **Localhost-first verification before DEV deploy** (per `.claude/CLAUDE.md`); zero console errors / `invalid_default_snippet` warnings on any modified component.
  8. **Friend-persona acceptance**: owner opens the dashboard on her phone, sees campaign markers on the calendar revenue chart for the 2026-04-14 campaign launch, taps and reads the campaign name + date — confirms it's useful AND notes she does not miss the deleted forecast cards.
  9. **Planning-docs drift gate passes** (`.claude/scripts/validate-planning-docs.sh`).
**Plans**: TBD (planner will break down — likely Wave 1 deletion + page wiring, Wave 2 EventBadgeStrip component + per-chart wiring, Wave 3 mobile QA + persona test)
**UI hint**: yes

### Phase 17: Backtest Gate & Quality Monitoring
**Goal**: A weekly rolling-origin CV harness scores every model at 4 horizons (7d/35d/120d/365d), conformal-calibrates the 35d CI, gates promotion on ≥10% RMSE improvement vs a regressor-aware naive baseline, and writes a public ACCURACY-LOG that stays honest even when the simpler model wins
**Depends on**: Phase 16 (need ≥4 weeks of forecast-vs-actual history to gate on; cold-start handled by "BACKTEST PENDING" UI badge until day 28)
**Requirements**: BCK-01, BCK-02, BCK-03, BCK-04, BCK-05, BCK-06, BCK-07, BCK-08
**Success Criteria** (what must be TRUE):
  1. `backtest.py` runs `statsforecast.cross_validation` with rolling-origin folds at 4 horizons (`h=7`, `h=35`, `h=120`, `h=365`), computing RMSE + MAPE per `(model × horizon × fold)` and writing rows to `forecast_quality` with `evaluation_window='rolling_origin_cv'`; `ConformalIntervals(h=35, n_windows=4)` calibrates 95% CIs at horizons ≥35d; long horizons (120d, 365d) carry an `uncalibrated — ≥2 years data needed` UI badge until the 2-year mark (cold start handled with "BACKTEST PENDING — gathering 7 days of evidence" badge until day 8)
  2. Backtest comparisons use a regressor-aware naive baseline (same exog regressors as competing models) — every fold reports BOTH `naive_dow` and `naive_dow_with_holidays` RMSE; the gate compares against the higher of the two to prevent unfair gains from regressor-only access
  3. Promotion gate: any model promoted from feature-flag to production must beat the regressor-aware naive baseline by ≥10% RMSE on rolling-origin out-of-sample, computed per horizon; gate failure blocks the deploy workflow; `feature_flags.{model}.enabled` cannot flip true unless the latest `forecast_quality` row passes
  4. `forecast-backtest.yml` GHA workflow runs weekly on Tuesday 23:00 UTC and writes results to `forecast_quality`; `forecast-quality-gate.yml` runs on every forecast-engine PR and fails CI when gate criteria miss for any model already promoted to production; both workflows complete in <5 min on `ubuntu-latest`
  5. `docs/forecast/ACCURACY-LOG.md` auto-committed weekly with RMSE history per `(model × horizon)`, with each row showing the gate verdict (`PASS` / `FAIL` / `PENDING`); when no model beats naive, the log honestly records "naive-DoW-with-holidays remains production model — no challenger promoted this week"
  6. Freshness-SLO check on every `+page.server.ts` load: if `pipeline_runs.upstream_freshness_h > 24` for any cascade stage (external-data, forecast, MV refresh), the dashboard renders the stale-data badge from Phase 15; a deliberate weather-fetch failure in CI verifies the badge surfaces within one nightly cycle
**Plans**: 10 plans — COMPLETE 2026-05-06 (ready for /gsd-ship)
  - [x] 17-01-PLAN.md — Migration 0067 + FreshnessLabel >24h threshold (BCK-04, BCK-08)
  - [x] 17-02-PLAN.md — conformal.py pure-numpy quantile math (BCK-02)
  - [x] 17-03-PLAN.md — naive_dow_with_holidays.py regressor-aware baseline (BCK-03; defect 119ad45 fixed during 17-10 QA: `_fit` suffix + FORECAST_TRACK env honor)
  - [x] 17-04-PLAN.md — argparse retrofit on 5 fit scripts (BCK-01)
  - [x] 17-05-PLAN.md — backtest.py rolling-origin CV driver + gate writer (BCK-01..04)
  - [x] 17-06-PLAN.md — run_all.py feature_flags AND-intersect (BCK-04)
  - [x] 17-07-PLAN.md — forecast-backtest.yml + write_accuracy_log.py + ACCURACY-LOG.md (BCK-05, BCK-07)
  - [x] 17-08-PLAN.md — forecast-quality-gate.yml + quality_gate_check.py (BCK-06)
  - [x] 17-09-PLAN.md — ModelAvailabilityDisclosure backtest pills + i18n + /api/forecast (BCK-01, BCK-02)
  - [x] 17-10-PLAN.md — Phase-final QA + planning-docs drift gate (BCK-01..08 sign-off; 5 PASS + 3 PARTIAL with merge-deferred resolution)

### Phase Details — Current Milestone (v1.4)

### Phase 18: Weekly Counterfactual Window
**Goal**: Replace CampaignUpliftCard's cumulative-since-launch headline with a per-ISO-week (Mon–Sun) counterfactual answer plus a tap-scrubbable bar-chart history of all completed weeks since campaign launch — friend-owner gets a fresh weekly read on whether the campaign is working, not a cumulative number that drifts toward "no detectable lift" the longer it runs.
**Depends on**: Phase 16 (`campaign_uplift` table + `CampaignUpliftCard` exist; `cumulative_uplift.py` pipeline writes nightly)
**Requirements**: UPL-08, UPL-09
**Success Criteria** (what must be TRUE):
  1. `scripts/forecast/cumulative_uplift.py` writes one `campaign_uplift` row per (campaign_id × model × completed-ISO-week × as_of_date) with `window_kind = 'iso_week'`; bootstrap CI (1000 paths, 95%) is RE-FIT on the 7-day slice — never derived by subtracting daily cumulative bounds (correlated samples don't subtract additively); partial launch week (Apr 13–19 for friend's 2026-04-14 campaign — campaign-day-1 is Tue) is excluded by symmetry with the trailing-edge "skip in-progress week" rule
  2. `/api/campaign-uplift` returns `weekly_history: Array<{iso_week_start, iso_week_end, point_eur, ci_lower_eur, ci_upper_eur, n_days, model_name}>` for each model, plus `headline_week` pointing to the most recent completed ISO week; service-role bypass for `last_completed_week` does not leak across tenants (verified by RLS audit)
  3. CampaignUpliftCard hero replaces "Since April 14th" with "Week of [Mon] – [Sun]" — same maturity-tier × CI-overlap matrix logic from UPL-06 reused; current 7-key i18n hero set retains semantics, with date label now per-week instead of per-launch
  4. Bar chart below hero: one bar per fully-completed ISO week since campaign launch, rendered with LayerChart (matching existing sparkline tech); CI whiskers overlay each bar; bars colored by significance — gray (CI straddles 0), green (CI > 0 fully), red (CI < 0 fully); tap a bar → hero updates to that week's read; dashed y=0 baseline preserved (matches existing `Rule y={0}`); X axis = ISO week labels, Y axis = € uplift
  5. ModelAvailabilityDisclosure / regime-tier copy continue to work — the maturity tier is now derived from `n_days` of the selected week (always 7 for fully-completed weeks → "mature" tier kicks in immediately for any week with full data, but card hides until first ISO week completes per Q3 rule)
  6. Mobile-first: bar chart usable on 375×667 phone canvas; horizontal scroll once weeks exceed ~10 (matches Calendar* card pattern); touch events do not block vertical page scroll (`touchEvents: 'auto'` per existing memory)
**Plans**: 7 plans
  - [ ] 18-01-PLAN.md — migration 0069: campaign_uplift iso_week CHECK + weekly_v wrapper view (UPL-08)
  - [ ] 18-02-PLAN.md — pipeline writer compute_iso_week_uplift_rows + bootstrap CI re-fit per 7-day slice (UPL-08)
  - [ ] 18-03-PLAN.md — /api/campaign-uplift weekly_history payload field (UPL-08)
  - [ ] 18-04-PLAN.md — CampaignUpliftCard hero rewrite (Decision A: weeks-since-launch tier source) (UPL-08, UPL-09)
  - [ ] 18-05-PLAN.md — bar chart + CI whiskers + tap-to-scrub (Decision B path) (UPL-08, UPL-09)
  - [ ] 18-06-PLAN.md — i18n keys (uplift_week_label etc.) + ModelAvailabilityDisclosure compatibility check (UPL-09)
  - [ ] 18-07-PLAN.md — phase-final QA on DEV + planning-docs drift gate (UPL-08, UPL-09 sign-off)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 6/6 | Complete | 2026-04-14 |
| 2. Ingestion | v1.0 | 4/4 | Complete | 2026-04-14 |
| 3. Analytics SQL | v1.0 | 5/5 | Complete | 2026-04-14 |
| 4. Mobile Reader UI | v1.0 | 5/5 | Complete | 2026-04-14 |
| 5. Insights & Forkability | v1.0 | 9/9 | Complete | 2026-04-15 |
| 6. Filter Foundation | v1.1 | 5/5 | Complete | 2026-04-15 |
| 7. Column Promotion | v1.1 | 4/4 | Complete | 2026-04-15 |
| 8. Visit Attribution Data Model | v1.2 | 2/2 | Complete | 2026-04-16 |
| 9. Filter Simplification & Performance | v1.2 | 5/5 | Complete   | 2026-04-17 |
| 10. Charts | v1.2 | 7/8 | Complete    | 2026-04-17 |
| 11. SSR Performance & Recovery | v1.2 | 3/3 | Complete | 2026-04-21 |
| 12. Foundation — Decisions & Guards | v1.3 | 4/4 | Complete | 2026-04-28 |
| 13. External Data Ingestion | v1.3 | 8/8 | Complete | 2026-04-30 |
| 14. Forecasting Engine — BAU Track | v1.3 | 10/10 | Complete | 2026-04-30 |
| 15. Forecast Chart UI | v1.3 | 9/9 | Complete | 2026-05-01 |
| 16. ITS Uplift Attribution | v1.3 | 13/13 | Complete | 2026-05-04 |
| 16.1. Friend-Persona UX Polish (INSERTED) | v1.3 | 5/5 | Complete | 2026-05-04 |
| 16.2. Friend-Persona QA Gap Closure (INSERTED) | v1.3 | 7/7 | Complete | 2026-05-05 |
| 16.3. Dashboard Cleanup + Events Everywhere (INSERTED) | v1.3 | 3/3 | Complete | 2026-05-06 |
| 17. Backtest Gate & Quality Monitoring | v1.3 | 10/10 | Complete | 2026-05-06 |
| 18. Weekly Counterfactual Window | v1.4 | 0/7 | Planning | — |

## Coverage Summary

- **v1.0 requirements:** 39 (shipped)
- **v1.1 requirements:** 14 (Phases 6-7 complete; Phases 8-11 superseded by v1.2)
- **v1.2 requirements:** 13
- **v1.3 requirements:** 47 (FND-09..11, EXT-01..09, FCS-01..11, FUI-01..09, UPL-01..07, BCK-01..08)
- **v1.4 requirements:** 2 (UPL-08, UPL-09)
- **Mapped:** 115 (100%)
- **Orphaned:** 0
- **Duplicated:** 0

### v1.2 Coverage Map

| Requirement | Phase |
|-------------|-------|
| VA-01 | Phase 8 — Visit Attribution Data Model |
| VA-02 | Phase 8 — Visit Attribution Data Model |
| VA-03 | Phase 8 — Visit Attribution Data Model |
| VA-04 | Phase 10 — Charts |
| VA-05 | Phase 10 — Charts |
| VA-06 | Phase 10 — Charts |
| VA-07 | Phase 10 — Charts |
| VA-08 | Phase 10 — Charts |
| VA-09 | Phase 10 — Charts |
| VA-10 | Phase 10 — Charts |
| VA-11 | Phase 9 — Filter Simplification & Performance |
| VA-12 | Phase 9 — Filter Simplification & Performance |
| VA-13 | Phase 9 — Filter Simplification & Performance |

### v1.3 Coverage Map

| Requirement | Phase |
|-------------|-------|
| FND-09 | Phase 12 — Foundation: Decisions & Guards |
| FND-10 | Phase 12 — Foundation: Decisions & Guards |
| FND-11 | Phase 12 — Foundation: Decisions & Guards |
| EXT-01 | Phase 13 — External Data Ingestion |
| EXT-02 | Phase 13 — External Data Ingestion |
| EXT-03 | Phase 13 — External Data Ingestion |
| EXT-04 | Phase 13 — External Data Ingestion |
| EXT-05 | Phase 13 — External Data Ingestion |
| EXT-06 | Phase 13 — External Data Ingestion |
| EXT-07 | Phase 13 — External Data Ingestion |
| EXT-08 | Phase 13 — External Data Ingestion |
| EXT-09 | Phase 13 — External Data Ingestion |
| FCS-01 | Phase 14 — Forecasting Engine: BAU Track |
| FCS-02 | Phase 14 — Forecasting Engine: BAU Track |
| FCS-03 | Phase 14 — Forecasting Engine: BAU Track |
| FCS-04 | Phase 14 — Forecasting Engine: BAU Track |
| FCS-05 | Phase 14 — Forecasting Engine: BAU Track |
| FCS-06 | Phase 14 — Forecasting Engine: BAU Track |
| FCS-07 | Phase 14 — Forecasting Engine: BAU Track |
| FCS-08 | Phase 14 — Forecasting Engine: BAU Track |
| FCS-09 | Phase 14 — Forecasting Engine: BAU Track |
| FCS-10 | Phase 14 — Forecasting Engine: BAU Track |
| FCS-11 | Phase 14 — Forecasting Engine: BAU Track |
| FUI-01 | Phase 15 — Forecast Chart UI |
| FUI-02 | Phase 15 — Forecast Chart UI |
| FUI-03 | Phase 15 — Forecast Chart UI |
| FUI-04 | Phase 15 — Forecast Chart UI |
| FUI-05 | Phase 15 — Forecast Chart UI |
| FUI-06 | Phase 15 — Forecast Chart UI |
| FUI-07 | Phase 15 — Forecast Chart UI |
| FUI-08 | Phase 15 — Forecast Chart UI |
| FUI-09 | Phase 15 — Forecast Chart UI |
| UPL-01 | Phase 16 — ITS Uplift Attribution |
| UPL-02 | Phase 16 — ITS Uplift Attribution |
| UPL-03 | Phase 16 — ITS Uplift Attribution |
| UPL-04 | Phase 16 — ITS Uplift Attribution |
| UPL-05 | Phase 16 — ITS Uplift Attribution |
| UPL-06 | Phase 16 — ITS Uplift Attribution |
| UPL-07 | Phase 16 — ITS Uplift Attribution |
| BCK-01 | Phase 17 — Backtest Gate & Quality Monitoring |
| BCK-02 | Phase 17 — Backtest Gate & Quality Monitoring |
| BCK-03 | Phase 17 — Backtest Gate & Quality Monitoring |
| BCK-04 | Phase 17 — Backtest Gate & Quality Monitoring |
| BCK-05 | Phase 17 — Backtest Gate & Quality Monitoring |
| BCK-06 | Phase 17 — Backtest Gate & Quality Monitoring |
| BCK-07 | Phase 17 — Backtest Gate & Quality Monitoring |
| BCK-08 | Phase 17 — Backtest Gate & Quality Monitoring |

### v1.4 Coverage Map

| Requirement | Phase |
|-------------|-------|
| UPL-08 | Phase 18 — Weekly Counterfactual Window |
| UPL-09 | Phase 18 — Weekly Counterfactual Window |

**UPL-08:** Pipeline computes per-ISO-week counterfactual uplift with bootstrap CI re-fit on the 7-day slice; persists weekly history rows (one per fully-completed Mon–Sun week since campaign launch).

**UPL-09:** Dashboard CampaignUpliftCard replaces cumulative-since-launch hero with last-completed-week read + bar-chart history (CI whiskers, color-coded by significance, tap-to-scrub).

### v1.3 Dependencies & Parallelism

- **Phase 12 → 13:** CI grep guard must exist before any new migration (mechanical `tenant_id` → `restaurant_id` rename of §7 sketches)
- **Phase 13 → 14:** External-data tables must exist before SARIMAX exog matrix can be assembled
- **Phase 14 ↔ 15:** Parallel-eligible after Phase 14's schema + first model (SARIMAX) lands — research synthesis estimates 30–40% schedule compression; UI work in Phase 15 can mock against real `forecast_daily` rows once the schema is up
- **Phase 14 → 16:** BAU forecast must be stable before Track-B counterfactual is meaningful (BAU is the apples-to-apples benchmark)
- **Phase 15 → 16:** UI scaffolding (`ForecastHoverPopup` cum-deviation row, `EventMarker` campaign-start overlay) must be settled before `CampaignUpliftCard` layout can compose with it cleanly
- **Phase 16 → 17:** Need ≥4 weeks of forecast-vs-actual history to gate on; cold-start UI badge "BACKTEST PENDING" handles days 1–7

### Historical Coverage

| Category | Count | Phase |
|----------|-------|-------|
| FND-01..08 | 8 | Phase 1 |
| ING-01..05 | 5 | Phase 2 |
| ANL-01..09 | 9 | Phase 3 |
| UI-01..11 | 11 | Phase 4 |
| INS-01..06 | 6 | Phase 5 |
| FLT-01..04, FLT-07 | 5 | Phase 6 |
| DM-01..03, FLT-05 | 4 | Phase 7 |

### Superseded (v1.1 Phases 8-11 replaced by v1.2)

The following v1.1 requirements were superseded by v1.2 and are no longer on the roadmap:
- FLT-06, DM-04..08 (Phase 8 Star Schema) — replaced by VA-01 visit_seq approach
- CHT-01..04 (Phase 9 Chart Rollups) — replaced by VA-04..10 chart set
- CHT-05..10 (Phase 10 Chart Components) — replaced by VA-04..10 chart set
- BUG-01..02 (Phase 11 Bug Fixes) — views being dropped make these moot

---
*Roadmap created: 2026-04-13*
*v1.1 Dashboard Redesign milestone added: 2026-04-15*
*v1.2 Dashboard Simplification & Visit Attribution: 2026-04-16 (Phases 8-11 superseded)*
*v1.3 External Data & Forecasting Foundation: 2026-04-27 (Phases 12-17 — driving artifact at .planning/phases/12-forecasting-foundation/12-PROPOSAL.md)*
