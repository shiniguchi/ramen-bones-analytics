---
phase: 10-charts
plan: 05
subsystem: ui
tags: [charts, layerchart, bar-chart, visit-attribution, svelte-5, stacked-bars, mobile-first]

# Dependency graph
requires:
  - phase: 10-02
    provides: transactions_filterable_v with visit_seq + card_hash columns
  - phase: 10-04
    provides: chartPalettes (VISIT_SEQ_COLORS, CASH_COLOR), dashboardStore visit_seq accessors (aggregateByBucketAndVisitSeq, shapeForChart), emptyStates 'calendar-revenue'/'calendar-counts' entries
provides:
  - VisitSeqLegend.svelte — shared 8-swatch horizontal gradient + optional Cash swatch (D-08)
  - CalendarRevenueCard.svelte — VA-04 stacked bars of gross revenue by visit_seq bucket
  - CalendarCountsCard.svelte — VA-05 stacked bars of tx_count by visit_seq bucket
  - Dynamic series list pattern — is_cash filter collapses 9→8 or 9→1 series reactively
affects: [10-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LayerChart 2.x high-level <BarChart> with seriesLayout='stack' for stacked bars (avoid hand-rolled <Rect>/<Bars>)"
    - "Chart cards self-subscribe to dashboardStore via getter calls inside $derived.by() — no prop-drilling of data/grain/filters"
    - "Shared legend component with showCash prop toggled by cards based on filter state"
    - "Static source-artifact assertions in unit tests as JSDOM-safe fallback for non-renderable LayerChart paths"

key-files:
  created:
    - src/lib/components/VisitSeqLegend.svelte
    - src/lib/components/CalendarRevenueCard.svelte
    - src/lib/components/CalendarCountsCard.svelte
    - tests/unit/VisitSeqLegend.test.ts
    - tests/unit/CalendarCards.test.ts
  modified:
    - .planning/phases/10-charts/deferred-items.md (marked Plan 10-07 entry as resolved)

key-decisions:
  - "JSDOM cannot render LayerChart BarChart fully (matchMedia mocked but IntersectionObserver/ResizeObserver/getBoundingClientRect are also needed). Unit tests assert empty-state branch + static source-artifact regex to catch regressions on load-bearing props; full visual rendering lives in the e2e suite."
  - "VISIT_KEYS ordering (1st..8x+ then optional cash last) is deliberate per D-06 — LayerChart stacks series in array order, so light colors sit at the bottom and darkest (8x+) at the top."
  - "CASS swatch color assertion uses computed style 'rgb(161, 161, 170)' not raw hex — JSDOM normalizes inline hex to rgb on set. Palette constant still asserted separately in the same test to catch regression in either layer."
  - "bandPadding=0.2 (tighter than LayerChart default 0.4) picked for 375px mobile viewport so 12-week bars don't vanish into gaps."

patterns-established:
  - "Cards read dashboardStore via getFiltered()/getFilters() inside $derived.by() — mirrors KpiTile pattern, zero props required from +page.svelte."
  - "Dynamic series array via $derived.by() on is_cash filter — declarative 9/8/1 series split without imperative DOM mutation."

requirements-completed: [VA-04, VA-05]

# Metrics
duration: 6min
completed: 2026-04-17
---

# Phase 10 Plan 05: Calendar Revenue + Counts Cards Summary

**VA-04/VA-05 shipped — LayerChart 2.x stacked BarChart with 9 segments (8 visit_seq shades + cash), self-subscribing to dashboardStore, with shared gradient legend**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-17T09:41:30Z
- **Completed:** 2026-04-17T09:47:30Z
- **Tasks:** 2 (both TDD, 4 commits total)
- **Files created:** 3 components + 2 test files
- **Files modified:** 1 (deferred-items.md resolution)

## Accomplishments

- Shipped the two highest-signal cards on the dashboard per D-10 ordering — "how much revenue came from 3rd-timers on Tuesday" is now renderable.
- Unit suite expanded from 129 to 157 tests (+28) across Phase 10 Wave 4. All green.
- Resolved Plan 10-07's deferred-items.md entry (CalendarCards.test.ts resolve failure).
- Build green, CI guards green, no migrations touched.

## Task Commits

Each task followed TDD (test → feat):

1. **Task 1 RED: VisitSeqLegend failing test** — `8e331fc` (test)
2. **Task 1 GREEN: VisitSeqLegend impl** — `d5a411a` (feat)
3. **Task 2 RED: CalendarRevenueCard + CalendarCountsCard failing tests** — `213e5b2` (test)
4. **Task 2 GREEN: Both cards impl + deferred-items resolution** — `2103351` (feat)

**Plan metadata:** (pending — see final commit below)

## Files Created/Modified

- `src/lib/components/VisitSeqLegend.svelte` (24 lines) — shared horizontal gradient legend with showCash toggle
- `src/lib/components/CalendarRevenueCard.svelte` (64 lines) — VA-04 stacked revenue bars
- `src/lib/components/CalendarCountsCard.svelte` (57 lines) — VA-05 stacked tx_count bars
- `tests/unit/VisitSeqLegend.test.ts` (43 lines) — 4 render tests for legend
- `tests/unit/CalendarCards.test.ts` (134 lines) — empty-state renders + static source-artifact regex assertions
- `.planning/phases/10-charts/deferred-items.md` — moved Plan 10-07 entry from "Open" to "Resolved"

## Decisions Made

- **Test strategy for LayerChart cards:** JSDOM render path covered only the empty-state branch; static source-artifact regex assertions cover the render-only props (series, seriesLayout, metric). Full visual rendering lives in tests/e2e/charts-all.spec.ts.
- **JSDOM hex normalization:** inline `style:background-color="#a1a1aa"` serializes to `rgb(161, 161, 170)`. The test asserts computed style for the DOM contract and the palette constant separately so a regression in either layer shows up.
- **Self-subscribing cards:** both cards read from dashboardStore getters inside `$derived.by()`. Matches the KpiTile pattern (no props passed from +page.svelte) — simplifies Plan 10-08 dashboard wiring to `<CalendarRevenueCard />` with no props.

## Deviations from Plan

**None — plan executed exactly as written.**

One pre-existing deferred item (Plan 10-07's CalendarCards.test.ts resolve failure, which predicted our own file by path) was automatically resolved by this plan's Task 2 RED→GREEN. I moved its entry in deferred-items.md from "Open" to "Resolved" — not a deviation from my plan, but housekeeping for the phase.

## Issues Encountered

- **JSDOM hex→rgb normalization:** initial test asserted raw `#a1a1aa` on `style` attribute; failed because JSDOM normalizes to `rgb(161, 161, 170)`. Fix: assert computed `style.backgroundColor` string + assert palette constant separately in the same test. 1-line change, caught on first test run after the RED commit.

## User Setup Required

None.

## Next Phase Readiness

**Ready for Plan 10-08 (Dashboard Integration):**
- `<CalendarRevenueCard />` and `<CalendarCountsCard />` can be dropped into `+page.svelte` with no props — they self-subscribe to the dashboardStore.
- VisitSeqLegend is internal to the cards; no separate wiring needed.
- E2E fixture tests in `tests/e2e/charts-all.spec.ts` already reference the `data-testid` values (`calendar-revenue-card`, `calendar-counts-card`) — flip from skip to assert after 10-08 lands the dashboard wiring.

**No blockers.** Wave 4 parallel agents (10-06/10-07) already landed; 10-08 can proceed.

## Self-Check: PASSED

Verified post-commit:
- `src/lib/components/VisitSeqLegend.svelte` exists (24 lines)
- `src/lib/components/CalendarRevenueCard.svelte` exists (64 lines)
- `src/lib/components/CalendarCountsCard.svelte` exists (57 lines)
- Commits `8e331fc`, `d5a411a`, `213e5b2`, `2103351` all present in git log
- `npm run test:unit` → 157/157 pass (was 129 pre-plan)
- `npm run build` → exit 0
- `bash scripts/ci-guards.sh` → all guards pass

---
*Phase: 10-charts*
*Plan: 05*
*Completed: 2026-04-17*
