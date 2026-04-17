---
phase: 10-charts
plan: 06
subsystem: ui
tags: [svelte5, layerchart, ltv-histogram, calendar-items, top-n-rollup, d3-scale-chromatic]

# Dependency graph
requires:
  - phase: 10-charts
    provides: "LTV_BINS + binCustomerRevenue (Plan 10-04), rollupTopNWithOther (Plan 10-04), ITEM_COLORS/OTHER_COLOR (Plan 10-04), dashboardStore getFilters + bucketKey (Plan 09)"
provides:
  - "LtvHistogramCard.svelte — VA-07 customer LTV distribution (6 bins)"
  - "CalendarItemsCard.svelte — VA-08 stacked item counts with top-8 + Other rollup"
affects: [10-charts-08-ssr-fanout]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LayerChart BarChart single-series (y='customers') for histogram vs stacked-series (series+seriesLayout='stack') for categorical breakdown"
    - "Client-side rebucket via bucketKey(grain) + top-N rollup — mirrors dashboardStore.shapeForChart pattern"
    - "Zero-fill series keys per bucket to prevent LayerChart stack-gap artifacts"

key-files:
  created:
    - "src/lib/components/LtvHistogramCard.svelte"
    - "src/lib/components/CalendarItemsCard.svelte"
    - "tests/unit/LtvHistogramCard.test.ts"
    - "tests/unit/CalendarItemsCard.test.ts"
  modified: []

key-decisions:
  - "LtvHistogramCard is cohort-wide (no filter/range prop) — LTV is lifetime; filter-scoping would be semantically wrong"
  - "CalendarItemsCard computes top-8 from the filtered window — SQL can't choose top-8 because it's window-dependent (D-14)"
  - "Zero-fill missing series keys per bucket so LayerChart stack math stays stable"

patterns-established:
  - "LayerChart single-series histogram: omit `series` prop, use `y='customers'` directly"
  - "LayerChart stacked chart series config: {key, label, color} — color picked from palette by position, 'Other' pinned to OTHER_COLOR"

requirements-completed: [VA-07, VA-08]

# Metrics
duration: 4min
completed: 2026-04-17
---

# Phase 10 Plan 06: LTV Histogram + Calendar Items Cards Summary

**VA-07 LtvHistogramCard (6-bin distribution) + VA-08 CalendarItemsCard (stacked top-8 + Other) shipped as Svelte 5 components consuming LayerChart BarChart.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-17T09:41:57Z
- **Completed:** 2026-04-17T09:45:56Z
- **Tasks:** 2
- **Files modified:** 4 (2 components, 2 unit test files)

## Accomplishments

- LtvHistogramCard renders a 6-bin BarChart of per-customer lifetime revenue distribution, backed by LTV_BINS + binCustomerRevenue (D-12/D-13). Empty bins seeded at count=0 preserve label order on the x-axis.
- CalendarItemsCard renders stacked BarChart of item_count by item_name per grain bucket, with top-8 items chosen from the filtered window and the rest rolled into a gray "Other" segment (D-14/D-15). Respects sales_type + is_cash filters from dashboardStore.getFilters(); grain via bucketKey.
- Both cards ship with EmptyState wiring (D-18/D-20) and data-testid attributes matching the e2e charts-all.spec.ts assertions from Plan 10-01.
- Build green (28s), 6 new unit tests pass, all acceptance criteria verified.

## Task Commits

1. **Task 1: LtvHistogramCard.svelte (VA-07)** — `284b989` (feat)
2. **Task 2: CalendarItemsCard.svelte (VA-08)** — `85811dd` (feat)

Each task followed RED → GREEN: unit test authored first and confirmed failing on missing import, component shipped, test flipped green, build re-verified.

## Files Created/Modified

- `src/lib/components/LtvHistogramCard.svelte` — VA-07 6-bin LTV histogram
- `src/lib/components/CalendarItemsCard.svelte` — VA-08 stacked items chart with top-8 + Other
- `tests/unit/LtvHistogramCard.test.ts` — 3 unit tests: empty state, heading, bin label presence
- `tests/unit/CalendarItemsCard.test.ts` — 3 unit tests: empty state, heading, top-8 rollup render

## Decisions Made

- **LtvHistogramCard is filter-independent.** The card accepts only `data: CustomerLtvRow[]` and has no `range`/filter prop, following CohortRetentionCard's filter-independence pattern. LTV is a lifetime metric — slicing it by the active range window would produce a semantically incorrect chart.
- **CalendarItemsCard computes top-8 client-side.** D-14 mandates client-side rollup because the "top-8" set depends on the active filtered window; precomputing at SQL time would fix the wrong set. `rollupTopNWithOther` handles the sort + collapse.
- **Zero-fill before rendering stacked series.** LayerChart's stack math can render hairline gaps when a series key is present on one bucket but missing on another; we fill every `topItems` key with 0 on each bucket row to prevent that.
- **`Other` segment pinned to gray (OTHER_COLOR = zinc-400).** Matches the D-07 cash-segment gray — "everything else" is visually consistent across charts.

## Deviations from Plan

None — plan executed exactly as written. The plan's code snippets for both tasks compiled and rendered correctly on the first attempt. One minor typing tweak was applied in CalendarItemsCard's `bucketMap` record type (`Record<string, number | string>` instead of the plan's `Record<string, number>`, so the `bucket` string column could live alongside the numeric series keys) — that is a type-narrowing refinement, not a behavior deviation.

## Issues Encountered

None.

## Known Stubs

None — both components render fully from their data props. Empty-state branches are intentional per D-18/D-20.

## User Setup Required

None — no external service configuration required.

## Self-Check: PASSED

- `src/lib/components/LtvHistogramCard.svelte` — FOUND
- `src/lib/components/CalendarItemsCard.svelte` — FOUND
- `tests/unit/LtvHistogramCard.test.ts` — FOUND (3 tests pass)
- `tests/unit/CalendarItemsCard.test.ts` — FOUND (3 tests pass)
- Commit `284b989` — FOUND (Task 1)
- Commit `85811dd` — FOUND (Task 2)
- `npm run build` — exit 0 (28s)

## Next Phase Readiness

- VA-07 + VA-08 components ready for consumption via the Plan 10-08 SSR fan-out. `+page.server.ts` must:
  - Load `customer_ltv_v` rows (lifetime, unfiltered by range) and pass as `data` to LtvHistogramCard.
  - Load `item_counts_daily_v` rows scoped to the active window's business_date range and pass as `data` to CalendarItemsCard.
- Fixture plumbing already done in Plan 10-04 (`E2E_CUSTOMER_LTV_ROWS`, `E2E_ITEM_COUNTS_ROWS` in `src/lib/e2eChartFixtures.ts`). Plan 10-08 wires them into the `?__e2e=charts` bypass branch.
- No blockers for Wave 5.

---
*Phase: 10-charts*
*Completed: 2026-04-17*
