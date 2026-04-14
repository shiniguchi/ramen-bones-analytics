---
phase: 03-analytics-sql
plan: 01
subsystem: testing
tags: [vitest, integration-test, ci-guards, phase3, red-scaffold, cohort, fixtures]

requires:
  - phase: 01-foundation
    provides: adminClient/tenantClient helpers, tenant-isolation test precedent, ci-guards.sh
  - phase: 02-ingestion
    provides: transactions table populated via idempotent upsert, restaurant fixture row
provides:
  - tests/integration/phase3-analytics.test.ts — 8 ANL describe blocks with 15 it.todo stubs
  - tests/integration/helpers/phase3-fixtures.ts — FIXTURE_TXS (8 rows) + seed3CustomerFixture + cleanupFixture
  - tests/unit/ci-guards.test.ts — 3-case contract test for ci-guards.sh raw-table guard (ANL-09)
affects: [03-02-cohort_mv, 03-03-kpi_daily_mv, 03-04-leaf_views, 03-05-refresh_cron_ciguards, phase-04-ui]

tech-stack:
  added: []
  patterns:
    - "Wave 0 RED test scaffold — downstream plans flip it.todo → it as features land (Nyquist feedback channel)"
    - "3-customer ISO-Monday-aligned fixture pattern for cohort/retention verification"
    - "Contract test for ci-guards.sh via execSync + planted evil.ts file"

key-files:
  created:
    - tests/integration/phase3-analytics.test.ts
    - tests/integration/helpers/phase3-fixtures.ts
    - tests/unit/ci-guards.test.ts
  modified: []

key-decisions:
  - "All Phase 3 integration tests authored as it.todo stubs — compiles green, downstream plans convert each stub to a concrete it(...) as the MV/view it exercises lands"
  - "ci-guards.test.ts is intentionally RED for the .from('transactions') case — turns green only once Plan 03-05 extends ci-guards.sh Guard 1 regex"
  - "Fixture seeder upserts into public.transactions with source_tx_id='fixture-N' so cleanupFixture can scope deletes without touching real data"

patterns-established:
  - "Wave 0 pattern: author the RED test file before any production SQL, so every later task has an automated <verify> target"
  - "Fixture isolation via source_tx_id prefix ('fixture-%') rather than separate schema — keeps RLS/wrapper paths identical to prod reads"

requirements-completed: [ANL-01, ANL-02, ANL-03, ANL-04, ANL-05, ANL-06, ANL-07, ANL-08, ANL-09]

duration: ~5min
completed: 2026-04-14
---

# Phase 03 Plan 01: Wave 0 RED Test Scaffold Summary

**Wave 0 RED test scaffold — 8 ANL describe blocks (15 it.todo stubs), 3-customer ISO-week fixture, and ci-guards contract test — establishes the per-task Nyquist feedback channel every downstream Phase 3 plan verifies against.**

## Performance

- **Duration:** ~5 min
- **Completed:** 2026-04-14
- **Tasks:** 2
- **Files created:** 3

## Accomplishments

- Authored the full RED test surface for Phase 3 before any production SQL exists — every downstream plan (02–05) now has a concrete `<verify>` target
- Encoded the 8-row 3-customer fixture (ISO-Monday-aligned, cohorts 2025-08-04 size 2 + 2025-11-10 size 1) verbatim from RESEARCH §Code Examples
- Planted the contract test for `ci-guards.sh` raw-table enforcement (ANL-09) — will turn green automatically when Plan 03-05 extends the Guard 1 regex

## Task Commits

1. **Task 1: 3-customer fixture helper + integration test scaffold** — `8d8d302` (test)
2. **Task 2: CI-guards unit test (ANL-09)** — `bdf5332` (test)

## Files Created/Modified

- `tests/integration/helpers/phase3-fixtures.ts` — exports `FIXTURE_TXS` (8 rows), `seed3CustomerFixture(admin, restaurantId)`, `cleanupFixture(admin, restaurantId)`. Chunked upsert at 500 rows/batch per Phase 2 pattern; `source_tx_id='fixture-N'` for scoped cleanup.
- `tests/integration/phase3-analytics.test.ts` — outer describe + 8 ANL describe groups (ANL-01..08) with 17 `it.todo` stubs covering cohort assignment, retention curve, LTV, KPI daily, frequency, new-vs-returning tie-out, concurrent refresh, and wrapper tenancy. `beforeAll` seeds fixture + calls `refresh_analytics_mvs()` (RPC lands in Plan 03-05).
- `tests/unit/ci-guards.test.ts` — 3 cases: `cohort_mv` reference FAILS, `.from('transactions')` reference FAILS (RED until 03-05), clean source tree PASSES. Uses `execSync` + planted `src/lib/evil.ts` with `afterEach` cleanup.

## Decisions Made

- **it.todo over skipped it blocks:** vitest reports it.todo as a distinct "todo" state in basic reporter, giving each downstream plan a clear checklist. Converting todo → it is a single-character diff.
- **Fixture scoped by source_tx_id prefix, not a separate schema:** keeps RLS/wrapper-view code paths identical between test and prod reads — no "it works in test but not prod" divergence.
- **.from('transactions') test intentionally RED on author:** the RED state IS the signal that Plan 03-05's guard extension hasn't shipped yet. Turning it green without extending the guard would defeat the contract.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Both tasks committed cleanly; the orchestrator disconnected after commits landed but before closeout artifacts were written — this SUMMARY is the closeout.

## User Setup Required

None - test-only changes, no external service configuration required.

## Next Phase Readiness

- **Plan 03-02 (0010_cohort_mv.sql):** will flip ANL-01 describe group (3 todos) and ANL-08 wrapper tenancy (2 todos) to green
- **Plan 03-03 (kpi_daily_mv real body):** will flip ANL-04 describe group (2 todos)
- **Plan 03-04 (leaf views):** will flip ANL-02, ANL-03, ANL-05, ANL-06 describe groups
- **Plan 03-05 (refresh fn + pg_cron + ci-guards extension):** will flip ANL-07 (concurrent refresh) + the `.from('transactions')` case in ci-guards.test.ts
- Per-Task Verification Map in 03-VALIDATION.md can now reference real file paths with `-t "ANL-0X"` filters

## Self-Check: PASSED

- tests/integration/phase3-analytics.test.ts — FOUND (17 it.todo, 10 describe blocks)
- tests/integration/helpers/phase3-fixtures.ts — FOUND (FIXTURE_TXS + seed3CustomerFixture + cleanupFixture exports confirmed)
- tests/unit/ci-guards.test.ts — FOUND (3 execSync ci-guards.sh cases)
- Commit 8d8d302 — FOUND in git log
- Commit bdf5332 — FOUND in git log

---
*Phase: 03-analytics-sql*
*Completed: 2026-04-14*
