---
phase: 03-analytics-sql
plan: 03
subsystem: analytics-sql
tags: [supabase, postgres, materialized-view, kpi]
requires: [01-foundation, 02-ingestion]
provides: [kpi_daily_mv-real-body, kpi_daily_v-extended]
affects: [tests/integration/phase3-analytics.test.ts]
tech-stack:
  added: []
  patterns: [drop-cascade-recreate-mv, jwt-claim-wrapper-view]
key-files:
  created:
    - supabase/migrations/0011_kpi_daily_mv_real.sql
  modified:
    - tests/integration/phase3-analytics.test.ts
decisions:
  - "Drop-cascade kpi_daily_mv to replace 0004 placeholder body; cascade dropped kpi_daily_v (recreated in same migration)"
  - "kpi_daily_v exposes 5 cols: restaurant_id, business_date, revenue_cents, tx_count, avg_ticket_cents"
  - "INCLUDES cash + April 2026 transactions per D-06/D-15 — only identity metrics exclude"
  - "Rule 1 fix: plan doc's 1500+1400 single-day assertion wrong (A and B fixture rows on different days); assert each day separately"
metrics:
  duration: ~15min
  completed: 2026-04-14
  tasks: 1
  files: 2
requirements: [ANL-04]
---

# Phase 3 Plan 03: kpi_daily_mv real body Summary

One-liner: Replaced the 0004 placeholder MV body with the real per-day aggregation (sum gross_cents, count tx, avg ticket) keyed on Berlin-local business_date, recreated the kpi_daily_v wrapper with five columns, and flipped ANL-04 tests green.

## What Shipped

- `supabase/migrations/0011_kpi_daily_mv_real.sql` — drop-cascade `public.kpi_daily_mv`, recreate with `sum(gross_cents)::numeric`, `count(*)::int`, `avg_ticket_cents` grouped by `(restaurant_id, (occurred_at at time zone r.timezone)::date)`. Rebuilds the mandatory unique index `(restaurant_id, business_date)`, REVOKEs from anon/authenticated, and recreates `public.kpi_daily_v` (5 cols) with the JWT-claim tenancy filter.
- `tests/integration/phase3-analytics.test.ts` — flipped both ANL-04 `it.todo` to live tests; added `refresh_kpi_daily_mv` RPC call to `beforeAll` next to 03-02's `refresh_cohort_mv`.

## Verification

- `npx vitest run tests/integration/phase3-analytics.test.ts -t "kpi daily"` → 2 passing.
- Full phase3 test file → 5 passing / 10 todo (3 ANL-01 from 03-02 + 2 ANL-04 from 03-03; no regressions).
- `refresh_kpi_daily_mv` RPC still callable on TEST after cascade — the 0006 helper is a plpgsql EXECUTE string with no schema dependency on the MV body, so cascade did NOT drop it (Pitfall 4 hypothesis confirmed).
- Migration applied to DEV via `supabase db push` after `migration repair --status reverted 0011` (DEV migration history pre-recorded 0011 as applied without the body actually existing — repair + push fixed it; `CommandTag SELECT 15` confirmed new MV body inserted 15 aggregated rows).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan doc arithmetic slip on 2025-08-04 assertion**
- Found during: Task 1 test write
- Issue: Plan asked to assert `revenue_cents = 1500 + 1400 = 2900, tx_count=2` on `business_date='2025-08-04'`. Fixture has hash-a on 2025-08-04 (1500) and hash-b on **2025-08-05** (1400) — they're on different days, so 08-04 should be 1500/1 and 08-05 should be 1400/1.
- Fix: Test asserts each day separately with the correct single-tx values. Avg-ticket test uses hash-a 2025-08-18 @ 1800 (single-tx day, avg == gross).
- Files modified: tests/integration/phase3-analytics.test.ts
- Commit: dfa3e9a

**2. [Rule 3 - Blocker] DEV migration history out of sync**
- Found during: `supabase db push` reported "Remote database is up to date" despite missing 0011 body
- Issue: DEV migration history table already contained `0011` row (likely from a prior abandoned attempt) but the actual MV was still the 0004 placeholder shape.
- Fix: `supabase migration repair --status reverted 0011` then `supabase db push` re-applied. `--debug` wire log confirmed `DROP MATERIALIZED VIEW`, `CREATE MATERIALIZED VIEW (SELECT 15)`, `CREATE INDEX`, `REVOKE`, `CREATE VIEW`, `GRANT` all completed.
- No code change needed — operational repair only.

### Skipped Plan Steps

- Plan suggested also asserting "kpi_daily_mv has rows where `business_date BETWEEN '2026-04-01' AND '2026-04-11'`". Skipped because the seed fixture has no April 2026 rows; would need DEV-only assertion that races against the parallel-execution wave. The cash + April inclusion semantics are guaranteed structurally by the absence of any `WHERE` clause filtering them out — D-06 invariant is in the migration body itself.

## Authentication Gates

None.

## Known Stubs

None — kpi_daily_mv body is the production aggregation; tests assert real numbers.

## Self-Check: PASSED

- supabase/migrations/0011_kpi_daily_mv_real.sql — FOUND
- tests/integration/phase3-analytics.test.ts — FOUND (modified)
- Commit dfa3e9a — FOUND in `git log`
- ANL-04 tests passing on TEST: 2/2
