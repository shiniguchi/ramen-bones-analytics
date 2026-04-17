---
phase: 10-charts
plan: 04
subsystem: ui
tags: [charts, svelte-5, d3-scale-chromatic, visit-attribution, cohort-agg, palette]

# Dependency graph
requires:
  - phase: 10-01
    provides: Wave 0 RED test scaffold (chartPalettes/ltvHistogram/itemCountsRollup/cohortAgg/dashboardStoreVisitSeq)
  - phase: 10-02
    provides: transactions_filterable_v with visit_seq + card_hash columns
  - phase: 10-03
    provides: customer_ltv_mv + item_counts_daily_mv (data sources for Wave 4 charts)
provides:
  - Pure client-side aggregation/binning/palette modules for Wave 4 chart components
  - VISIT_SEQ_COLORS/CASH_COLOR/ITEM_COLORS/OTHER_COLOR constants (D-06/D-07/D-15)
  - LTV_BINS + binCustomerRevenue (VA-07, D-12)
  - rollupTopNWithOther generic helper (VA-08, D-14)
  - cohortRevenueSum + cohortAvgLtv with SPARSE_MIN_COHORT_SIZE=5 reuse (VA-09/VA-10)
  - DailyRow.visit_seq + card_hash + visitSeqBucket + aggregateByBucketAndVisitSeq + shapeForChart (VA-04/VA-05)
  - 6 new emptyStates copy entries for Phase 10 cards (D-18)
affects: [10-05, 10-06, 10-07, 10-08]

# Tech tracking
tech-stack:
  added: [d3-scale-chromatic@3.1.0, "@types/d3-scale-chromatic"]
  patterns:
    - "Pure pure-function modules in src/lib/ for chart aggregation (no Svelte state, no I/O)"
    - "Additive extension of DailyRow type with new optional-like fields (visit_seq, card_hash) preserves backward compat for existing consumers"
    - "Reuse SPARSE_MIN_COHORT_SIZE constant across sparseFilter.ts and cohortAgg.ts to avoid threshold drift"
    - "shapeForChart wide-format with VISIT_KEYS union + missing-key-to-zero coercion — LayerChart BarChart consumes directly"

key-files:
  created:
    - src/lib/chartPalettes.ts
    - src/lib/ltvBins.ts
    - src/lib/itemCountsRollup.ts
    - src/lib/cohortAgg.ts
  modified:
    - src/lib/dashboardStore.svelte.ts
    - src/lib/emptyStates.ts
    - package.json
    - package-lock.json

key-decisions:
  - "d3-scale-chromatic promoted from transitive (via layerchart) to direct devDependency — now load-bearing for chart palettes; avoids breakage if layerchart ever drops the transitive dep"
  - "Plan-flagged +page.server.ts strict-mode risk did NOT materialize — existing `as DailyRow[]` casts bypass strict-mode checks for the 2 added optional-like fields; no 10-08 coordination needed for Wave 4 build gate"
  - "Extended DailyRow with 2 new fields additively; filterRows/aggregateByBucket/computeKpiTotals unchanged — backward compat held (dashboardStore.test.ts still 22/22 green)"
  - "cohortAgg duplicates the `>= SPARSE_MIN_COHORT_SIZE` filter check (not reusing pickVisibleCohorts) because that helper is typed for RetentionRow only; threshold constant is shared"

patterns-established:
  - "Module boundary: pure fns in src/lib/*.ts consume + return plain data; Svelte runes stay inside .svelte.ts stores and .svelte components"
  - "VISIT_KEYS ordering ('1st','2nd','3rd','4x','5x','6x','7x','8x+','cash') is the canonical stack order for Wave 4 BarChart series"

requirements-completed: [VA-04, VA-05, VA-07, VA-08, VA-09, VA-10]

# Metrics
duration: 6min
completed: 2026-04-17
---

# Phase 10 Plan 04: Client Chart Libraries Summary

**5 pure-function modules + 2 extended stores that flip all 5 Wave 0 RED tests GREEN — Wave 4 chart components can now import palettes / bins / rollup / cohort agg / visit_seq aggregator from src/lib without any remaining scaffolding.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-17T11:35:30Z (approx)
- **Completed:** 2026-04-17T11:38:17Z
- **Tasks:** 2 (both TDD, flipping pre-existing RED scaffolds)
- **Files created:** 4
- **Files modified:** 4 (dashboardStore, emptyStates, package.json, package-lock.json)

## Accomplishments

- 4 new pure modules landed in src/lib/: chartPalettes (21 L), ltvBins (19 L), itemCountsRollup (15 L), cohortAgg (46 L) — all under 50 lines, zero Svelte state, zero I/O
- DailyRow type extended with visit_seq + card_hash; 3 new exports (visitSeqBucket, aggregateByBucketAndVisitSeq, shapeForChart) layered additively onto dashboardStore.svelte.ts
- emptyStates.ts gains 6 Phase 10 keys (calendar-revenue, calendar-counts, calendar-items, cohort-revenue, cohort-avg-ltv, ltv-histogram) alongside preserved original 4
- d3-scale-chromatic promoted to direct dep (defensive — previously transitive via layerchart only)
- All 5 Wave 0 RED test files flip GREEN:
  - tests/unit/chartPalettes.test.ts (4/4)
  - tests/unit/ltvHistogram.test.ts (9/9)
  - tests/unit/itemCountsRollup.test.ts (4/4)
  - tests/unit/cohortAgg.test.ts (5/5)
  - tests/unit/dashboardStoreVisitSeq.test.ts (13/13)
- Full unit suite: 129 passed / 2 todo / 1 skipped (CohortRetentionCard stays .todo until 10-07 per plan)
- `npm run build` exits 0 — no +page.server.ts edit required (strict-mode cast bypass held)
- `npm run test:guards` clean

## Task Commits

1. **Task 1: Create chartPalettes + ltvBins + itemCountsRollup + cohortAgg** — `74af266` (feat)
   - 4 new modules + direct dep promotion
   - 22 tests flip RED → GREEN
2. **Task 2: Extend dashboardStore with visit_seq + emptyStates with 6 keys** — `cd6bd45` (feat)
   - DailyRow type extension + 3 new exports + 6 new emptyState keys
   - 13 visit_seq tests flip RED → GREEN
   - Existing dashboardStore.test.ts (22/22) + full unit suite (129 passed) verified

**Plan metadata:** _(final docs commit to follow)_

## Files Created/Modified

**Created:**
- `src/lib/chartPalettes.ts` (21 L) — VISIT_SEQ_COLORS/CASH_COLOR/ITEM_COLORS/OTHER_COLOR palette constants
- `src/lib/ltvBins.ts` (19 L) — LTV_BINS (6 bins €0-10..€250+) + binCustomerRevenue right-exclusive binning
- `src/lib/itemCountsRollup.ts` (15 L) — generic rollupTopNWithOther<T> top-N + Other helper
- `src/lib/cohortAgg.ts` (46 L) — cohortRevenueSum + cohortAvgLtv with SPARSE_MIN_COHORT_SIZE reuse

**Modified:**
- `src/lib/dashboardStore.svelte.ts` (+54 L) — DailyRow.visit_seq + card_hash + visitSeqBucket + aggregateByBucketAndVisitSeq + shapeForChart
- `src/lib/emptyStates.ts` (+7 L) — 6 new Phase 10 keys (D-18) + preserved 4 originals
- `package.json`, `package-lock.json` — d3-scale-chromatic + @types/d3-scale-chromatic promoted to direct deps

## Decisions Made

- **d3-scale-chromatic direct dep promotion (Rule 2 — missing critical):** The package was already installed transitively via layerchart but not declared in package.json. Promoted to direct dep so the chartPalettes import stays load-bearing even if layerchart later drops the transitive path.
- **Plan's +page.server.ts build-break caveat did NOT materialize:** Plan warned `npm run build` might fail on strict-mode type checks for the hardcoded E2E bypass DailyRow literals after adding visit_seq/card_hash to the type. In practice the existing `as DailyRow[]` cast on those literal arrays bypasses strict-mode — build exits 0 without edits. Wave 4 plans do NOT need to wait on 10-08 for build-gate unblocking.
- **cohortAgg duplicates threshold check (not reusing pickVisibleCohorts):** pickVisibleCohorts in sparseFilter.ts is typed for RetentionRow only; cohortAgg reuses the SPARSE_MIN_COHORT_SIZE constant but does its own filter on the CustomerLtvRow shape. Documented in-file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added d3-scale-chromatic as direct dependency**
- **Found during:** Task 1 setup (package.json check)
- **Issue:** chartPalettes.ts imports `interpolateBlues`, `schemeTableau10` from 'd3-scale-chromatic' but package was only in node_modules as a transitive via layerchart — not declared as a direct dep. Any future layerchart minor bump that drops the transitive would silently break chart palettes.
- **Fix:** `npm install d3-scale-chromatic @types/d3-scale-chromatic --save` → now `d3-scale-chromatic@3.1.0` lives in `dependencies` alongside @types/d3-scale-chromatic@3.1.0 in devDependencies
- **Files modified:** package.json, package-lock.json
- **Verification:** `npm run build` exits 0; chartPalettes tests 4/4 pass; full unit suite 129 green
- **Committed in:** 74af266 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2 — missing critical dependency declaration)
**Impact on plan:** Defensive dep declaration only. No scope change. Every other task ran plan-as-written.

## Issues Encountered

None. Plan interfaces matched Wave 0 RED test expectations exactly; all tests flipped GREEN on first compile.

## User Setup Required

None — pure library addition, no external service configuration.

## Next Phase Readiness

**Ready for:**
- Wave 4 plans (10-05 calendar charts, 10-06 LTV/item charts, 10-07 cohort charts) — all client-side aggregation primitives now ship from src/lib
- 10-08 (SSR plumbing) — can layer visit_seq/card_hash field selection onto transactions_filterable_v query in +page.server.ts without touching DailyRow type (already extended)

**Dependency signals for Wave 4 components:**
- `import { VISIT_SEQ_COLORS, CASH_COLOR } from '$lib/chartPalettes'` → stacked bar colors for VA-04/VA-05
- `import { ITEM_COLORS, OTHER_COLOR } from '$lib/chartPalettes'` → pie/bar colors for VA-08
- `import { LTV_BINS, binCustomerRevenue } from '$lib/ltvBins'` → histogram x-axis for VA-07
- `import { rollupTopNWithOther } from '$lib/itemCountsRollup'` → top-N compression for VA-08
- `import { cohortRevenueSum, cohortAvgLtv } from '$lib/cohortAgg'` → grain-aware GROUP BY for VA-09/VA-10
- `import { visitSeqBucket, aggregateByBucketAndVisitSeq, shapeForChart } from '$lib/dashboardStore.svelte'` → VA-04/VA-05 stacked-bar data pipeline
- `card='calendar-revenue' | 'calendar-counts' | 'calendar-items' | 'cohort-revenue' | 'cohort-avg-ltv' | 'ltv-histogram'` → EmptyState.svelte prop values

**Blockers:** None.

## Self-Check

Files created:
- FOUND: src/lib/chartPalettes.ts
- FOUND: src/lib/ltvBins.ts
- FOUND: src/lib/itemCountsRollup.ts
- FOUND: src/lib/cohortAgg.ts

Files modified:
- FOUND: src/lib/dashboardStore.svelte.ts (extended — 289 L)
- FOUND: src/lib/emptyStates.ts (extended — 18 L)

Commits:
- FOUND: 74af266 (Task 1)
- FOUND: cd6bd45 (Task 2)

Test flips:
- chartPalettes.test.ts: 4/4 GREEN
- ltvHistogram.test.ts: 9/9 GREEN
- itemCountsRollup.test.ts: 4/4 GREEN
- cohortAgg.test.ts: 5/5 GREEN
- dashboardStoreVisitSeq.test.ts: 13/13 GREEN
- Full unit suite: 129 passed / 2 todo / 1 skipped
- `npm run build`: 0
- `npm run test:guards`: clean

## Self-Check: PASSED

---
*Phase: 10-charts*
*Completed: 2026-04-17*
