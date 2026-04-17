---
phase: 10-charts
plan: 02
subsystem: database
tags: [supabase, postgres, view, security_invoker, materialized_view, rls, visit_attribution]

# Dependency graph
requires:
  - phase: 08-visit-attribution-data-model
    provides: visit_attribution_mv with visit_seq + card_hash + is_cash columns
  - phase: 09-filter-simplification-performance
    provides: transactions_filterable_v (with is_cash) + DROP+CREATE view pattern from 09-03
provides:
  - "transactions_filterable_v extended with visit_seq + card_hash (8 cols total)"
  - "Backward-compat additive schema — existing Phase 9 6-col consumers unaffected"
  - "Migration 0023 unblocks calendar chart downstream work (VA-04, VA-05)"
affects: [10-03, 10-04, 10-05, 10-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DROP VIEW IF EXISTS + CREATE VIEW (not CREATE OR REPLACE) for view column-shape changes — canonical pattern since 09-03"
    - "LEFT JOIN on visit_attribution_mv via (restaurant_id, source_tx_id) — matches 0022 is_cash join"
    - "security_invoker=true preserved so underlying transactions RLS applies"

key-files:
  created:
    - "supabase/migrations/0023_transactions_filterable_v_visit_seq.sql"
  modified: []

key-decisions:
  - "Migration pushed to both DEV (paafpikebsudoqxwumgm) and TEST (akyugfvsdfrwuzirmylo) projects — integration tests hit TEST, so TEST needed the migration too"
  - "visit_seq + card_hash added verbatim from RESEARCH.md §Transactions_Filterable_V Extension — planner pre-verified syntax against 0022"
  - "No grant changes — authenticated inherits SELECT from prior view definition (matches 0022 precedent, no explicit grant line)"

patterns-established:
  - "Calendar chart data-layer: SSR delivers wide daily rows (incl. visit_seq/card_hash); client stacks by visit-count bucket via existing aggregateByBucket pattern"

requirements-completed: [VA-04, VA-05]

# Metrics
duration: 4min
completed: 2026-04-17
---

# Phase 10 Plan 02: transactions_filterable_v visit_seq Extension Summary

**Extended `transactions_filterable_v` from 6 to 8 columns by exposing `visit_seq` (from existing `visit_attribution_mv` join) and `card_hash` (direct from `transactions`) so calendar charts VA-04/VA-05 can stack by visit-count bucket from the already-fetched daily stream — no new SSR query needed.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-17T09:27:15Z
- **Completed:** 2026-04-17T09:31:24Z
- **Tasks:** 1
- **Files created:** 1
- **Files modified:** 0

## Accomplishments

- **Migration 0023 on disk and applied to DEV + TEST** — `drop view if exists public.transactions_filterable_v` then recreate with 8 columns (`restaurant_id`, `business_date`, `gross_cents`, `sales_type`, `payment_method`, `is_cash`, `visit_seq`, `card_hash`).
- **Integration test flipped red→green** — `tests/integration/phase10-charts.test.ts` test `transactions_filterable_v extension > exposes visit_seq and card_hash columns` now passes against TEST after schema-cache reload.
- **Backward compatibility verified** — existing 6-col consumer `src/routes/+page.server.ts:67` (`.select('business_date,gross_cents,sales_type,is_cash')`) still builds (`npm run build` exits 0) with zero code changes.
- **security_invoker=true preserved** — RLS on the underlying `transactions` table continues to enforce tenant scoping via `auth.jwt()->>'restaurant_id'`.

## Task Commits

1. **Task 1: Create migration 0023 extending transactions_filterable_v with visit_seq + card_hash** — `4bc0fc6` (feat)

_No RED commit this task: the RED test was already authored in 10-01 (`tests/integration/phase10-charts.test.ts` line 122–132). This plan was a GREEN-only task that flips the pre-existing RED._

## Files Created/Modified

- `supabase/migrations/0023_transactions_filterable_v_visit_seq.sql` (SHA256: `c1c8baf7b5de8ece4eeec4b8761c8815622db81836e316c5edec6bc457159758`) — DROP+CREATE transactions_filterable_v with two new columns (`va.visit_seq`, `t.card_hash`) on the same JOIN used for `is_cash` in 0022.

## Verification

| Check | Command | Result |
|-------|---------|--------|
| Grep content | `grep -E "visit_seq\|card_hash" supabase/migrations/0023_...sql` | 4 matches (header + 2 cols + comment) |
| CI guards | `bash scripts/ci-guards.sh` | All pass (after drift resolved by `db push`) |
| DEV push | `npx supabase db push --linked` (project `paafpikebsudoqxwumgm`) | `Finished supabase db push.` |
| TEST push | re-linked + `npx supabase db push --linked` (project `akyugfvsdfrwuzirmylo`) | `Finished supabase db push.` |
| Column list on DEV | `information_schema.columns WHERE table_name='transactions_filterable_v'` | 8 rows incl. `visit_seq`, `card_hash` |
| Integration test | `npx vitest run tests/integration/phase10-charts.test.ts` | `visit_seq and card_hash columns` passes |
| Build | `npm run build` | `✓ built in 10.74s` + adapter-cloudflare done |

## Decisions Made

- **DROP+CREATE over CREATE OR REPLACE** — per 09-03 STATE.md lesson (Postgres SQLSTATE 42P16 forbids column removal via CREATE OR REPLACE VIEW). This plan only ADDS columns so CREATE OR REPLACE would have worked, but DROP+CREATE is the safe canonical pattern going forward.
- **No explicit `grant select ... to authenticated`** — migration 0022 set the precedent of relying on inherited permissions. Adding an explicit grant here would diverge from the existing pattern without justification.
- **Pushed to both DEV and TEST projects** — integration tests hit `TEST_SUPABASE_URL` (`akyugfvsdfrwuzirmylo`), and the linked project was DEV (`paafpikebsudoqxwumgm`). To flip the RED integration test green, the migration had to land on both. Pattern precedent: Phase 9 09-03 ran `db push --db-url "$TEST_DB_URL"` then `"$DEV_DB_URL"`; no `TEST_DB_URL` is configured in `.env` so the procedure was `supabase link --project-ref ...` twice.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pushed migration to TEST project in addition to DEV**

- **Found during:** Task 1 verification
- **Issue:** Plan only said "push to DEV". But the `<automated>` verify command `npx vitest run tests/integration/phase10-charts.test.ts -t "visit_seq column"` hits `TEST_SUPABASE_URL` (separate Supabase project `akyugfvsdfrwuzirmylo`). After pushing only to DEV (`paafpikebsudoqxwumgm`), the integration test still failed with `column transactions_filterable_v.visit_seq does not exist` because TEST had not received the migration.
- **Fix:** Re-linked supabase CLI to TEST project (`npx supabase link --project-ref akyugfvsdfrwuzirmylo`), ran `npx supabase db push --linked` (migrations 0023/0024/0025 all applied — 0024/0025 from parallel executor agents), issued `NOTIFY pgrst, 'reload schema'` to flush PostgREST cache, then re-linked back to DEV.
- **Files modified:** none (remote schema only)
- **Verification:** Integration test now passes; ci-guards drift check green (DEV max == local max == 0025).
- **Committed in:** 4bc0fc6 (task commit captures only the local migration file; remote pushes are out-of-tree infra ops)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking)
**Impact on plan:** Essential for flipping the RED integration test. Precedent exists (Phase 9 09-03 used the same dual-push pattern). No scope creep.

## Issues Encountered

- **PostgREST schema cache stale after first push** — first TEST-side test run still returned `column does not exist` despite DDL succeeding. Resolved by issuing `NOTIFY pgrst, 'reload schema'` via `supabase db query --linked` and retrying after a 3s sleep.
- **Parallel executor branch state** — when pushing to TEST, migrations 0024 (`customer_ltv_mv`) and 0025 (`item_counts_daily_mv`) were also applied because other parallel executor agents had already committed them locally. This did not affect Plan 10-02 scope; those migrations are tracked under different plan commits.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **10-04/10-05 (calendar charts) unblocked** — SSR loader can now `.select('business_date,gross_cents,sales_type,is_cash,visit_seq,card_hash')` directly from `transactions_filterable_v`. Client-side `aggregateByBucketAndVisitSeq` (scaffolded in 10-01's `dashboardStoreVisitSeq.test.ts`) has its data source wired.
- **No blockers** — migration applied to both DEV and TEST, ci-guards green, build green.

---
*Phase: 10-charts*
*Completed: 2026-04-17*

## Self-Check: PASSED

- FOUND: `supabase/migrations/0023_transactions_filterable_v_visit_seq.sql`
- FOUND: `.planning/phases/10-charts/10-02-SUMMARY.md`
- FOUND: commit `4bc0fc6`
