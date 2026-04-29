---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: External Data & Forecasting Foundation
status: "Phase 13 implementation complete on feature/phase-13-external-data-ingestion (24 commits ahead of main, head c5be916) — awaiting review + ship sequence"
stopped_at: Phase 13 (External Data Ingestion) implementation complete on `feature/phase-13-external-data-ingestion` (24 commits ahead of main, head `c5be916`). Shipped artifacts on the phase branch: 7 migrations `0041_weather_daily.sql` → `0047_shop_calendar.sql` (hybrid-RLS for shared location-keyed tables, tenant-scoped RLS for `pipeline_runs`/`shop_calendar`), all Python fetchers under `scripts/external/` (weather/holidays/school/transit/events/shop_calendar) + `run_all.py` orchestrator + `pipeline_runs_writer.py`, configs (`config/shop_hours.yaml`, `config/recurring_events.yaml` 14-event starter), `.github/workflows/external-data-refresh.yml` (nightly cron `0 0 * * *` UTC + `workflow_dispatch` backfill), `pytest-external` job in `tests.yml`, `tests/external/` (8 unit test files), `tests/integration/tenant-isolation` extended for 7 new tables, ci-guard `scripts/ci-guards/check-cron-schedule.py`, TDD plan `docs/superpowers/plans/2026-04-29-phase-13-external-data-ingestion.md` (3,140 lines). Workflow rows actually executed: 1-3 (STATE), 4 (DESIGN — office-hours + override), 8 (worktree), 9 (writing-plans), 10 (subagent-driven-development). Skipped: row 5 (`/gstack-autoplan`). Outstanding: rows 12 (`/qa-gate` — claimed but no artifact), 15 (`/gstack-review`), 16 (`/gstack-cso` — Tier 3 mandatory: 7 migrations + new RLS), 17 (`/gsd-verify-work`), 18 (`/gsd-ship`), 19 (`/gstack-retro`).
last_updated: "2026-04-29T00:00:00Z"
progress:
  total_phases: 17
  completed_phases: 11
  total_plans: 60
  completed_plans: 60
  percent: 65
---

# STATE: Ramen Bones Analytics

**Last updated:** 2026-04-29

## Project Reference

- **Core Value:** A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see.
- **Current Focus:** Phase 13 — External Data Ingestion (implementation complete on phase branch; awaiting review + ship)
- **Timeline:** Slow and deliberate — understand data first, ship one layer at a time
- **Granularity:** standard
- **Tenants in v1:** 1 (architecture multi-tenant-ready)

## Current Position

Milestone: v1.3 (External Data & Forecasting Foundation)
Phase: 13 (External Data Ingestion) — Implementation complete on `feature/phase-13-external-data-ingestion` (24 commits, head `c5be916`); awaiting review + ship
Plan: `docs/superpowers/plans/2026-04-29-phase-13-external-data-ingestion.md` (Superpowers TDD, 3,140 lines)

- **Status:** Phase 13 fully built on phase branch — 7 migrations (`0041_weather_daily.sql` → `0047_shop_calendar.sql`), all Python fetchers (`scripts/external/{weather,holidays,school,transit,events,shop_calendar}.py` + `run_all.py` + `pipeline_runs_writer.py`), configs (`shop_hours.yaml`, `recurring_events.yaml`), GHA workflow `external-data-refresh.yml` (cron `0 0 * * *` UTC + workflow_dispatch backfill), `pytest-external` CI job, 8 unit test files, tenant-isolation extended for 7 new tables, ci-guard `check-cron-schedule.py`. Branch unmerged. Phase 12 shipped via [PR #15](https://github.com/shiniguchi/ramen-bones-analytics/pull/15) (merged `2ff6ca0`).
- **Progress:** [████████░░] 71% (12/17 phases shipped; v1.0+v1.1+v1.2 done; Phase 12 merged; Phase 13 built but unmerged)
- **Last activity:** 2026-04-29 — STATE.md realigned to reflect Phase 13 actual state; previous unstale (`f67d481`) had Phase 13 marked at "context gathered" but reality is implementation complete on phase branch
- **v1.2 closed:** 11 phases, 60 plans, 100% — Phase 11 SSR fix landed 2026-04-21
- **v1.0 status:** Shipped to friend (97% plans complete; repo flipped PUBLIC 2026-04-15 with topics + description set; Plan 05-06 Task 2 fork walkthrough deferred out of v1 scope)

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases planned | 17 (5 v1.0 + 2 v1.1 + 4 v1.2 + 6 v1.3) |
| Phases complete | 11 |
| Requirements mapped | 113/113 (39 v1.0 + 14 v1.1 + 13 v1.2 + 47 v1.3) |
| Plans executed | 60 |
| Phase 01-foundation P05 | 5m | 2 tasks | 4 files |
| Phase 01-foundation P06 | 20min | 3 tasks | 9 files |
| Phase 02-ingestion P01 | 6min | 2 tasks | 5 files |
| Phase 02-ingestion P02 | 10min | 2 tasks | 6 files |
| Phase 02-ingestion P03 | 8min | 2 tasks | 10 files |
| Phase 02-ingestion P04 T1 | 5min | 1 task | 2 files |
| Phase 02-ingestion P04 T2 | 8min | 1 task | 3 files |
| Phase 02-ingestion P04 full | ~55min | 3 tasks | 8 files |
| Phase 03-analytics-sql P01 | ~5min | 2 tasks | 3 files |
| Phase 03-analytics-sql P02 | 2min | 1 tasks | 3 files |
| Phase 03-analytics-sql P03 | 15min | 1 tasks | 2 files |
| Phase 03-analytics-sql P04 | 25min | 1 tasks | 2 files |
| Phase 03 P05 | 6min | 2 tasks | 4 files |
| Phase 04 P01 | 18min | 2 tasks | 28 files |
| Phase 04 P02 | 6min | 2 tasks | 20 files |
| Phase 04-mobile-reader-ui P03 | 4 | 2 tasks | 6 files |
| Phase 04 P04 | 8 | 2 tasks | 12 files |
| Phase 04-mobile-reader-ui P05 | 4 | 2 tasks | 9 files |
| Phase 04-mobile-reader-ui P08 | 6min | 2 tasks | 4 files |
| Phase 04 P07 | 10min | 2 tasks | 3 files |
| Phase 04-mobile-reader-ui P06 | 15min | 3 tasks | 10 files |
| Phase 05-insights-forkability P01 | 8min | 2 tasks | 2 files |
| Phase 05-insights-forkability P02 | 6min | 2 tasks | 6 files |
| Phase 05-insights-forkability P04 | 5min | 2 tasks | 5 files |
| Phase 05-insights-forkability P03 | 12min | 2 tasks | 5 files |
| Phase 05-insights-forkability P05 | 7min | 2 tasks | 4 files |
| Phase 06-filter-foundation P02 | 12min | 2 tasks | 10 files |
| Phase 06 P01 | 8min | 3 tasks | 9 files |
| Phase 06-filter-foundation P03 | 18min | 2 tasks | 3 files |
| Phase 06 P04 | 9min | 2 tasks | 8 files |
| Phase 06-filter-foundation P05 | 4min | 1 tasks | 4 files |
| Phase 09-filter-simplification-performance P01 | 6min | 2 tasks | 6 files |
| Phase 09 P02 | 8min | 2 tasks | 12 files |
| Phase 09 P03 | 45 min | 5 tasks | 5 files |
| Phase 09 P04 | 7min | 3 tasks | 3 files |
| Phase 09-filter-simplification-performance P05 | 4min | 3 tasks | 7 files |
| Phase 10-charts P01 | 11min | 4 tasks | 12 files |
| Phase 10-charts P03 | 4min | 2 tasks | 2 files |
| Phase 10-charts P02 | 4min | 1 tasks | 1 files |
| Phase 10-charts P04 | 6min | 2 tasks | 6 files |
| Phase 10-charts P06 | 4min | 2 tasks | 4 files |
| Phase 10-charts P07 | 4min | 2 tasks | 5 files |
| Phase 10-charts P05 | 6min | 2 tasks | 6 files |
| Phase 10-charts P08 | 7min | 3 tasks | 3 files |

## Accumulated Context

### Key Decisions (from PROJECT.md)

- Single-tenant v1, multi-tenant architecture from day 1
- SvelteKit 2 + Svelte 5 + `adapter-cloudflare` on Cloudflare Pages
- Supabase Postgres + pg_cron + materialized views (not dbt)
- Playwright CSV scraper on GitHub Actions cron (ISV API pending)
- Daily refresh cadence; no realtime
- Card hash as customer ID; never store PAN/PII
- Free + forkable business model

### v1.3 Strategic Decisions (from research synthesis 2026-04-27)

- **Two-track architecture in one table** via `forecast_track` discriminator (`'bau'` | `'cf'`) — single MV, single wrapper view, single orchestrator serves both BAU and counterfactual fits
- **Hybrid RLS pattern:** shared location-keyed tables (weather/holidays/school/transit/events) use `for select using (true)`; tenant-scoped tables (`pipeline_runs`/`shop_calendar`/`forecast_daily`/`campaign_calendar`) use `auth.jwt()->>'restaurant_id'`
- **JWT claim is `restaurant_id`, NOT `tenant_id`** — proposal §7 sketches must be mechanically renamed before pasting; CI grep guard added in Phase 12 catches regressions
- **Cron schedules anchored in UTC, not Berlin local** — `external-data` 00:00 UTC, `forecast-refresh` 01:00 UTC, `forecast-mv-refresh` 03:00 UTC, `forecast-backtest` Tuesday 23:00 UTC; ≥60-min gap between cascade stages prevents DST inversions
- **Sample-path resampling is mandatory and server-side** — 1000 paths × 365d × N models stored in `forecast_daily.yhat_samples jsonb`; clients only ever see aggregated mean+CI; summing daily `yhat_lower`/`yhat_upper` for week/month is a documented anti-pattern
- **Track-B fits on pre-campaign era only** with `TRAIN_END = campaign_start − 7 days` (anticipation buffer); `pipeline_runs.fit_train_end` records the cutoff for every CF refit; CI test asserts no campaign-era row leaked into a Track-B fit
- **`revenue_comparable_eur` for ITS attribution** strips post-launch new menu items (Onsen EGG, Tantan, Hell beer per 2026-04-27 audit); Track-B never fits on raw revenue
- **Mobile-first chart defaults:** 1 forecast line + naive baseline + CI band only; Prophet/Chronos/NeuralProphet/ensemble are toggle-on via legend; default OFF on 375px to prevent spaghetti
- **Open-Meteo "non-commercial" gray zone:** production deployment defaults to `WEATHER_PROVIDER=brightsky` (DWD public-domain); Open-Meteo is local-dev only; switching cost = one env var
- **Prophet `yearly_seasonality=False` hard-pinned until `len(history) >= 730`** — silent auto-flip at 2026-06-11 would fit Fourier ghosts on a single annual cycle
- **Stack additions:** 9 new Python deps (`statsmodels`, `prophet==1.3.0` + `holidays>=0.25,<1`, `statsforecast`, `utilsforecast`, `openmeteo-requests`, `httpx`, `feedparser`, `PyYAML`); 0 new JS deps (LayerChart 2.0.0-next.54 already provides Spline/Area/Rule/Tooltip primitives)

### Load-Bearing Architectural Rules

1. RLS + security-definer wrapper views must exist BEFORE the first MV is built
2. Raw ingest idempotent via natural-key upsert `(restaurant_id, source_tx_id)` + 2-day overlap window
3. Every read path goes through `*_v` wrappers; `REVOKE ALL` on MVs; tenant id only from signed JWT claim
4. (v1.3) GHA schedules Python; pg_cron schedules SQL refreshes only; communication via `pipeline_runs`
5. (v1.3) `LazyMount` deferred load mandatory for `/api/forecast`, `/api/forecast-quality`, `/api/campaign-uplift` per Phase 11 lessons (CF Workers Error 1102 risk)

### Top Risks (from PITFALLS.md)

1. RLS silently bypassed via materialized views — solved structurally in Phase 1
2. Cohort survivorship / short-history LTV shown without caveat — solved in Phase 3 SQL, surfaced in Phase 4 UI
3. Timezone off-by-one day boundary — solved in Phase 1 via `business_date` column
4. Claude hallucinates a number — solved in Phase 5 via digit-guard + deterministic fallback
5. Founder scope creep — enforced by FEATURES.md P1 contract across every phase
6. (v1.3) Prophet `yearly_seasonality='auto'` silently flips at 2026-06-11 — Phase 14 hard-pins to False until 730d
7. (v1.3) SARIMAX exog leakage between fit-time actuals and predict-time forecasts — Phase 14 logs `exog_signature` per fit
8. (v1.3) Track-B trend extrapolation in declining 10-month pre-period inflates uplift — Phase 16 cross-checks against `naive_dow_uplift_eur`
9. (v1.3) Concurrent intervention contamination (3 new menu items at campaign start) — Phase 12 audit + Phase 16 `revenue_comparable_eur` filter
10. (v1.3) Stale weather → silent stale forecast — Phase 17 freshness-SLO badges + `pipeline_runs.upstream_freshness_h` check before forecast cron runs
11. (v1.3) Mobile chart spaghetti — Phase 15 default = 1 forecast line + CI band; Chrome MCP localhost-first verification per `.claude/CLAUDE.md`

### Decisions

- (02-02) vitest css.postcss stub neutralizes parent-dir postcss config conflicts so wave-0 tests can run
- [Phase 02-ingestion]: Upsert chunk size 500 rows (~500KB/batch) for both staging and transactions — half Supabase 1MB payload cap
- [Phase 02-ingestion]: transactions_new/updated computed via restaurant-scoped pre/post count delta (supabase-js has no insert-vs-update response signal)
- [Phase 02-ingestion 04-T1]: Integration tests fetch seeded restaurant_id via admin query (0005 generates UUID, no hardcoded literal). SUPABASE_* env overridden in beforeAll from TEST_* pair. Fixture uploaded to orderbird-raw/test/sample.csv via service-role client; truncation scoped to restaurant_id.
- [Phase 02-ingestion 04-T2]: Real CSV run against DEV — rows_read=20948, invoices_deduped=6842, missing_worldline_rows=772, errors=0. Idempotency verified (second run transactions_new=0, row counts stable at 20948/6842). Rule 3 deviation: migration 0009 added to auto-provision orderbird-raw bucket so forkers don't hit blocking upload failure.
- [Phase 02-ingestion 04]: payment_method normalized upstream in CSV generator; loader switched to trim-only pass-through (one source of truth, DB byte-matches CSV). Unit test T-8 updated to pin pass-through.
- [Phase 02-ingestion 04]: net_cents computed per line item (Σ round(item_gross_cents/(1+rate/100))) not at invoice grain — mixed 7%/19% food+drink invoices (1,775 of them) were previously skewed. Integer cents math, nulls contribute 0.
- [Phase 02-ingestion 04]: April 2026 Worldline blackout (2026-04-01..04-11) — upstream Orderbird→Worldline join breaks in tail window. Data still ingested; reporting aggregates in 02-04-REAL-RUN.md scoped to [Jun 11 2025, Mar 31 2026] Berlin. Phase 3 must caveat April.
- [Phase 02-ingestion 04]: missing_worldline_rows is diagnostic not exclusionary — those invoices persist with card_hash=NULL; revenue unaffected, only cohort linkage lost.
- [Phase 02-ingestion 04-T3]: Founder ING-05 sign-off received ("approved"). ≥25 top-grossing invoices cross-checked against CSV — gross/tip/payment_method/card_hash/Berlin conversion all match.
- [Phase 03-analytics-sql 01]: Wave 0 RED test scaffold authored before any production SQL — 15 it.todo stubs across 8 ANL describe blocks + 3-customer ISO-Monday fixture + ci-guards contract test. Downstream plans 03-02..05 flip todos → it as each MV/view/guard lands. The `.from('transactions')` ci-guard case is intentionally RED until Plan 03-05 extends Guard 1 regex.
- [Phase 03-analytics-sql]: 03-02: cohort_mv ships local refresh_cohort_mv() helper as Nyquist stop-gap; Plan 05 supersedes with refresh_analytics_mvs() and drops the helper
- [Phase 03-analytics-sql]: [Phase 03-analytics-sql 03]: kpi_daily_mv body replaced via drop-cascade in 0011; kpi_daily_v wrapper recreated with 5 cols (revenue/tx_count/avg_ticket); refresh_kpi_daily_mv helper from 0006 survived cascade (plpgsql EXECUTE string has no schema dep). DEV needed migration-history repair (0011 was pre-recorded as applied without ever running).
- [Phase 03-analytics-sql]: 03-04: 4 leaf views (retention/ltv/frequency/new_vs_returning) over cohort_mv; 4-bucket NVR with blackout_unknown preserves tie-out; per-cohort horizon NULL-mask via generate_series(0,260); test_* SECURITY DEFINER helpers use set_config(jwt.claims) to verify JWT-filtered leaves from admin client
- [Phase 03-analytics-sql]: 03-04: Rule 1 fixes — plan's retention p1=0.5 and LTV 1450/3150/4200 wrong; B's 08-11 visit is 6d after first_visit → period 0 not 1. Corrected: retention p0=1/p1=0/p2=1, LTV p0=2300/p2=4000/p8=5050
- [Phase 03]: 03-05: refresh_analytics_mvs() SECURITY DEFINER + pg_cron '0 3 * * *' live on DEV; refresh_kpi_daily_mv superseded to keep Phase 1 tests transparent; refresh_cohort_mv dropped (03-02 cleanup)
- [Phase 03]: 03-05: ci-guards Guard 1 regex extended to .from('transactions')/stg_orderbird_order_items/*_mv; tenant-isolation.test.ts extended to 6 wrapper views + 2 raw MVs (26 tests); all ANL-01..09 under automated test; Phase 3 closed
- [Phase 04]: 04-01: shadcn-svelte CLI unreachable (@next registry returns HTML, TTY-interactive); hand-rolled 6 primitives (button/card/input/label/toggle-group/tooltip) with matching components.json for future add extension
- [Phase 04]: 04-01: data_freshness_v uses MAX(created_at) not ingested_at (transactions has no ingested_at); output alias preserved
- [Phase 04]: 04-01: vitest 1->4 + vite 5->8 bump forced by vite-plugin-svelte@7 peer; test:unit scoped to tests/unit/ to isolate from integration lane
- [Phase 04]: 04-02: root +layout.server.ts exempts /login and /not-provisioned to fix redirect loop inherited from 04-01 reference file
- [Phase 04]: 04-02: playwright config swapped iPhone SE (webkit) → chromium mobile emulation at 375×667 so sandbox without webkit can run e2e
- [Phase 04]: 04-02: vitest loads @sveltejs/vite-plugin-svelte + $lib alias + browser condition so component tests compile .svelte files
- [Phase 04-mobile-reader-ui]: 04-03: sumKpi extracted to kpiAgg.ts for pure-unit testing; queryKpi DRY helper wraps kpi_daily_v; 8 parallel queries in Promise.all for today/7d/30d × current+prior + chip × current+prior
- [Phase 04-mobile-reader-ui]: 04-03: KpiTile delta threshold |pct|<1 → flat to avoid ▲ +0% noise; U+2212 real minus for negative deltas; test isolation uses container.querySelector not screen.getByText for multi-render JSDOM
- [Phase 04]: [Phase 04-mobile-reader-ui]: 04-04: retention_curve_v/ltv_v queried without grain filter — views are weekly-only in SQL, no grain column; grain URL param preserved for GrainToggle state
- [Phase 04]: [Phase 04-mobile-reader-ui]: 04-04: pickVisibleCohorts() extracted to sparseFilter.ts for pure-function unit testing without LayerChart rendering
- [Phase 04]: [Phase 04-mobile-reader-ui]: 04-04: @ts-expect-error test enforces absent range prop on CohortRetentionCard; future prop addition caught at type-check
- [Phase 04-mobile-reader-ui]: shapeNvr() absorbs blackout_unknown into cash_anonymous to preserve D-19 tie-out invariant
- [Phase 04-mobile-reader-ui]: FreshnessLabel tested via static top-level import (not dynamic require) in ESM vitest pipeline
- [Phase 04]: 04-07 (Gap B closure): migration 0015 ALTER custom_access_token_hook SECURITY DEFINER lands in repo; DEV verified prosecdef=true. jwt-claim integration test extended with literal 'Gap B regression' failure message pointing at 0015. Manual revert sanity check confirmed test goes red under SECURITY INVOKER.
- [Phase 04-mobile-reader-ui]: 04-06: layerchart pinned 2.0.0-next.54 (Svelte 5 native line); Path B — 2.x removed string-preset xScale, must pass d3 scale fns; E2E fixture bypass via E2E_FIXTURES=1 + ?__e2e=charts server-side (page.route cannot intercept SSR load)
- [Phase 05-insights-forkability]: 05-01: insights_v wrapper omits input_payload (audit-only); pg_cron 'generate-insights' at 15 3 * * * UTC pulls URL+bearer from vault.decrypted_secrets at run time — Vault secrets provisioned in 05-05
- [Phase 05-insights-forkability]: 05-04: InsightCard wired via insights_v fan-out; is_yesterday derived in Berlin tz; ci-guards Guard 1 extended to forbid raw .from('insights') from src/. Plan deviated from session.user.app_metadata.timezone (load uses locals.supabase, no session var) — Berlin hardcoded for v1.
- [Phase 05-insights-forkability]: 05-03: fallback template uses 'prior week' not '7d/7 days' to avoid leaking a literal digit 7 through the digit-guard tautology
- [Phase 05-insights-forkability]: 05-05: Forkability shipped — MIT LICENSE, 5-section .env.example (cf pages / supabase secrets / vault / github actions / local dev), README Phase 2–Ship quickstart, fork-dryrun.sh green (23 checks). INS-05/INS-06 closed.
- [Phase 05-insights-forkability]: 05-06 T1: GitHub repo metadata set via `gh` — 9 topics + description. Repo flipped PUBLIC on 2026-04-15 during interactive execution of 05-06 (user-approved).
- [Phase 06-filter-foundation]: 06-02: Popover portal via physical DOM relocation (bind:this + appendChild to #popover-root) with best-effort restore on cleanup — avoids Svelte mount() recursion. Snippet-accepting primitives tested via tests/unit/fixtures/*Harness.svelte wrappers.
- [Phase 06]: 06-01: zod filter schema + parseFilters + customToRange + Guard 6 shipped; tests live in tests/unit/ (not src/lib/) to match project runner scope; Guard 6 wired into existing single-file scripts/ci-guards.sh runner
- [Phase 06-filter-foundation]: 06-03: transactions_filterable_v wrapper view (JWT-scoped); loader refactored to parseFilters(url) as sole URL->state converter; chip-scoped tiles honor sales_type+payment_method via .in(); distinct option arrays loaded unfiltered (D-14); fixed reference tiles stay unscoped per UI-SPEC; 6 integration tests via hand-rolled chainable supabase mock
- [Phase 06-filter-foundation]: 06-05: Task 2 (375px human UAT) deferred — CF Pages deploy pipeline broken (~27 commits stale behind a3623b9); UAT script persisted in 06-HUMAN-UAT.md status=blocked; Phase 6 code green locally but not yet live on DEV
- [Phase 09]: Svelte 5 forbids exporting $derived from .svelte.ts modules; dashboardStore uses getter functions as public API
- [Phase 09]: COALESCE(va.is_cash, true) treats unattributed rows as cash; payment_method kept in SQL view for backward compat
- [Phase 09]: SSR returns raw dailyRows instead of pre-aggregated kpi object — 12+ queries reduced to 4
- [Phase 09]: All filter controls use replaceState (no SSR round-trip) for <200ms client response
- [Phase 09]: FilterSheet + MultiSelectDropdown deleted, replaced by inline SegmentedToggles in FilterBar
- [Phase 09]: 09-03 gap-closure: 0020/0022 t.id -> source_tx_id, tx_id text — Migration 0003 established (restaurant_id, source_tx_id text) as the composite PK; Phase 8 D-04 incorrectly specified tx_id uuid. Fixed in place.
- [Phase 09]: 09-03: 0021 rewritten as DROP VIEW IF EXISTS + CREATE VIEW — Postgres forbids column removal via CREATE OR REPLACE VIEW (SQLSTATE 42P16). Pattern: view column-shape changes require DROP + CREATE.
- [Phase 09]: 09-04: Reactive filters state pattern — module-private $state + public getFilters() getter + object-spread in setters so downstream $derived re-runs.
- [Phase 09-filter-simplification-performance]: 09-05: page.url from $app/state is stale after replaceState — window.location.href is the live source. mergeSearchParams(updates): URL helper centralizes URL composition.
- [Phase 09-filter-simplification-performance]: 09-05: getWindow(): RangeWindow getter returns a fresh object every call — identity-change invariant that $derived(getWindow()) in +page.svelte depends on.
- [Phase 10-charts]: 10-01: Nyquist RED wave authored — 8 test files (505 lines) covering all Phase 10 requirements VA-04..VA-10
- [Phase 10-charts]: 10-01: CF Pages deploy unblocked (Path A) — workflow 24481554088 added deploy.yml on 2026-04-15
- [Phase 10-charts]: 10-01: Seed-demo-data.sql extended idempotently — 76 tx + 15 cash + 76 order-items under demo-phase10- prefix
- [Phase 10-charts]: 10-02: transactions_filterable_v extended to 8 cols (+visit_seq +card_hash) via DROP+CREATE; LEFT JOIN on visit_attribution_mv reused from 0022.
- [Phase 10-charts]: 10-03: customer_ltv_mv (4462 rows) + item_counts_daily_mv (4432 rows) shipped with wrapper views, test helpers, full 5-step D-04 refresh DAG.
- [Phase 10-charts]: 10-03: item_counts_daily_mv join key verified: transactions.source_tx_id = stg_orderbird_order_items.invoice_number.
- [Phase 10-charts]: 10-04: d3-scale-chromatic promoted from transitive (layerchart) to direct dep
- [Phase 10-charts]: 10-04: cohortAgg duplicates `>= SPARSE_MIN_COHORT_SIZE` check instead of reusing pickVisibleCohorts() — that helper is typed for RetentionRow only.
- [Phase 10-charts]: 10-06: LtvHistogramCard is filter-independent (no range prop) — LTV is lifetime; filter-scoping would be semantically wrong.
- [Phase 10-charts]: 10-07: D-17 hint contract unified across VA-06/09/10 — byte-identical cohort-clamp-hint testid + copy + amber-600 styling
- [Phase 10-charts]: 10-07: Cohort Revenue/AvgLtv cards use plain <BarChart> composition — LayerChart handles scales/axes/tooltips internally.
- [Phase 10-charts]: 10-05: cards self-subscribe to dashboardStore via getter calls in $derived.by() — no prop-drilling.
- [Phase 10-charts]: 10-05: LayerChart high-level <BarChart seriesLayout='stack'> handles stack math/scales/tooltip internally.
- [Phase 10-charts]: 10-08: Path C eager-mount — Lighthouse crashed; fell through to eager-mount per plan's hard-stop clause. No LazyMount.svelte shipped (later landed in Phase 11).
- [Phase 10-charts]: 10-08: customer_ltv_v NOT range-filtered at SSR — LTV is lifetime; filter-scoping would hide customers outside chip window.
- [Phase 10-charts]: 10-08: SSR fan-out grows 4→6 queries with per-card try/catch + empty fallback.

### Open Todos

- (v1.3) Confirm with friend in office hours: did she tell regulars about the 2026-04-14 campaign before launch? If yes, when? — drives Track-B `TRAIN_END` cutoff (default `−7d` per research synthesis)
- (v1.3) Phase 14 — `yhat_samples` jsonb storage trajectory: TTL/janitor decision (~125 MB/year/tenant on 500 MB Supabase free tier) — defer to plan-phase
- (v1.3) Phase 13 — BVG RSS URL not yet end-to-end verified; CI step in 13's acceptance test
- (v1.3) Phase 17 — Chronos GHA wall-time + HF cache hit rate not measured; watch-item for alerting
- (v1.3) Phase 17 — NeuralProphet ≥5% RMSE-win promotion criterion; drop dep entirely after 4 weeks if no win
- (deferred, out of v1 scope) v1.0 Plan 05-06 Task 2 fork walkthrough — forkability is not a v1 concern per user direction

### Blockers

- (none)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260417-29v | Apply security headers to SSR responses in hooks.server.ts | 2026-04-16 | 11e85b9 | [260417-29v-apply-security-headers-to-ssr-responses-](./quick/260417-29v-apply-security-headers-to-ssr-responses-/) |
| 260417-mfo | 3 mobile UI fixes: FilterBar spinner, Takeaway label nowrap, CohortRetentionCard grain-aware | 2026-04-17 | 28ba150, e02b272, c0f0a2b | [260417-mfo-3-ui-fixes-loading-spinner-takeaway-over](./quick/260417-mfo-3-ui-fixes-loading-spinner-takeaway-over/) |
| 260417-mp2 | Fix silent dashboard crash (RangeError in formatBucketLabel on month grain) | 2026-04-17 | 62fab3e, c389bd4 | [260417-mp2-fix-silent-dashboard-bug-formatbucketlab](./quick/260417-mp2-fix-silent-dashboard-bug-formatbucketlab/) |
| 260418-0td | Clean up unstaged MCP config | 2026-04-17 | f8970f2, b20cad6 | [260418-0td-clean-up-unstaged-mcp-config-changes-res](./quick/260418-0td-clean-up-unstaged-mcp-config-changes-res/) |
| 260418-1ja | Pass 1 dashboard feedback: swap Counts/Revenue order, rename 7 chart titles, add compact €/int Y-axis formatters, fix revenue-chart cents→EUR bug | 2026-04-17 | f569933, af8f546, 00a0325 | [260418-1ja-pass-1-card-titles-order-swap-y-axis-rea](./quick/260418-1ja-pass-1-card-titles-order-swap-y-axis-rea/) |
| 260418-28j | Pass 2 dashboard feedback: retention card overhaul | 2026-04-17 | f5825ca, 6333e56, 19219c6, 073b963, d834314 | [260418-28j-pass-2-retention-card-overhaul-monthly-s](./quick/260418-28j-pass-2-retention-card-overhaul-monthly-s/) |
| 260418-3ec | Pass 3 dashboard feedback: repeater breakdown on VA-07/09/10 | 2026-04-18 | 40ca05b, 831bb5e, 481aace | [260418-3ec-pass-3-repeater-breakdown-on-va-07-09-10](./quick/260418-3ec-pass-3-repeater-breakdown-on-va-07-09-10/) |
| 260418-4oh | Pass 4 dashboard feedback (6 items) | 2026-04-18 | aa86219, 1598bf4, 6432bd2, 531a72f, ab771c2 | [260418-4oh-pass-4-6-items-top20-items-long-press-fi](./quick/260418-4oh-pass-4-6-items-top20-items-long-press-fi/) |
| 260418-f99 | Plan A — 5 UI fixes pass | 2026-04-18 | bec629c, 73d96b7, ec905d4, 02f39f3, 60ef822, e45fc20 | [260418-f99-plan-a-5-ui-fixes-pass](./quick/260418-f99-plan-a-5-ui-fixes-pass/) |
| 260418-g6s | Range-chip cache-miss triggers SSR refetch via goto({invalidateAll:true}) | 2026-04-18 | 982b010, 92c585a | [260418-g6s-range-chip-ssr-refetch-fix-depends-inval](./quick/260418-g6s-range-chip-ssr-refetch-fix-depends-inval/) |
| 260419-dhm | DailyHeatmapCard — Mon-Sun row labels fixed left of scroll, blue-scale colorbar | 2026-04-19 | e98f074, 4345700 | [260419-dhm-labels-colorbar](./quick/260419-dhm-labels-colorbar/) |
| 260420-wdf | Day-of-week filter + repeater Option-A scope expansion + sticky filter header fix | 2026-04-20 | 03db100, 1c9cf3a, 7027b4b, 545273c, d2f536d | [260420-wdf-dow-filter-retire-lin-log](./quick/260420-wdf-dow-filter-retire-lin-log/) |
| 260422-fz1 | AI TL;DR action-point bullets on dashboard insight card | 2026-04-22 | a496164 | [260422-fz1-add-ai-tl-dr-action-point-bullets-to-das](./quick/260422-fz1-add-ai-tl-dr-action-point-bullets-to-das/) |
| 260424-mdc | MDE (Minimum Detectable Effect) line chart card on dashboard | 2026-04-24 | 66926c2, e612519 | [260424-mdc-add-mde-curve-card](./quick/260424-mdc-add-mde-curve-card/) |
| 260428-62e | Align ORDERBIRD_COLUMNS with new joined-CSV order_id-last format (parser + fixture) | 2026-04-28 | bc67dc6 | [260428-62e-parse-order-id-last](./quick/260428-62e-parse-order-id-last/) |
| 260428-wmd | Drop daily MV-refresh + insight pg_cron jobs; trigger both on-demand from ingest when a new complete Mon-Sun week is available | 2026-04-28 | d3d0f9d, af3f051 | [260428-wmd-ingest-trigger-insight](./quick/260428-wmd-ingest-trigger-insight/) |
| 260428-5yr | Exclude supabase/** from vitest discovery so Deno Edge Function tests don't break CI | 2026-04-28 | a388d43 | [260428-5yr-vitest-exclude-deno](./quick/260428-5yr-vitest-exclude-deno/) |
| 260428-c87 | Skip post-ingest insight hook under vitest (avoid RPC + 404 stderr in integration tests) | 2026-04-28 | cc3f862 | [260428-c87-skip-insight-hook-vitest](./quick/260428-c87-skip-insight-hook-vitest/) |
| 260428-b21 | Show recent maturing cohorts on the repeater chart (lower threshold 5 → 1) | 2026-04-28 | 02c4266 | [260428-b21-repeater-cohort-recent](./quick/260428-b21-repeater-cohort-recent/) |
| 260428-nmq | Render newlines in InsightCard body (whitespace-pre-line) so admin-typed 改行 are visible | 2026-04-28 | 3a2d2e1 | [260428-nmq-insight-body-newline](./quick/260428-nmq-insight-body-newline/) |

## Session Continuity

**Next command:** `/gstack-review` against `main` from the phase branch (`feature/phase-13-external-data-ingestion`) — pre-landing diff review for SQL safety, RLS holes, trust boundaries. Then `/gstack-cso` (Tier 3 mandatory — 7 migrations + new RLS), then `/gsd-verify-work 13` (UAT on DEV), then `/gsd-ship`, then `/gstack-retro`. The 19-row workflow rows already executed are 1-3, 4, 8, 9, 10. Row 5 (`/gstack-autoplan`) was skipped. Row 12 (`/qa-gate`) believed run but no artifact in `~/.gstack/projects/...` — re-run if needed.

**Authoritative spec for v1.3:** `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` (1484-line driving artifact — verified data sources, schema sketches, GHA cron pattern, failure modes, backtest fairness rules, ITS validity audit). Note: §7 SQL sketches use `tenant_id`; codebase claim is `restaurant_id` — Phase 12 CI Guard 7 catches the rename.

**Phase 12 context (committed fded786):** `.planning/phases/12-forecasting-foundation/12-CONTEXT.md` — ratifies the three ROADMAP §SC4 mandates (D-01 anticipation cutoff −7d, D-02 brightsky production default, D-03 §7 rename rule) and locks 14 implementation decisions (D-04 audit script written fresh; D-05/D-06 audit scope + weekly cadence; D-07/D-08 `pipeline_runs` skeleton pulled forward from Phase 13 with non-tenant-scoped initial RLS; D-09/D-10/D-11 Guard 7 placement, scan paths, regex variants; D-12/D-13/D-14 final UTC schedule contract + ≥60-min cascade gap rule + Guard 8 enforcement). Discussion log at `12-DISCUSSION-LOG.md`.

**Resume hint:** v1.3 roadmap complete. 6 phases (12-17) map all 47 v1.3 requirements. Phase 12 (Foundation — Decisions & Guards) context locked 2026-04-28; planning + execution is a lightweight scripting effort (~1-2 days). Phase 13 (External Data Ingestion) is the first heavy migration phase (~2 weeks). Phase 14 ↔ 15 parallel-eligible after 14's schema lands (estimated 30-40% schedule compression). Phase 17 has a hard dependency on ≥4 weeks of forecast-vs-actual history; cold-start UI badge "BACKTEST PENDING" handles days 1-7.

**Last session:** 2026-04-29 — STATE.md realignment after discovering Phase 13 implementation already done on phase branch
**Stopped At:** Phase 13 implementation discovered complete on `feature/phase-13-external-data-ingestion` (24 commits ahead of main, head `c5be916`). Workflow rows 1-3, 4, 8, 9, 10 done; row 5 (`/gstack-autoplan`) skipped; rows 12, 15, 16, 17, 18, 19 outstanding. STATE.md previously claimed "context gathered, ready for /gsd-plan-phase 13" — that was a stale artifact from the discuss-phase session. Now realigned. Branch unmerged. Next: `/gstack-review` (row 15) → `/gstack-cso` (row 16, Tier 3 mandatory) → `/gsd-verify-work 13` (row 17) → `/gsd-ship` (row 18) → `/gstack-retro` (row 19).

---
*State initialized: 2026-04-13; v1.3 roadmap recorded: 2026-04-27; Phase 12 context: 2026-04-28; Phase 13 context: 2026-04-28; Phase 13 implementation complete: ≤2026-04-29; STATE.md realigned: 2026-04-29*
