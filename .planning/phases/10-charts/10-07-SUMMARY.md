---
phase: 10-charts
plan: 07
subsystem: ui
tags: [svelte5, layerchart, cohort-analysis, d-17, va-06, va-09, va-10]

# Dependency graph
requires:
  - phase: 10-charts
    provides: customer_ltv_v wrapper (10-03), cohortAgg library + emptyStates entries (10-04), existing CohortRetentionCard (Phase 4 04-04)
provides:
  - CohortRevenueCard.svelte (VA-09) — cohort total revenue bar chart, client-side GROUP BY, D-17 clamp, D-19 sparse, last-12-cohort slice
  - CohortAvgLtvCard.svelte (VA-10) — cohort avg LTV bar chart, same shape as VA-09 with AVG metric
  - CohortRetentionCard.svelte (VA-06) — extended with D-17 weekly-clamp inline hint for UX parity with VA-09/VA-10
  - tests/unit/CohortRetentionCard.test.ts — 3 real GREEN assertions (day→hint, week→no hint, month→no hint)
affects: [10-08 ssr-wiring, e2e-charts-with-data]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D-17 clamp trio: all 3 cohort-semantic charts (VA-06/09/10) share identical cohort-clamp-hint testid + copy + styling (text-xs text-amber-600) — single UX contract"
    - "Reactive reads from dashboardStore.getFilters() in downstream cards — no more SSR-frozen data.filters drift (matches Phase 9 D-04 pattern)"
    - "Cohort chart minimal-dep: just BarChart + EmptyState + cohortAgg helper — no LayerChart Chart/Svg/Axis stack required for vertical bars"

key-files:
  created:
    - src/lib/components/CohortRevenueCard.svelte (VA-09)
    - src/lib/components/CohortAvgLtvCard.svelte (VA-10)
    - .planning/phases/10-charts/deferred-items.md (scope-boundary log)
  modified:
    - src/lib/components/CohortRetentionCard.svelte (D-17 hint added)
    - tests/unit/CohortRetentionCard.test.ts (.todo → it flip)

key-decisions:
  - "CohortRetentionCard hint conditional set to grain === 'day' only (matches plan B2 correction); month-grain pass-through consistent with VA-09/VA-10"
  - "Flipped RED unit test rather than deferring to e2e — @testing-library/svelte is installed so vitest can drive LayerChart via the existing matchMedia shim pattern from cards.test.ts"
  - "Cohort Revenue/AvgLtv cards use plain BarChart (vertical) rather than Chart+Svg+Axis composition — matches plan spec; keeps the 375px bar-legibility contract explicit"

patterns-established:
  - "D-17 hint contract: `<p data-testid=\"cohort-clamp-hint\" class=\"mt-2 text-xs text-amber-600\">Cohort view shows weekly — other grains not applicable.</p>` — byte-identical across VA-06/09/10"
  - "Cohort bar clamp: .slice(-12) after sparse filter keeps last 12 cohorts; 12 bars × bandPadding=0.2 ≈ 22px/bar on 375px width (RESEARCH.md §Pattern 5)"

requirements-completed: [VA-06, VA-09, VA-10]

# Metrics
duration: 4min
completed: 2026-04-17
---

# Phase 10 Plan 07: Cohort Value + Retention Hint Summary

**VA-09 (cohort total revenue bar chart) + VA-10 (cohort avg LTV bar chart) shipped; VA-06 CohortRetentionCard gained matching D-17 weekly-clamp hint for UX parity across all 3 cohort-semantic charts**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-17T09:42:17Z
- **Completed:** 2026-04-17T09:46:40Z
- **Tasks:** 2
- **Files modified:** 5 (2 created, 2 modified, 1 deferred-log)

## Accomplishments

- CohortRevenueCard.svelte (VA-09) renders cohort total revenue as a vertical BarChart — client-side GROUP BY via `cohortRevenueSum`, sparse filter (D-19) applied inside the helper, last-12-cohort slice enforces 375px legibility
- CohortAvgLtvCard.svelte (VA-10) mirrors VA-09 shape with `cohortAvgLtv` for per-customer average
- Both cards auto-clamp grain=day → week and surface the D-17 inline hint ("Cohort view shows weekly — other grains not applicable.")
- CohortRetentionCard (VA-06) gained the same D-17 hint block with byte-identical testid/copy/styling — 3 cohort-semantic charts now share one UX contract
- tests/unit/CohortRetentionCard.test.ts flipped from 2 `.todo` stubs to 3 GREEN `it()` assertions (day→hint shown, week→absent, month→absent)

## Task Commits

1. **Task 1: Create CohortRevenueCard + CohortAvgLtvCard** — `ec6abb5` (feat)
2. **Task 2: Add D-17 hint to CohortRetentionCard + flip test** — `dea571b` (feat)

**Plan metadata commit:** pending (this summary + STATE/ROADMAP updates)

## Files Created/Modified

- `src/lib/components/CohortRevenueCard.svelte` — VA-09; reads customer_ltv rows prop, GROUP BY cohort via `cohortRevenueSum`, vertical BarChart
- `src/lib/components/CohortAvgLtvCard.svelte` — VA-10; same shape, `cohortAvgLtv` helper
- `src/lib/components/CohortRetentionCard.svelte` — added `getFilters` import, `showClampHint = $derived(grain === 'day')`, cohort-clamp-hint `<p>` between header and existing sparse-hint block; rest of file (visibleRows / allSparse / series / Chart) untouched
- `tests/unit/CohortRetentionCard.test.ts` — flipped from 2 `.todo` to 3 GREEN tests using `initStore` + `FILTER_DEFAULTS`; reuses the matchMedia shim pattern from `tests/unit/cards.test.ts`
- `.planning/phases/10-charts/deferred-items.md` — scope-boundary log for parallel-wave artifacts

## Decisions Made

- **Unit test flipped (not deferred to e2e):** `@testing-library/svelte@^5.3.1` is already a devDep and the matchMedia JSDOM shim pattern is already established in `tests/unit/cards.test.ts`. Same pattern applied → 3 tests pass in 14s.
- **Plain BarChart composition:** followed plan's `<BarChart data x y orientation bandPadding>` one-liner rather than the Chart+Svg+Axis stack the retention chart uses. LayerChart BarChart handles its own scales, axes, and tooltips — matches D-01 elegance target.
- **Month grain does NOT trigger hint:** plan's B2 fix explicitly sets `grain === 'day'` only. Users who switch to month see no hint because the cohort chart can natively honor monthly cohorts (via `cohort_month`). Only day-grain is the mismatched case.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met on first pass.

## Issues Encountered

- `npm run test:unit` had 1 test-file error in `tests/unit/CalendarCards.test.ts` (failed to resolve `CalendarRevenueCard.svelte` / `CalendarCountsCard.svelte`). Root cause: parallel wave — Plan 10-05 owns those components. Out-of-scope for 10-07 per deviation-rules scope boundary. Logged in `deferred-items.md`; will self-resolve when 10-05 commits its files. 142 tests still pass; cohort-card coverage unaffected.

## Self-Check: PASSED

- [x] `src/lib/components/CohortRevenueCard.svelte` exists
- [x] `src/lib/components/CohortAvgLtvCard.svelte` exists
- [x] `src/lib/components/CohortRetentionCard.svelte` contains `cohort-clamp-hint` + `getFilters().grain === 'day'`
- [x] `tests/unit/CohortRetentionCard.test.ts` has 3 `it()` blocks (no `.todo`)
- [x] `npx vitest run tests/unit/CohortRetentionCard.test.ts` — 3 passed
- [x] `npm run build` exits 0
- [x] `npm run test:guards` clean
- [x] Commit `ec6abb5` found in `git log`
- [x] Commit `dea571b` found in `git log`

## Known Stubs

None. All 3 cards wire real `$props().data` flows through `cohortAgg` helpers / `pickVisibleCohorts`. The `<EmptyState>` fallback is the documented D-20 empty-state pattern, not a stub.

## User Setup Required

None — pure component work. VA-09/VA-10 become reachable in the UI once Plan 10-08 wires `customer_ltv_v` into `+page.server.ts` and mounts the cards on the dashboard.

## Next Phase Readiness

- **10-08 (SSR wiring):** CohortRevenueCard and CohortAvgLtvCard each accept `{ data: CustomerLtvRow[] }` prop — 10-08 loader passes `customer_ltv_v` query result directly. No additional props needed.
- **E2E parity:** The `cohort-clamp-hint` testid is now present on all 3 cohort-semantic charts; the Plan 10-01 e2e scaffold's hint-presence assertion against CohortRetentionCard already matches what 10-07 shipped.
- **VA-06 regression risk:** Zero — existing `visibleRows`, `allSparse`, `series`, and LayerChart Chart/Svg/Axis/Spline/Highlight/Tooltip stack are untouched. Only additive changes: 1 import, 1 `$derived`, 1 `{#if}` block.

---
*Phase: 10-charts*
*Completed: 2026-04-17*
