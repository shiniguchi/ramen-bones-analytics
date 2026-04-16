---
phase: 09-filter-simplification-performance
plan: 01
subsystem: database, ui, filters
tags: [supabase, svelte-5, runes, zod, date-fns, accessibility]

requires:
  - phase: 08-visit-attribution-data-model
    provides: visit_attribution_mv with is_cash column
  - phase: 06-filter-foundation
    provides: filtersSchema, parseFilters, transactions_filterable_v
provides:
  - transactions_filterable_v with is_cash via visit_attribution_mv JOIN
  - is_cash 3-state filter enum (all/cash/card)
  - sales_type single enum filter (all/INHOUSE/TAKEAWAY), replacing CSV multi-select
  - dashboardStore.svelte.ts with pure filter/bucket/aggregate functions + reactive state
  - SegmentedToggle generic 3-state radio group component
affects: [09-02, dashboard-loader, filter-ui]

tech-stack:
  added: []
  patterns:
    - "Svelte 5 module-level runes with getter exports (no direct $derived export)"
    - "Client-side rebucketing via pure functions (bucketKey/filterRows/aggregateByBucket)"
    - "3-state toggle pattern: SegmentedToggle with role=group + role=radio + aria-checked"

key-files:
  created:
    - supabase/migrations/0022_transactions_filterable_v_is_cash.sql
    - src/lib/dashboardStore.svelte.ts
    - src/lib/components/SegmentedToggle.svelte
    - tests/unit/dashboardStore.test.ts
  modified:
    - src/lib/filters.ts
    - tests/unit/filters.test.ts

key-decisions:
  - "Svelte 5 forbids exporting $derived from .svelte.ts modules; used getter functions (getFiltered, getBucketed, etc) as the public API"
  - "payment_method kept in SQL view for backward compat but removed from filter schema"
  - "COALESCE(va.is_cash, true) treats unattributed rows as cash (safe default)"

patterns-established:
  - "dashboardStore pattern: pure functions for testability, reactive wiring via private $derived + public getters"
  - "SegmentedToggle: reusable 3-state radio with ARIA, replaces GrainToggle pattern"

requirements-completed: [VA-11, VA-12]

duration: 6min
completed: 2026-04-16
---

# Phase 9 Plan 01: Filter Data Foundation Summary

**transactions_filterable_v gains is_cash via visit_attribution_mv JOIN; dashboardStore enables client-side rebucketing with pure filter/aggregate functions; SegmentedToggle ships as reusable 3-state radio**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-16T20:36:15Z
- **Completed:** 2026-04-16T20:42:21Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Migration 0022 rewrites transactions_filterable_v with LEFT JOIN on visit_attribution_mv, adding is_cash column
- Filter schema simplified: payment_method removed, sales_type changed from CSV multi-select to single 3-state enum, is_cash 3-state enum added
- Dashboard store exports pure functions (bucketKey, filterRows, aggregateByBucket, computeKpiTotals) with reactive state via Svelte 5 runes
- SegmentedToggle component: generic 3-state radio with ARIA attributes, 44px touch targets, blue-50/blue-600 active state

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration + filter schema + unit tests** - `ea6b045` (feat)
2. **Task 2: Dashboard store + SegmentedToggle component** - `4037065` (feat)

## Files Created/Modified
- `supabase/migrations/0022_transactions_filterable_v_is_cash.sql` - View rewrite with visit_attribution_mv JOIN
- `src/lib/filters.ts` - Simplified schema: is_cash enum, sales_type enum, no payment_method
- `src/lib/dashboardStore.svelte.ts` - Fetch-once store with client-side rebucketing
- `src/lib/components/SegmentedToggle.svelte` - Generic 3-state radio group
- `tests/unit/filters.test.ts` - 20 tests for updated filter schema
- `tests/unit/dashboardStore.test.ts` - 14 tests for pure store functions

## Decisions Made
- Svelte 5 forbids exporting `$derived` from `.svelte.ts` modules. Used private `$derived` + public getter functions as the API surface.
- `payment_method` kept in the SQL view column list for backward compat (existing loader references it), but removed from the zod filter schema.
- `COALESCE(va.is_cash, true)` treats rows without visit_attribution_mv entries as cash (safe default for unrefreshed data).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Svelte 5 $derived export restriction**
- **Found during:** Task 2 (Dashboard store)
- **Issue:** Svelte 5 compiler rejects `export const x = $derived(...)` from `.svelte.ts` modules
- **Fix:** Changed to private `$derived` variables with public getter functions (`getFiltered()`, `getBucketed()`, etc.)
- **Files modified:** src/lib/dashboardStore.svelte.ts
- **Verification:** All 14 unit tests pass; getter pattern verified
- **Committed in:** 4037065

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Getter pattern is a minor API shape change. Consumers call `getFiltered()` instead of reading `filtered` directly. No scope creep.

## Issues Encountered
- `.svelte-kit/tsconfig.json` missing in worktree; resolved by running `npx svelte-kit sync` before tests.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all data paths are wired to real functions.

## Next Phase Readiness
- Dashboard store API ready for Plan 09-02 to wire into the page loader
- SegmentedToggle ready for sales_type and is_cash filter bars
- Migration ready to deploy to DEV (depends on Phase 7/8 migrations landing first)

---
*Phase: 09-filter-simplification-performance*
*Completed: 2026-04-16*
