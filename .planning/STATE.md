---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: 03-01 complete — Wave 0 RED test scaffold landed; next 03-02 cohort_mv
last_updated: "2026-04-14T11:15:00.000Z"
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 15
  completed_plans: 11
  percent: 73
---

# STATE: Ramen Bones Analytics

**Last updated:** 2026-04-14

## Project Reference

- **Core Value:** A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see.
- **Current Focus:** Phase 03 — analytics-sql
- **Timeline:** 2 weeks to MVP in friend's hands
- **Granularity:** standard
- **Tenants in v1:** 1 (architecture multi-tenant-ready)

## Current Position

Phase: 03 (analytics-sql) — EXECUTING
Plan: 2 of 5 (03-01 complete)

- **Phase:** 3
- **Plan:** 03-01 complete; next 03-02 cohort_mv
- **Status:** Executing Phase 03
- **Progress:** [███████▍░░] 73%

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

### Open Todos

- Sit with the friend in week 1 and read ≥20 real Orderbird CSV rows before writing Phase 3 MV SQL (EXT-07)
- Confirm Orderbird captcha/bot-detection posture when scraper first runs
- Validate retention-curve-vs-triangle choice with the friend in Phase 4 week 1

### Blockers

None.

## Session Continuity

**Next command:** `/gsd:execute-phase 03` to continue Phase 3 with Plan 03-02 (0010_cohort_mv.sql)

**Resume hint:** Phase 3 Wave 0 RED test scaffold in place (03-01 complete). 15 it.todo stubs + fixture + ci-guards contract test committed as 8d8d302 and bdf5332. Plan 03-02 should author 0010_cohort_mv.sql and flip the ANL-01 + ANL-08 todo blocks to green. Open Phase 3 caveats: April 2026 Worldline blackout, 772 missing_worldline_rows cohort linkage loss.

**Last session:** 2026-04-14T11:15:00Z
**Stopped At:** 03-01 complete — Wave 0 RED test scaffold landed; next 03-02 cohort_mv

---
*State initialized: 2026-04-13*
