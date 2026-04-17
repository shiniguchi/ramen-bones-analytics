# Phase 10 — Deferred Items

Out-of-scope discoveries during parallel wave execution. NOT owned by the current plan; tracked here for visibility.

## Resolved

- **tests/unit/CalendarCards.test.ts fails to resolve CalendarRevenueCard.svelte / CalendarCountsCard.svelte** — RESOLVED by Plan 10-05 (2026-04-17)
  - Discovered during: Plan 10-07 execution (2026-04-17)
  - Cause: Plan 10-05 (Wave 4, parallel) creates these component files. Test file authored by Plan 10-01 RED scaffold assumes them present.
  - Scope: Out-of-scope for 10-07 (we only own VA-06/09/10 cohort components).
  - Resolution: Plan 10-05 landed VisitSeqLegend + CalendarRevenueCard + CalendarCountsCard. Unit suite now 157/157 pass.
