---
phase: 09-filter-simplification-performance
plan: 02
subsystem: ui, filters, loader
tags: [sveltekit, svelte-5, runes, replaceState, client-side-rebucketing]

requires:
  - phase: 09-01
    provides: dashboardStore with pure functions and getter-based reactive state, SegmentedToggle, is_cash filter enum
provides:
  - Simplified SSR loader returning raw daily rows (no pre-aggregated KPI tiles)
  - 2-row FilterBar with inline SegmentedToggles for sales_type + is_cash
  - GrainToggle and DatePickerPopover using replaceState (no SSR round-trip)
  - 2 KPI tiles (Revenue + Transactions) driven by dashboardStore
  - Dead component cleanup (FilterSheet, MultiSelectDropdown deleted)
affects: [09-03, dashboard-charts, e2e-tests]

tech-stack:
  added: []
  patterns:
    - "replaceState for all filter controls — no SSR round-trip, <200ms client-side response"
    - "SSR returns raw daily rows; all filtering + bucketing + KPI computation is client-side"
    - "onrangechange callback pattern: DatePickerPopover emits, page handles store update"

key-files:
  created: []
  modified:
    - src/routes/+page.server.ts
    - src/routes/+page.svelte
    - src/lib/components/FilterBar.svelte
    - src/lib/components/GrainToggle.svelte
    - src/lib/components/DatePickerPopover.svelte
    - src/lib/components/CohortRetentionCard.svelte
    - tests/unit/pageServerLoader.test.ts
    - tests/unit/FilterBar.test.ts
    - tests/e2e/dashboard-happy-path.spec.ts
    - tests/e2e/filter-bar.spec.ts

key-decisions:
  - "SSR returns dailyRows + priorDailyRows instead of pre-aggregated kpi object — reduces from 12+ queries to 2 + retention + insight"
  - "DatePickerPopover accepts onrangechange callback instead of handling store/fetch internally — keeps component pure"
  - "getKpiTotals() getter called in $derived for reactive tile updates — Svelte 5 getter pattern from Plan 01"

patterns-established:
  - "replaceState + store setter = instant URL sync without SSR for all filter controls"
  - "2-row FilterBar: row 1 = date picker, row 2 = horizontal-scrolling toggles with zinc separators"

requirements-completed: [VA-11, VA-12, VA-13]

duration: 8min
completed: 2026-04-16
---

# Phase 9 Plan 02: Wire Filter UI Summary

**Simplified dashboard: 2-row FilterBar with inline toggles, 2 KPI tiles from client-side store, replaceState everywhere for <200ms filter response**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-16T20:46:16Z
- **Completed:** 2026-04-16T20:55:00Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- SSR loader rewritten: 12+ parallel queries reduced to 2 (current + prior daily rows) + retention + insight
- FilterBar shows 2-row layout: DatePickerPopover in row 1, Grain + Sales Type + Cash/Card toggles in row 2
- All filter controls use replaceState (no SSR round-trip, no goto with invalidateAll)
- Dashboard shows exactly 2 KPI tiles (Revenue + Transactions) with dynamic range label and delta vs prior
- GrainToggle moved from CohortRetentionCard header to FilterBar (global control)
- FilterSheet.svelte and MultiSelectDropdown.svelte deleted (replaced by inline SegmentedToggles)
- All unit tests updated and passing (80/80)

## Task Commits

1. **Task 1: SSR rewrite + GrainToggle/DatePicker replaceState** - `9d60295` (feat)
2. **Task 2: FilterBar rewrite + page.svelte 2 tiles + delete dead components** - `9fb293b` (feat)

## Files Created/Modified
- `src/routes/+page.server.ts` - Simplified loader: dailyRows + priorDailyRows + retention + insight
- `src/routes/+page.svelte` - 2 KPI tiles driven by dashboardStore getKpiTotals()
- `src/lib/components/FilterBar.svelte` - 2-row layout with SegmentedToggles
- `src/lib/components/GrainToggle.svelte` - replaceState + setGrain
- `src/lib/components/DatePickerPopover.svelte` - replaceState + onrangechange callback
- `src/lib/components/CohortRetentionCard.svelte` - GrainToggle removed
- `src/lib/components/FilterSheet.svelte` - **DELETED**
- `src/lib/components/MultiSelectDropdown.svelte` - **DELETED**
- `tests/unit/pageServerLoader.test.ts` - Updated for new loader shape
- `tests/unit/FilterBar.test.ts` - Updated for new component API
- `tests/e2e/dashboard-happy-path.spec.ts` - Updated for 2-tile layout
- `tests/e2e/filter-bar.spec.ts` - Updated for inline toggles, removed FilterSheet tests

## Decisions Made
- SSR returns raw `dailyRows` + `priorDailyRows` instead of pre-aggregated `kpi` object. This reduces server queries from 12+ to 4 (2 daily-row queries + retention + insight).
- DatePickerPopover emits `onrangechange` callback rather than directly managing store/fetch. The page component handles cache-check logic.
- `getKpiTotals()` getter is called inside `$derived()` in page.svelte for reactive tile updates, following the getter pattern established in Plan 01.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - all data paths are wired to real store functions.

## Next Phase Readiness
- Dashboard is fully functional with 2 filters + 2 tiles + cohort retention
- Chart cards can be added in future plans, consuming bucketed data from dashboardStore
- E2E tests updated for new layout, ready for Phase 9 Plan 03 if it exists

---
*Phase: 09-filter-simplification-performance*
*Completed: 2026-04-16*
