# Phase 10 — Deferred Items

Out-of-scope discoveries during parallel wave execution. NOT owned by the current plan; tracked here for visibility.

## Open (deferred out-of-scope for Plan 10-08)

- **tests/e2e/charts-all.spec.ts `tap-reveal tooltip on VA-04` selector mismatch**
  - Discovered during: Plan 10-08 E2E integration run (2026-04-17)
  - Symptom: `page.getByTestId('calendar-revenue-card').locator('svg rect').first()` resolves to LayerChart 2.x's `lc-rect lc-clip-path-rect` (an invisible clip-path rect), NOT a data bar. `.tap()` waits forever because clip-path rects have no visible area.
  - Scope: Out-of-scope for 10-08 (only 1/12 charts-all tests failing; 11 pass. Selector is a RED-scaffold artifact from Plan 10-01 that assumed LayerChart 1.x DOM).
  - Proposed fix (future micro-plan): change selector to `svg rect.lc-bar-rect` or `[role="graphics-symbol"]`.
  - All other Plan 10-08 E2E acceptance criteria pass: card order matches D-10, no horizontal scroll at 375px, no console errors, no chart overflows.

## Resolved

- **tests/unit/CalendarCards.test.ts fails to resolve CalendarRevenueCard.svelte / CalendarCountsCard.svelte** — RESOLVED by Plan 10-05 (2026-04-17)
  - Discovered during: Plan 10-07 execution (2026-04-17)
  - Cause: Plan 10-05 (Wave 4, parallel) creates these component files. Test file authored by Plan 10-01 RED scaffold assumes them present.
  - Scope: Out-of-scope for 10-07 (we only own VA-06/09/10 cohort components).
  - Resolution: Plan 10-05 landed VisitSeqLegend + CalendarRevenueCard + CalendarCountsCard. Unit suite now 157/157 pass.
