---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: "PAUSED at 04-05 Task 3 checkpoint:human-verify (iPhone sign-off)"
last_updated: "2026-04-14T21:46:33.302Z"
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 24
  completed_plans: 21
  percent: 88
---

# STATE: Ramen Bones Analytics

**Last updated:** 2026-04-14

## Project Reference

- **Core Value:** A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see.
- **Current Focus:** Phase 04 — mobile-reader-ui
- **Timeline:** 2 weeks to MVP in friend's hands
- **Granularity:** standard
- **Tenants in v1:** 1 (architecture multi-tenant-ready)

## Current Position

Phase: 04 (mobile-reader-ui) — EXECUTING
Plan: 1 of 9

- **Phase:** 4
- **Plan:** 5 of 5
- **Status:** Executing Phase 04
- **Progress:** [█████████░] 88%

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

### Open Todos

- Sit with the friend in week 1 and read ≥20 real Orderbird CSV rows before writing Phase 3 MV SQL (EXT-07)
- Confirm Orderbird captcha/bot-detection posture when scraper first runs
- Validate retention-curve-vs-triangle choice with the friend in Phase 4 week 1

### Blockers

None.

## Session Continuity

**Next command:** `/gsd:execute-phase 03` to continue Phase 3 with Plan 03-02 (0010_cohort_mv.sql)

**Resume hint:** Phase 3 Wave 0 RED test scaffold in place (03-01 complete). 15 it.todo stubs + fixture + ci-guards contract test committed as 8d8d302 and bdf5332. Plan 03-02 should author 0010_cohort_mv.sql and flip the ANL-01 + ANL-08 todo blocks to green. Open Phase 3 caveats: April 2026 Worldline blackout, 772 missing_worldline_rows cohort linkage loss.

**Last session:** 2026-04-14T19:53:04.408Z
**Stopped At:** PAUSED at 04-05 Task 3 checkpoint:human-verify (iPhone sign-off)

---
*State initialized: 2026-04-13*
