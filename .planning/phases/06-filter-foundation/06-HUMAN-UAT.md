---
status: blocked
phase: 06-filter-foundation
source: [06-05-PLAN.md, 06-04-SUMMARY.md]
started: 2026-04-15T19:30:00Z
updated: 2026-04-15T19:30:00Z
blocker: "CF Pages auto-deploy broken since commit a3623b9 (~5h stale); 27 commits including all Phase 6 code not yet live on https://ramen-bones-analytics.pages.dev — Phase 6 code is green locally (unit 65/65, e2e 11 pass, build succeeds) but cannot be visually UATed at 375px until the deploy pipeline is fixed."
---

## Current Test

[blocked on DEV deploy pipeline — see blocker in frontmatter]

## Tests

### FLT-01: Date picker preset path
- expected: Tap two-line date picker button on sticky bar → popover opens; tap `30d` → popover closes, URL contains `range=30d`, KPI tiles re-render with 30d numbers, button line 1 reads `30d`, line 2 shows last-30-days date range.
- result: [pending — blocked on DEV deploy]

### FLT-01: Date picker custom range path
- expected: Tap button → popover opens; pick `From`/`To` (first day of current month → today); tap `Apply range` → URL contains `range=custom&from=...&to=...`, button line 1 reads `Custom`, KPI tiles reflect custom window.
- result: [pending — blocked on DEV deploy]

### FLT-02: Grain toggle
- expected: Tap day / week / month on sticky bar; URL updates with `grain=<value>` on each tap; cohort/LTV charts re-render (or stay identical if weekly-only — acceptable).
- result: [pending — blocked on DEV deploy]

### FLT-03 + FLT-04: Sheet flow
- expected: Tap `Filters` → bottom sheet slides up; sales_type dropdown renders with ≥1 option, select `INHOUSE` only; payment_method dropdown renders with ≥1 option, select one method; tap `Apply filters` → sheet closes, URL contains `sales_type=INHOUSE&payment_method=<method>`, chip-scoped KPI tiles (txCount, avgTicket, chip-window revenue) change, fixed tiles (revenueToday / 7d / 30d) DO NOT change.
- result: [pending — blocked on DEV deploy]

### D-18: Draft-and-apply dismissal discards changes
- expected: Reopen `Filters` sheet, tick a different option, tap backdrop to dismiss; reopen sheet → original selection restored (draft discarded).
- result: [pending — blocked on DEV deploy]

### Reset all
- expected: Inside sheet, tap `Reset all filters` → sheet closes, URL becomes `?range=7d&grain=week`, all filter tints cleared.
- result: [pending — blocked on DEV deploy]

### D-04: Active-state tint
- expected: Non-default filter applied → control shows subtle primary-color tinted border/background; at defaults → no tint.
- result: [pending — blocked on DEV deploy]

### D-05: Sticky bar height at 375px (FLAGGED from 06-04-SUMMARY)
- expected: Sticky filter bar stays pinned, does NOT exceed ~72px vertical space at 375px viewport. Known risk per 06-04-SUMMARY "375px Sticky Bar Measurement": three controls (date picker ~120px + grain toggle ~170px + Filters ~80px ≈ 370px) likely wrap Filters to line 2, pushing effective height to ~116px. Visual verification required; if confirmed exceeding 72px → follow-up polish plan (icon-only Filters, abbreviated grain labels, or FAB Filters).
- result: [pending — blocked on DEV deploy]

### D-13: Empty-dropdown guard
- expected: If DEV data has only one sales_type value, sheet still renders sensibly. If one distinct array is empty server-side, that dropdown row is hidden entirely. (Non-applicable if both populated — note in approval.)
- result: [pending — blocked on DEV deploy]

### D-17: URL robustness (zod coerce-not-redirect)
- expected: Navigate to `<deploy>/?range=bogus&grain=huh` → page renders normally with defaults (range=7d in memory; URL may keep `bogus`).
- result: [pending — blocked on DEV deploy]

### Back/forward navigation
- expected: Apply filter → tap browser back → prior filter state restored.
- result: [pending — blocked on DEV deploy]

### Console error check
- expected: Chrome DevTools console has no `[transactions_filterable_v]` / `[distinctSalesTypes]` / `[distinctPaymentMethods]` error logs.
- result: [pending — blocked on DEV deploy]

## Summary

total: 12
passed: 0
issues: 0
pending: 0
skipped: 0
blocked: 12

## Gaps

- **Deploy pipeline blocker:** CF Pages last successful deploy is commit `a3623b9`, 27 commits stale. All Phase 6 code (06-01 through 06-04) is committed on `main` but not live on https://ramen-bones-analytics.pages.dev. Visual 375px UAT cannot run until the deploy pipeline is unblocked.
- **Once deploy is fixed:** Run through the 12 tests above on a real 375px viewport (or Chrome DevTools iPhone SE emulation). Any failures feed into a gap-closure plan via `/gsd:plan-phase 06 --gaps`.
- **Known polish risk (from 06-04-SUMMARY D-05 measurement):** Sticky bar likely exceeds the 72px budget at 375px when the Filters button is present (estimated ~116px). If visual UAT confirms, track a layout polish follow-up.
