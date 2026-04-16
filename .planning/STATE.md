---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: — Dashboard Simplification & Visit Attribution
status: "Roadmap created"
stopped_at: ""
last_updated: "2026-04-16T03:00:00.000Z"
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# STATE: Ramen Bones Analytics

**Last updated:** 2026-04-16

## Project Reference

- **Core Value:** A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see.
- **Current Focus:** Milestone v1.2 — Phase 8 (Visit Attribution Data Model)
- **Timeline:** Slow and deliberate — understand data first, ship one layer at a time
- **Granularity:** standard
- **Tenants in v1:** 1 (architecture multi-tenant-ready)

## Current Position

Milestone: v1.2 (Dashboard Simplification & Visit Attribution) — IN PROGRESS
Phase: 8 (Visit Attribution Data Model) — executing
Plan: 1 of 2 complete

- **Status:** Executing Phase 8
- **Progress:** [█████░░░░░] 50%

## Performance Metrics

| Metric | Value |
|--------|-------|
| v1.2 Phases planned | 3 (Phase 8, 9, 10) |
| v1.2 Phases complete | 0 |
| v1.2 Requirements mapped | 13/13 |
| Plans executed | 1 |
| Phase 08 P01 | 5min | 1 task | 2 files |

## Accumulated Context

### Key Decisions (from PROJECT.md)

- Single-tenant v1, multi-tenant architecture from day 1
- SvelteKit 2 + Svelte 5 + `adapter-cloudflare` on Cloudflare Pages
- Supabase Postgres + pg_cron + materialized views (not dbt)
- v1.2 supersedes v1.1 Phases 8-11 (star schema, chart rollups, chart components, bug fixes)
- Visit-count attribution (visit_seq per transaction) is the core new metric
- Filters simplify to inhouse/takeaway + cash/card (drop country, payment_method granularity)
- Client-side granularity toggle replaces SSR round-trip for performance

### Decisions

- [Phase 08-01]: visit_attribution_mv placed last in refresh_analytics_mvs() DAG (no cross-MV dependency)
- [Phase 08-01]: is_cash derived from card_hash IS NULL (not payment_method) per D-06
- [Phase 08-01]: ROW_NUMBER wrapped in CASE to prevent NULL card_hash partition producing meaningless sequence

### Load-Bearing Architectural Rules

1. RLS + security-definer wrapper views on every MV
2. Raw ingest idempotent via natural-key upsert `(restaurant_id, source_tx_id)`
3. Every read path goes through `*_v` wrappers; `REVOKE ALL` on MVs
4. Visit_seq computed via `ROW_NUMBER() OVER (PARTITION BY card_hash ORDER BY occurred_at)`

### Open Todos

- (v1.2) Confirm final visit_seq bucket boundaries once we see distribution on real data
- (deferred) v1.0 Plan 05-06 Task 2 fork walkthrough — out of v1 scope

### Blockers

- CF Pages deploy pipeline broken since a3623b9 — blocks visual UAT at 375px on DEV

## Session Continuity

**Next command:** `/gsd:execute-phase 08` (continue with plan 08-02)

**Resume hint:** Plan 08-01 complete — visit_attribution_mv exists with visit_seq, is_cash, wrapper view, test helper, and refresh function update. Plan 08-02 does dead code cleanup (drop frequency_v, new_vs_returning_v, ltv_v, CountryMultiSelect, country filter).

**Last session:** 2026-04-16T11:05:00Z
**Stopped At:** Completed 08-01-PLAN.md

---
*State initialized: 2026-04-13*
