---
phase: 03-analytics-sql
plan: 02
subsystem: analytics-sql
tags: [cohort-mv, materialized-view, rls-wrapper, pg_cron-prep]
requires:
  - 0004_kpi_daily_mv_template.sql (canonical wrapper-view shape)
  - 0008_transactions_columns.sql (gross_cents, card_hash, occurred_at)
  - 0001_tenancy_schema.sql (restaurants.timezone, JWT restaurant_id claim)
provides:
  - public.cohort_mv (materialized view, day/week/month grain in one wide row)
  - public.cohort_v (tenant-scoped wrapper view; only read path)
  - public.refresh_cohort_mv() (local helper; Plan 05 supersedes)
affects:
  - tests/integration/phase3-analytics.test.ts (ANL-01 todos → passing)
  - tests/integration/helpers/phase3-fixtures.ts (drop bogus business_date column)
tech-stack:
  added: []
  patterns: [wrapper-view + REVOKE + unique index, AT TIME ZONE per-tenant date derivation]
key-files:
  created:
    - supabase/migrations/0010_cohort_mv.sql
  modified:
    - tests/integration/phase3-analytics.test.ts
    - tests/integration/helpers/phase3-fixtures.ts
decisions:
  - Used local refresh_cohort_mv() helper (per plan instruction) so ANL-01 turns green now without waiting for Plan 05's refresh_analytics_mvs()
  - Hardcoded April 2026 blackout range 2026-04-01..2026-04-12 in source CTE (D-06 — gsd-planner deferred parameterization)
metrics:
  duration: 2min
  tasks_completed: 1
  files_changed: 3
  completed: 2026-04-14
---

# Phase 3 Plan 02: cohort_mv Trunk Materialized View Summary

**One-liner:** Load-bearing first-visit cohort MV with day/week/month grain in one wide row, locked behind cohort_v wrapper, with cash + April 2026 Worldline blackout exclusion baked into source CTE.

## What Was Built

- `supabase/migrations/0010_cohort_mv.sql` — `cohort_mv` materialized view per RESEARCH §Pattern 1:
  - Source CTE filters `card_hash IS NULL` (cash exclusion, D-03) and `2026-04-01..2026-04-12` (Worldline blackout, D-06)
  - `first_visits` CTE computes `MIN(occurred_at)` per `(restaurant_id, card_hash)` (D-01)
  - `enriched` CTE derives day/week/month cohorts via `AT TIME ZONE restaurants.timezone` (Phase 1 D-09)
  - Window functions pre-compute `cohort_size_day/week/month` (D-02 — avoids leaf-view recomputation)
- Mandatory unique index `cohort_mv_pk (restaurant_id, card_hash)` for `REFRESH CONCURRENTLY` (Phase 1 D-08)
- `REVOKE ALL ... FROM anon, authenticated` on the raw MV (D-17)
- `cohort_v` wrapper view filtering `restaurant_id::text = (auth.jwt()->>'restaurant_id')` — sole tenant-facing read path
- `refresh_cohort_mv()` SECURITY DEFINER helper, granted only to `service_role` — local stop-gap until Plan 05 ships `refresh_analytics_mvs()`

## Test Status

ANL-01 cohort assignment (3 tests) — **all passing** against DEV:
1. A+B share `cohort_week='2025-08-04'`, `cohort_size_week=2`
2. C has `cohort_week='2025-11-10'`, `cohort_size_week=1`
3. All three customers expose `cohort_day` / `cohort_week` / `cohort_month`; zero `card_hash IS NULL` rows in cohort_mv

```
 ✓ tests/integration/phase3-analytics.test.ts  (15 tests | 12 skipped)
 Tests  3 passed | 12 skipped (15)
```

## Fixture Reality Check

All 8 fixture rows survive the cash filter (every fixture row has `card_hash` set). All 8 also survive the April blackout (fixture dates are 2025-08 through 2025-11). Cohort sizes match expectations exactly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Drop nonexistent `business_date` column from fixture seeder**
- **Found during:** Task 1 (first vitest run)
- **Issue:** `tests/integration/helpers/phase3-fixtures.ts` (Plan 03-01 RED scaffold) inserted rows with `business_date` field, but `transactions` table has no such column (migrations 0003 + 0008 define the schema). PostgREST returned `PGRST204: Could not find the 'business_date' column`.
- **Fix:** Removed `business_date` from the row payload. cohort_mv derives the date via `AT TIME ZONE restaurants.timezone` per Phase 1 D-09 — there's no need to pre-compute it on the row.
- **Files modified:** `tests/integration/helpers/phase3-fixtures.ts`
- **Commit:** 72d773c

**2. [Rule 3 - Blocking] Swap test beforeAll RPC from `refresh_analytics_mvs` to `refresh_cohort_mv`**
- **Found during:** Task 1 (designing turn-green path)
- **Issue:** Test scaffold's `beforeAll` called `admin.rpc('refresh_analytics_mvs')` which doesn't exist until Plan 03-05. Without flipping it, ANL-01 tests cannot run at all.
- **Fix:** Per plan's explicit instruction, added local `refresh_cohort_mv()` helper in 0010 migration AND swapped `beforeAll` to call it. Plan 05 will swap back to `refresh_analytics_mvs()` and drop `refresh_cohort_mv`.
- **Files modified:** `supabase/migrations/0010_cohort_mv.sql`, `tests/integration/phase3-analytics.test.ts`
- **Commit:** 72d773c

## Acceptance Criteria

- [x] `supabase/migrations/0010_cohort_mv.sql` exists
- [x] `create materialized view public.cohort_mv` present (1 occurrence)
- [x] `create unique index cohort_mv_pk` present
- [x] `revoke all on public.cohort_mv from anon, authenticated` present
- [x] `auth.jwt()->>'restaurant_id'` present in wrapper view
- [x] `card_hash is not null` cash exclusion present
- [x] April blackout range `2026-04-01` → `2026-04-12` present
- [x] No `security_invoker` directive on wrapper view (only the comment warning against it)
- [x] Migration applied cleanly via `supabase db push`
- [x] 3 ANL-01 cohort assignment tests pass

## Cleanup Owed

- `public.refresh_cohort_mv()` function — drop in Plan 03-05 once `refresh_analytics_mvs()` ships and the test scaffold's `beforeAll` swaps over.

## Known Stubs

None. cohort_mv is real, queryable, and tested end-to-end against DEV.

## Self-Check: PASSED

- FOUND: supabase/migrations/0010_cohort_mv.sql
- FOUND: commit 72d773c (`feat(03-02): add cohort_mv trunk with day/week/month grain`)
- FOUND: 3 ANL-01 tests passing (vitest run output)
