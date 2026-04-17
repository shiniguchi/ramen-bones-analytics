---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Dashboard Simplification & Visit Attribution
status: executing
stopped_at: Completed 10-03-PLAN.md — customer_ltv_mv + item_counts_daily_mv shipped, refresh DAG 5-step, 8 integration tests green
last_updated: "2026-04-17T09:32:58.901Z"
progress:
  total_phases: 10
  completed_phases: 9
  total_plans: 57
  completed_plans: 52
  percent: 91
---

# STATE: Ramen Bones Analytics

**Last updated:** 2026-04-15

## Project Reference

- **Core Value:** A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see.
- **Current Focus:** Phase 10 — charts
- **Timeline:** Slow and deliberate — understand data first, ship one layer at a time
- **Granularity:** standard
- **Tenants in v1:** 1 (architecture multi-tenant-ready)

## Current Position

Milestone: v1.2 (Dashboard Simplification & Visit Attribution) — Phase 09 complete (5/5 plans including gap closures), Phase 10 Charts next
Phase: 10 (charts) — EXECUTING
Plan: 4 of 8

- **Status:** Ready to execute
- **Progress:** [█████████░] 91%
- **v1.0 status:** Shipping to friend (97% plans complete; repo flipped PUBLIC 2026-04-15 with topics + description set; Plan 05-06 Task 2 fork walkthrough deferred out of v1 scope — forkability is explicitly not a v1 concern per user direction)

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases planned | 5 |
| Phases complete | 0 |
| Requirements mapped | 41/41 |
| Plans executed | 0 |
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

## Accumulated Context

### Key Decisions (from PROJECT.md)

- Single-tenant v1, multi-tenant architecture from day 1
- SvelteKit 2 + Svelte 5 + `adapter-cloudflare` on Cloudflare Pages
- Supabase Postgres + pg_cron + materialized views (not dbt)
- Playwright CSV scraper on GitHub Actions cron (ISV API pending)
- Daily refresh cadence; no realtime
- Card hash as customer ID; never store PAN/PII
- Free + forkable business model

### Load-Bearing Architectural Rules

1. RLS + security-definer wrapper views must exist BEFORE the first MV is built
2. Raw ingest idempotent via natural-key upsert `(restaurant_id, source_tx_id)` + 2-day overlap window
3. Every read path goes through `*_v` wrappers; `REVOKE ALL` on MVs; tenant id only from signed JWT claim

### Top Risks (from PITFALLS.md)

1. RLS silently bypassed via materialized views — solved structurally in Phase 1
2. Cohort survivorship / short-history LTV shown without caveat — solved in Phase 3 SQL, surfaced in Phase 4 UI
3. Timezone off-by-one day boundary — solved in Phase 1 via `business_date` column
4. Claude hallucinates a number — solved in Phase 5 via digit-guard + deterministic fallback
5. Founder scope creep — enforced by FEATURES.md P1 contract across every phase

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
- [Phase 05-insights-forkability]: 05-06 T1: GitHub repo metadata set via `gh` — 9 topics (analytics, restaurant-analytics, sveltekit, svelte, supabase, cloudflare-pages, forkable, pos-integration, cohort-analysis) + description. Repo flipped PUBLIC on 2026-04-15 during interactive execution of 05-06 (user-approved). Plan's `visibility:PUBLIC` acceptance criterion now satisfied. Flip does NOT re-open T2 fork walkthrough — forkability is explicitly out of v1 scope per user direction, not gated on visibility.
- [Phase 06-filter-foundation]: 06-02: Popover portal via physical DOM relocation (bind:this + appendChild to #popover-root) with best-effort restore on cleanup — avoids Svelte mount() recursion. Snippet-accepting primitives tested via tests/unit/fixtures/*Harness.svelte wrappers.
- [Phase 06]: 06-01: zod filter schema + parseFilters + customToRange + Guard 6 shipped; tests live in tests/unit/ (not src/lib/) to match project runner scope; Guard 6 wired into existing single-file scripts/ci-guards.sh runner
- [Phase 06-filter-foundation]: 06-03: transactions_filterable_v wrapper view (JWT-scoped); loader refactored to parseFilters(url) as sole URL->state converter; chip-scoped tiles honor sales_type+payment_method via .in(); distinct option arrays loaded unfiltered (D-14); fixed reference tiles stay unscoped per UI-SPEC; 6 integration tests via hand-rolled chainable supabase mock
- [Phase 06-filter-foundation]: 06-05: Task 2 (375px human UAT) deferred — CF Pages deploy pipeline broken (~27 commits stale behind a3623b9); UAT script persisted in 06-HUMAN-UAT.md status=blocked; Phase 6 code green locally but not yet live on DEV
- [Phase 09]: Svelte 5 forbids exporting $derived from .svelte.ts modules; dashboardStore uses getter functions as public API
- [Phase 09]: COALESCE(va.is_cash, true) treats unattributed rows as cash; payment_method kept in SQL view for backward compat
- [Phase 09]: SSR returns raw dailyRows instead of pre-aggregated kpi object — 12+ queries reduced to 4
- [Phase 09]: All filter controls use replaceState (no SSR round-trip) for <200ms client response
- [Phase 09]: FilterSheet + MultiSelectDropdown deleted, replaced by inline SegmentedToggles in FilterBar
- [Phase 09]: 09-03 gap-closure: 0020/0022 t.id -> source_tx_id, tx_id text (transactions PK is composite, no surrogate id) — Migration 0003 established (restaurant_id, source_tx_id text) as the composite PK; Phase 8 D-04 incorrectly specified tx_id uuid. Fixed in place (migrations unpushed, history stays clean).
- [Phase 09]: 09-03: 0021 rewritten as DROP VIEW IF EXISTS + CREATE VIEW — Postgres forbids column removal via CREATE OR REPLACE VIEW (SQLSTATE 42P16) — Surfaced during TEST verification. Rule 3 deviation. Pattern: view column-shape changes require DROP + CREATE, not CREATE OR REPLACE.
- [Phase 09]: 09-04: Reactive filters state pattern — module-private $state + public getFilters() getter + object-spread in setters so downstream $derived re-runs. Collapses the dual-source drift between SSR data.filters (used for labels) and store private state (used for KPI math). Zero child-component changes needed.
- [Phase 09-filter-simplification-performance]: 09-05: page.url from $app/state is stale after replaceState — window.location.href is the live source. mergeSearchParams(updates): URL helper centralizes URL composition so filter write-paths can't silently drop params.
- [Phase 09-filter-simplification-performance]: 09-05: getWindow(): RangeWindow getter returns a fresh object every call — identity-change invariant that $derived(getWindow()) in +page.svelte depends on; memoizing would silently break DatePickerPopover subtitle reactivity (locked by test W3).
- [Phase 10-charts]: 10-01: Nyquist RED wave authored — 8 test files (505 lines) covering all Phase 10 requirements VA-04..VA-10; every downstream task (10-02..10-08) has a pre-existing failing test to flip GREEN
- [Phase 10-charts]: 10-01: CF Pages deploy unblocked (Path A) — workflow 24481554088 added deploy.yml on 2026-04-15; 5 most-recent main-branch deploys all succeeded. Phase branches trigger off main-merge or 'gh workflow run --ref'. No local-preview fallback needed.
- [Phase 10-charts]: 10-01: Seed-demo-data.sql extended idempotently — 76 tx + 15 cash + 76 order-items under demo-phase10- prefix (guarded-delete compatible); stg_orderbird_order_items uses hashtext(source_tx_id) mod 11 for deterministic item selection; do-block asserts ≥75/15/75/8 thresholds
- [Phase 10-charts]: 10-02: transactions_filterable_v extended to 8 cols (+visit_seq +card_hash) via DROP+CREATE; LEFT JOIN on visit_attribution_mv reused from 0022. Dual-push to DEV (paafpikebsudoqxwumgm) and TEST (akyugfvsdfrwuzirmylo) projects required — no TEST_DB_URL in .env so used supabase link re-ref.
- [Phase 10-charts]: 10-03: customer_ltv_mv (4462 rows) + item_counts_daily_mv (4432 rows) shipped with wrapper views, test helpers, full 5-step D-04 refresh DAG. Integration tests 8/10 green (2 it.todo remain). All CI guards pass.
- [Phase 10-charts]: 10-03: item_counts_daily_mv join key verified: transactions.source_tx_id = stg_orderbird_order_items.invoice_number (normalize.ts:185). is_cash derived from visit_attribution_mv via LEFT JOIN + COALESCE(..., true) matching 0022 pattern.

### Open Todos

- (v1.1) Confirm with founder whether monthly retention needs its own card in UI or can share the weekly Card with a toggle
- (v1.1) Decide final bucket boundaries once we eyeball visit_seq distribution on real data (Phase 08 can print a histogram)
- (deferred, out of v1 scope) v1.0 Plan 05-06 Task 2 fork walkthrough — forkability is not a v1 concern per user direction; revisit only when onboarding other restaurants becomes an explicit goal

### Blockers

- (none — CF Pages unblocked 2026-04-15 by `ci: add CF Pages deploy workflow`; all deploys to `main` since have succeeded. See .planning/phases/10-charts/10-01-SUMMARY-cf-pages-decision.md for evidence.)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260417-29v | Apply security headers to SSR responses in hooks.server.ts | 2026-04-16 | 11e85b9 | [260417-29v-apply-security-headers-to-ssr-responses-](./quick/260417-29v-apply-security-headers-to-ssr-responses-/) |

## Session Continuity

**Next command:** `/gsd:discuss-phase 06` to gather context for the Filter Foundation phase (custom date range + granularity toggle + 4 dropdown filters wired to existing views)

**Authoritative spec for v1.1:** `.planning/v1.1-DATA-MODEL.md` — read first. Has every column, SQL body, index, CASE ladder, and filter contract.

**Resume hint:** Milestone v1.1 Dashboard Redesign was scoped in this session. Architecture is a pragmatic star schema: `dim_customer` (lifetime attrs) + `fct_transactions` (atomic fact MV with visit_seq / days_since_prev_visit window fns + denormalized filter dims) + 4 thin day-grain rollup MVs (`mv_new_customers_daily`, `mv_repeater_daily`, `mv_retention_monthly`, `mv_inter_visit_histogram`). Two bucket columns materialized: `lifetime_bucket` (how customer ended up) and `visit_seq_bucket` (point-in-time). Six filters: date range, granularity, sales_type, payment_method, wl_issuing_country, repeater bucket — dropdowns auto-populated from DISTINCT values. All refresh stays inside existing `refresh_analytics_mvs()` cron. Start with Phase 06 (Filter Foundation) for a quick UX win before any schema change.

**Last session:** 2026-04-17T09:32:58.890Z
**Stopped At:** Completed 10-03-PLAN.md — customer_ltv_mv + item_counts_daily_mv shipped, refresh DAG 5-step, 8 integration tests green

---
*State initialized: 2026-04-13*
