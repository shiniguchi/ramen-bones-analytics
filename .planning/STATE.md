---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Dashboard Simplification & Visit Attribution
status: completed
stopped_at: Phase 9 context gathered
last_updated: "2026-04-16T14:51:12.267Z"
progress:
  total_phases: 7
  completed_phases: 7
  total_plans: 42
  completed_plans: 42
  percent: 0
---

# STATE: Ramen Bones Analytics

**Last updated:** 2026-04-16

## Project Reference

- **Core Value:** A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see.
- **Current Focus:** Phase 08 — visit-attribution-data-model
- **Timeline:** Slow and deliberate — understand data first, ship one layer at a time
- **Granularity:** standard
- **Tenants in v1:** 1 (architecture multi-tenant-ready)

## Current Position

Milestone: v1.2 (Dashboard Simplification & Visit Attribution) — ROADMAP CREATED
Phase: 08
Plan: Not started

- **Status:** Milestone complete
- **Progress:** [░░░░░░░░░░] 0%

## Performance Metrics

| Metric | Value |
|--------|-------|
| v1.2 Phases planned | 3 (Phase 8, 9, 10) |
| v1.2 Phases complete | 0 |
| v1.2 Requirements mapped | 13/13 |
| Plans executed | 0 |

## Accumulated Context

### Key Decisions (from PROJECT.md)

- Single-tenant v1, multi-tenant architecture from day 1
- SvelteKit 2 + Svelte 5 + `adapter-cloudflare` on Cloudflare Pages
- Supabase Postgres + pg_cron + materialized views (not dbt)
- v1.2 supersedes v1.1 Phases 8-11 (star schema, chart rollups, chart components, bug fixes)
- Visit-count attribution (visit_seq per transaction) is the core new metric
- Filters simplify to inhouse/takeaway + cash/card (drop country, payment_method granularity)
- Client-side granularity toggle replaces SSR round-trip for performance

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

**Next command:** `/gsd:plan-phase 08`

**Resume hint:** v1.2 roadmap created with 3 phases (8-10). Phase 8 = visit_seq MV + is_cash flag + drop dead views. Phase 9 = filter simplification + client-side granularity. Phase 10 = 7 charts with visit-count attribution. All 13 VA-* requirements mapped.

**Last session:** 2026-04-16T14:51:12.249Z
**Stopped At:** Phase 9 context gathered

---
*State initialized: 2026-04-13*
