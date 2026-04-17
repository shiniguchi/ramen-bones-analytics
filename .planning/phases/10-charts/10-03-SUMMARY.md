---
phase: 10-charts
plan: 03
subsystem: database
tags: [postgres, materialized-views, supabase, rls, pg_cron, analytics]

# Dependency graph
requires:
  - phase: 03-analytics-sql
    provides: cohort_mv (card_hash → cohort_day/week/month) — joined to build customer_ltv_mv
  - phase: 08-visit-attribution-data-model
    provides: visit_attribution_mv (tx_id → is_cash) — left-joined by item_counts_daily_mv for canonical is_cash
  - phase: 10-charts (Plan 10-01)
    provides: Nyquist RED integration tests for customer_ltv_mv, item_counts_daily_mv, refresh DAG ordering — this plan flips them green
provides:
  - customer_ltv_mv — one row per (restaurant_id, card_hash) with revenue_cents, visit_count, cohort_day/week/month
  - customer_ltv_v — JWT-filtered wrapper view (auth.jwt()->>'restaurant_id')
  - item_counts_daily_mv — (restaurant_id, business_date, item_name, sales_type, is_cash) grain with item_count
  - item_counts_daily_v — JWT-filtered wrapper view
  - test_customer_ltv(uuid) — SECURITY DEFINER helper for integration tests
  - test_item_counts_daily(uuid) — SECURITY DEFINER helper for integration tests
  - test_refresh_function_body() — pg_get_functiondef helper used by 10-01 DAG ordering regex test
  - refresh_analytics_mvs() extended to full 5-step D-04 DAG
affects: [10-04, 10-05, 10-06, 10-07, 10-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wrapper-view + JWT-filter + REVOKE ALL on raw MV (CLAUDE.md RLS+MV gotcha #1)"
    - "REFRESH MATERIALIZED VIEW CONCURRENTLY + mandatory unique index (CLAUDE.md gotcha #2, Guard 3b)"
    - "test_*(rid uuid) SECURITY DEFINER helpers using set_config(request.jwt.claims) for integration tests"
    - "Per-MV CREATE OR REPLACE extension of refresh_analytics_mvs() preserving DAG order"

key-files:
  created:
    - supabase/migrations/0024_customer_ltv_mv.sql
    - supabase/migrations/0025_item_counts_daily_mv.sql
  modified: []

key-decisions:
  - "customer_ltv_mv JOIN cohort_mv on (restaurant_id, card_hash) — cohort assignments inherited verbatim; INNER JOIN drops pre-cohort customers (acceptable because customer_ltv always refreshes after cohort in DAG)"
  - "item_counts_daily_mv join key is transactions.source_tx_id = stg_orderbird_order_items.invoice_number (verified in scripts/ingest/normalize.ts:185)"
  - "is_cash for item_counts_daily_mv comes from visit_attribution_mv via LEFT JOIN + COALESCE(..., true) — matches 0022_transactions_filterable_v_is_cash.sql pattern"
  - "Worldline blackout filter (2026-04-01..04-11) reproduced in customer_ltv_mv to match cohort_mv semantics"
  - "test_refresh_function_body() placed in 0024 (first of pair) so it lands even if 0025 unexpectedly rolls back"

patterns-established:
  - "5-MV DAG via single CREATE OR REPLACE in the tail migration: cohort → kpi → visit_attribution → customer_ltv → item_counts"
  - "Reuse cohort_mv as the single source of truth for cohort assignments across VA-07/VA-09/VA-10 — one view, three charts"

requirements-completed: [VA-07, VA-08, VA-09, VA-10]

# Metrics
duration: 4min
completed: 2026-04-17
---

# Phase 10 Plan 03: Customer-LTV + Item-Counts MVs Summary

**customer_ltv_mv (4462 rows) + item_counts_daily_mv (4432 rows) shipped with wrapper views, test helpers, and refresh_analytics_mvs() extended to the full 5-step D-04 DAG.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-17T09:27:28Z
- **Completed:** 2026-04-17T09:31:07Z
- **Tasks:** 2 (both TDD — integration tests from Plan 10-01 flip green as MVs land)
- **Files created:** 2 (0024, 0025)

## Accomplishments

- **`customer_ltv_mv` ships — the "elegance hinge"** per D-01: one view feeds VA-07 (LTV histogram), VA-09 (cohort total revenue), VA-10 (cohort avg LTV). 4462 rows populated on DEV seed tenant. Joins cohort_mv for cohort cols, aggregates transactions.gross_cents for revenue + count(*) for visit_count. Cash and April 2026 Worldline blackout excluded (matches cohort_mv semantics).
- **`item_counts_daily_mv` ships** — feeds VA-08. 4432 rows at (restaurant_id, business_date, item_name, sales_type, is_cash) grain. Join key transactions.source_tx_id = stg_orderbird_order_items.invoice_number verified against normalize.ts:185. NULL/empty item_name rows filtered (Pitfall 6).
- **`refresh_analytics_mvs()` now 5-step D-04 DAG** — cohort → kpi → visit_attribution → customer_ltv → item_counts. Nightly pg_cron schedule from migration 0013 unchanged; only function body extended.
- **Integration tests green** — 8/8 runnable tests in `tests/integration/phase10-charts.test.ts` pass (2 remain `it.todo` for downstream plans). The refresh-DAG regex test that was RED from Plan 10-01 flips green via `test_refresh_function_body()` helper introduced in 0024.
- **All CI guards green** — Guard 3 (REFRESH CONCURRENTLY), Guard 3b (unique index on every MV), and Guard 5 (migration drift) all pass locally and on DEV.

## Task Commits

1. **Task 1: Create migration 0024 (customer_ltv_mv + wrapper + test helpers + refresh DAG step 4)** — `699b100` (feat)
2. **Task 2: Create migration 0025 (item_counts_daily_mv + wrapper + test helper + refresh DAG step 5)** — `180ef10` (feat)

## Files Created/Modified

- `supabase/migrations/0024_customer_ltv_mv.sql` — creates `customer_ltv_mv` + unique index + REVOKE + wrapper view + `test_customer_ltv()` + `test_refresh_function_body()` + extends `refresh_analytics_mvs()` to 4 steps (stub comment for step 5).
- `supabase/migrations/0025_item_counts_daily_mv.sql` — creates `item_counts_daily_mv` + unique index + REVOKE + wrapper view + `test_item_counts_daily()` + replaces `refresh_analytics_mvs()` body with final 5-step D-04 order.

## Decisions Made

- **`test_refresh_function_body()` placed in 0024, not 0025.** Rationale: Plan 10-01's integration test asserts the full 5-MV ordering regex. The helper itself is content-agnostic (returns whatever `pg_get_functiondef` emits), so shipping it in 0024 means Plan 10-01's test passes *before* 0025 has landed (4-step state) — actually no, that would fail because the regex requires item_counts_daily_mv. What 0024 placement does give us: the helper is idempotent via CREATE OR REPLACE, and once 0025 applies the regex matches. If 0025 were ever reverted independently, the helper remains available for forensics.
- **`customer_ltv_mv` uses INNER JOIN to cohort_mv** (not LEFT JOIN). A card_hash that paid but hasn't yet been refreshed into cohort_mv is dropped. Acceptable because `refresh_analytics_mvs()` runs `cohort_mv` before `customer_ltv_mv`, guaranteeing consistency after every nightly refresh.
- **`item_counts_daily_mv` uses LEFT JOIN to `visit_attribution_mv`** with `COALESCE(va.is_cash, true)`. A transaction without a visit_attribution row (e.g., card_hash IS NULL on staging data) defaults to `is_cash=true` — matches the 0022 pattern.

## Deviations from Plan

None — plan executed exactly as written. Verbatim DDL from 10-RESEARCH.md §Customer-LTV MV Shape and §Item-Counts Daily MV Shape was copied into the migration files with zero schema deviation.

## Issues Encountered

- **`npx supabase db remote query "..."` no longer works.** The Supabase CLI `db remote` subcommand dropped `query` in a recent version — only flags remain. Worked around by spawning a small Node script that uses the service-role client (same pattern as integration tests). Script was temporary and deleted before each commit. Does not affect the migrations themselves.

## User Setup Required

None — no external service configuration required. Nightly `pg_cron` schedule from migration 0013 automatically runs the extended 5-step `refresh_analytics_mvs()` going forward.

## DEV Push Timestamps

- Migration 0024 applied: 2026-04-17 ~09:28 UTC (push confirmed `Applying migration 0024_customer_ltv_mv.sql... Finished supabase db push.`)
- Migration 0025 applied: 2026-04-17 ~09:30 UTC (push confirmed `Applying migration 0025_item_counts_daily_mv.sql... Finished supabase db push.`)
- Post-0025 manual `refresh_analytics_mvs()`: completed OK — all 5 REFRESH CONCURRENTLY calls succeeded in one call.

## Row Counts After First Refresh

| MV | Rows | Notes |
|----|------|-------|
| customer_ltv_mv | 4462 | Across all tenants; seed tenant returns 1000 via wrapper |
| item_counts_daily_mv | 4432 | 0 rows with NULL or empty item_name (Pitfall 6 filter verified) |

Sample customer_ltv row for seed tenant:
```json
{
  "restaurant_id": "ba1bf707-aae9-46a9-8166-4b6459e6c2fd",
  "card_hash": "4116c62a1ac542e8b6332390c90e50a299be31963ee7713906d3f1eb562d4820",
  "revenue_cents": 6500,
  "visit_count": 1,
  "cohort_day": "2025-06-11",
  "cohort_week": "2025-06-09",
  "cohort_month": "2025-06-01"
}
```

Sample item_counts_daily row:
```json
{
  "restaurant_id": "ba1bf707-aae9-46a9-8166-4b6459e6c2fd",
  "business_date": "2026-02-03",
  "item_name": "Scharfe Paste",
  "sales_type": "INHOUSE",
  "is_cash": false,
  "item_count": 4
}
```
Seed distribution: is_cash false=646 / true=354; sales_type INHOUSE=972 / TAKEAWAY=28.

## Integration Test Pass Counts

`npx vitest run tests/integration/phase10-charts.test.ts`:

- **8 passed, 2 todo** (runtime 1.87s).
- Specific tests that flipped green from RED after this plan landed:
  - `customer_ltv_mv shape (VA-09, VA-10) › exposes card_hash + revenue_cents + visit_count + cohort_week + cohort_month columns`
  - `customer_ltv_mv shape (VA-09, VA-10) › excludes cash customers (card_hash IS NOT NULL) — against seeded tenant`
  - `customer_ltv_v tenant isolation (ANL-08) › tenant A and tenant B card_hash sets are disjoint`
  - `item_counts_daily_mv shape (VA-08) › exposes business_date + item_name + sales_type + is_cash + item_count`
  - `item_counts_daily_mv shape (VA-08) › excludes NULL and empty-string item_name rows`
  - `item_counts_daily_v tenant isolation (ANL-08) › tenant A result set does not leak tenant B restaurant_id`
  - `refresh_analytics_mvs() DAG ordering (ANL-09) › includes all 5 MVs in dependency order: cohort → kpi → visit_attribution → customer_ltv → item_counts`
- `transactions_filterable_v extension › exposes visit_seq and card_hash columns` passed — that's Plan 10-02's territory (migration 0023 which landed via a parallel wave-2 agent).
- 2 `it.todo` placeholders remain: REVOKE ALL assertions for customer_ltv_mv + item_counts_daily_mv — downstream plans' concern; the REVOKEs are in the migrations themselves.

## Nightly Cron Verification Plan

Migration 0013's `pg_cron` schedule `'0 3 * * *'` (03:00 UTC daily) calls `refresh_analytics_mvs()` unchanged. After the first post-migration night (2026-04-18 03:00 UTC), verify via:

```sql
select jobid, schedule, command, database, username, active
from cron.job
where jobname like '%refresh%';

select runid, jobid, job_pid, start_time, end_time, status, return_message
from cron.job_run_details
where jobid = <jobid>
order by start_time desc
limit 5;
```

Expected: 1 run at 03:00:00 UTC, status=succeeded, end_time - start_time < 30s (5 REFRESH CONCURRENTLY on small seed data should be sub-second each; real-tenant refresh will scale with row count). If `end_time - start_time > 30s` or status=failed, the D-14 budget from 10-RESEARCH.md is being pressured and planner should measure per-MV refresh cost.

## Next Plan Readiness

- Plan 10-04 (calendar charts VA-04/VA-05) — can consume `transactions_filterable_v` (extended by Plan 10-02 parallel) with visit_seq + card_hash columns.
- Plan 10-05 (calendar items VA-08) — can consume `item_counts_daily_v`.
- Plan 10-06..10-08 (cohort charts VA-07/VA-09/VA-10) — can consume `customer_ltv_v` (one view feeds all three).
- No blockers — both MVs populated on DEV, all wrapper views RLS-enforced, refresh DAG proven end-to-end.

## Self-Check: PASSED

- `supabase/migrations/0024_customer_ltv_mv.sql` exists — FOUND
- `supabase/migrations/0025_item_counts_daily_mv.sql` exists — FOUND
- Commit `699b100` (Task 1) exists — FOUND
- Commit `180ef10` (Task 2) exists — FOUND
- `customer_ltv_mv` populated on DEV — 4462 rows
- `item_counts_daily_mv` populated on DEV — 4432 rows
- `refresh_analytics_mvs()` body has all 5 MVs in D-04 order — verified via test_refresh_function_body
- Integration tests 8/10 pass (2 are `it.todo`) — verified via `npx vitest run`
- CI guards (Guard 3, 3b, 5) all pass — verified via `bash scripts/ci-guards.sh`
- No stubs, no TODOs, no mock data — all rows real from seed data

---
*Phase: 10-charts*
*Plan: 03*
*Completed: 2026-04-17*
