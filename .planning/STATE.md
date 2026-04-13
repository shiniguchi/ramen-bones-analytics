---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-04-13T22:43:13.844Z"
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 10
  completed_plans: 9
  percent: 90
---

# STATE: Ramen Bones Analytics

**Last updated:** 2026-04-14

## Project Reference

- **Core Value:** A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see.
- **Current Focus:** Phase 02 — ingestion
- **Timeline:** 2 weeks to MVP in friend's hands
- **Granularity:** standard
- **Tenants in v1:** 1 (architecture multi-tenant-ready)

## Current Position

Phase: 02 (ingestion) — EXECUTING
Plan: 4 of 4 (Plans 01, 02, 03 complete)

- **Phase:** 2 — Ingestion
- **Plan:** 02-03 complete (loader-core GREEN); next 02-04 (integration tests)
- **Status:** Executing Phase 02
- **Progress:** [█████████░] 90%

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

### Open Todos

- Sit with the friend in week 1 and read ≥20 real Orderbird CSV rows before writing Phase 3 MV SQL (EXT-07)
- Confirm Orderbird captcha/bot-detection posture when scraper first runs
- Validate retention-curve-vs-triangle choice with the friend in Phase 4 week 1

### Blockers

None.

## Session Continuity

**Next command:** `/gsd:execute-phase 02` (continue with plan 02-03)

**Resume hint:** 02-02 wave-0 complete: fixture CSV + 4 RED test stubs in `tests/ingest/`. Plan 02-03 builds `scripts/ingest/{hash,parse,normalize,index}.ts` to turn the RED tests GREEN.

**Last session:** 2026-04-13T22:43:13.831Z

---
*State initialized: 2026-04-13*
