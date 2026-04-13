# STATE: Ramen Bones Analytics

**Last updated:** 2026-04-13

## Project Reference

- **Core Value:** A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see.
- **Current Focus:** Phase 1 — Foundation (tenancy, auth, RLS, wrapper-view template, CI guards)
- **Timeline:** 2 weeks to MVP in friend's hands
- **Granularity:** standard
- **Tenants in v1:** 1 (architecture multi-tenant-ready)

## Current Position

- **Phase:** 1 — Foundation
- **Plan:** none (awaiting `/gsd:plan-phase 1`)
- **Status:** Roadmap complete, ready for planning
- **Progress:** `[░░░░░░░░░░]` 0/5 phases complete

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases planned | 5 |
| Phases complete | 0 |
| Requirements mapped | 41/41 |
| Plans executed | 0 |

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

### Open Todos

- Sit with the friend in week 1 and read ≥20 real Orderbird CSV rows before writing Phase 3 MV SQL (EXT-07)
- Confirm Orderbird captcha/bot-detection posture when scraper first runs
- Validate retention-curve-vs-triangle choice with the friend in Phase 4 week 1

### Blockers

None.

## Session Continuity

**Next command:** `/gsd:plan-phase 1`

**Resume hint:** Roadmap created 2026-04-13. 5 phases derived from 41 v1 requirements with 100% coverage. Phase 1 (Foundation) is next and must complete steps 1–5 of ARCHITECTURE.md build order before any analytical SQL is written.

---
*State initialized: 2026-04-13*
