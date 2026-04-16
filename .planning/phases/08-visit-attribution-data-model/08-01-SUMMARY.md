---
phase: 08-visit-attribution-data-model
plan: 01
subsystem: analytics-sql
tags: [materialized-view, visit-attribution, visit-seq, is-cash, rls, refresh]
dependency_graph:
  requires: [transactions, restaurants]
  provides: [visit_attribution_mv, visit_attribution_v, test_visit_attribution]
  affects: [refresh_analytics_mvs]
tech_stack:
  added: []
  patterns: [mv-wrapper-view, security-definer-test-helper, row-number-window-fn]
key_files:
  created:
    - supabase/migrations/0020_visit_attribution_mv.sql
    - tests/integration/phase8-visit-attribution.test.ts
  modified: []
decisions:
  - "visit_attribution_mv placed last in refresh_analytics_mvs() DAG (no cross-MV dependency)"
  - "is_cash derived from card_hash IS NULL (not payment_method) per D-06"
  - "ROW_NUMBER wrapped in CASE to prevent NULL card_hash partition producing meaningless sequence"
metrics:
  duration: 5min
  completed: 2026-04-16
---

# Phase 8 Plan 01: Visit Attribution MV Summary

New MV tags every transaction with visit_seq (ROW_NUMBER per card_hash) and is_cash (card_hash IS NULL boolean), following the project's 5-step MV pattern with REVOKE ALL + wrapper view + SECURITY DEFINER test helper.

## What Was Built

### Migration 0020_visit_attribution_mv.sql
1. **CREATE MATERIALIZED VIEW** `visit_attribution_mv` -- one row per transaction, ALL rows included (card + cash)
2. **UNIQUE INDEX** on `(restaurant_id, tx_id)` for REFRESH CONCURRENTLY
3. **REVOKE ALL** from anon, authenticated on raw MV
4. **CREATE VIEW** `visit_attribution_v` with JWT `restaurant_id` tenant filter
5. **GRANT SELECT** to authenticated on wrapper view
6. **test_visit_attribution(rid uuid)** SECURITY DEFINER helper for integration tests
7. **refresh_analytics_mvs()** updated to refresh 3 MVs: cohort_mv, kpi_daily_mv, visit_attribution_mv

### Integration Tests (phase8-visit-attribution.test.ts)
- **VA-01 visit_seq correctness**: 3 tests verifying hash-a (1,2,3), hash-b (1,2,3), hash-c (1,2) visit sequences
- **VA-02 is_cash boolean**: cash rows = is_cash true + visit_seq NULL; card rows = is_cash false + visit_seq >= 1
- **RLS wrapper**: anon blocked from raw MV; anonymous gets 0 rows from wrapper view
- **Refresh function**: refresh_analytics_mvs() succeeds covering all 3 MVs

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| CASE guard on ROW_NUMBER | Without it, all NULL card_hash rows share a single partition and get arbitrary sequence numbers |
| is_cash = (card_hash IS NULL) | Consistent with Phase 2/3 convention; covers edge cases where payment_method is non-standard |
| ALL transactions included | Cash rows get visit_seq=NULL, avoiding UNION workarounds in Phase 9/10 charts |
| Refresh position: last | No dependency on cohort_mv or kpi_daily_mv; order doesn't matter |

## Commits

| Hash | Type | Description |
|------|------|-------------|
| e1e9270 | test | RED: failing integration tests for visit_attribution_mv |
| b129487 | feat | GREEN: migration 0020 with MV + wrapper + test helper + refresh update |

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- all data sources are wired (transactions + restaurants join).

## Self-Check: PASSED
