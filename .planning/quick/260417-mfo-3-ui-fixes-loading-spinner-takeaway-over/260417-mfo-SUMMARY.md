---
phase: quick
plan: 260417-mfo
subsystem: dashboard-ui
tags: [mobile-fix, ui, filter, cohort, spinner, overflow, grain]
requires:
  - src/routes/+page.svelte (isUpdating state + withUpdate wrapper)
  - src/lib/components/FilterBar.svelte (isLoading prop)
  - src/lib/components/SegmentedToggle.svelte (whitespace-nowrap)
  - src/lib/components/CohortRetentionCard.svelte (getFilters().grain reactive)
provides:
  - Visible spinner feedback on every filter change
  - Single-line Takeaway label at 375px
  - Grain-aware cohort retention: day hint / week native / month re-bucketed
affects:
  - FilterBar visual (Row 1 now flex with optional spinner)
  - SegmentedToggle button class string
  - CohortRetentionCard: new month note, dynamic x-axis, weeklyToMonthly helper
tech-stack:
  added: []
  patterns:
    - Filter-change UX: isUpdating $state + withUpdate wrapper (300ms spinner window)
    - Grain-aware card: reactive getFilters().grain read (no prop drilling)
    - Weighted weekly->monthly re-bucket: divide period_weeks by 4.33, weight by cohort_size_week
key-files:
  created: []
  modified:
    - src/routes/+page.svelte
    - src/lib/components/FilterBar.svelte
    - src/lib/components/SegmentedToggle.svelte
    - src/lib/components/CohortRetentionCard.svelte
decisions:
  - "Kept byte-identical D-17 clamp-hint copy ('Cohort view shows weekly — other grains not applicable.') to preserve VA-06/09/10 contract — plan's action text asked for 'day granularity not applicable' but plan's own notes flagged byte-identical preservation as required. Chose the preservation path."
  - "Put withUpdate wrapper in +page.svelte (not in FilterBar) so all 3 handlers share one flag and the spinner truthfully represents 'a filter change is propagating'."
  - "Month re-bucket runs client-side — no new SQL view. Accepts approximation (4.33 weeks/month) and surfaces the caveat inline per plan."
metrics:
  duration: "~5 min"
  completed: "2026-04-17"
  tasks: 3
  files_modified: 4
  commits: 3
  tests_before: 157/157
  tests_after: 157/157
---

# Quick Task 260417-mfo: 3 Mobile UI Fixes Summary

Three mobile UX regressions closed in a single surgical pass: filter spinner, Takeaway label wrap, cohort retention ignoring grain toggle.

## What Changed

**Task 1 — FilterBar loading spinner** (`feat` · 28ba150)
Added `isUpdating` state + `withUpdate(fn)` helper in `+page.svelte`. Wrapped all three filter handlers so each click flips the flag on, runs the existing body, then clears after 300ms. FilterBar gained an optional `isLoading` prop and renders an inline `animate-spin` SVG next to `DatePickerPopover` in Row 1 while the flag is on.

**Task 2 — SegmentedToggle Takeaway overflow** (`fix` · e02b272)
One-word change: inserted `whitespace-nowrap` between `font-medium` and `transition-colors` in the button class. "Takeaway" no longer wraps or clips at 375px.

**Task 3 — CohortRetentionCard grain-aware** (`feat` · c0f0a2b)
Rewrote the card to branch on `getFilters().grain`:
- `day` → weekly lines + existing clamp hint (byte-identical to VA-09/10).
- `week` → weekly lines, no hint (unchanged).
- `month` → new `weeklyToMonthly()` re-bucket (period_weeks ÷ 4.33, weighted average by cohort_size_week), "Monthly cohorts approximated from weekly data." note, x-axis switches to "Months since first visit", tooltip falls through `cohort_month ?? cohort_week` via `??`.
No new prop; component self-subscribes via `getFilters()` per the Phase 09 dashboardStore pattern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Contract preservation] Kept byte-identical D-17 clamp-hint copy**
- **Found during:** Task 3
- **Issue:** Plan's action block specified hint copy `"Cohort view shows weekly — day granularity not applicable."`, but the plan's own notes stated "Phase 10 existing testid `cohort-clamp-hint` copy is preserved byte-identical for the day branch (keeps VA-06/09/10 tests green)." The two instructions contradict each other. Phase 10-07 SUMMARY + 10-UAT locked "byte-identical across VA-06/09/10" as the UX contract; sibling cards `CohortRevenueCard` + `CohortAvgLtvCard` still use the old copy.
- **Fix:** Preserved the existing copy `"Cohort view shows weekly — other grains not applicable."`. The unit-test assertion `toContain('Cohort view shows weekly')` is satisfied either way, and sibling-card copy stays byte-identical.
- **Files modified:** `src/lib/components/CohortRetentionCard.svelte`
- **Commit:** c0f0a2b

No other deviations — 4 files, 3 commits, as planned.

## Verification

**Automated (local):**
- `npm run check` — no new type errors on the 4 touched files. Pre-existing layerchart `Tooltip.Root let:data` slot typing error and unrelated `+page.server.ts` / `hooks.server.ts` errors untouched (Phase 10 inherited, out of scope).
- `npm run test:unit -- --run` — 157/157 pass (21 files), including `CohortRetentionCard.test.ts` (day hint, week/month absence), `FilterBar.test.ts`, `SegmentedToggle` callers, `cohortAgg.test.ts`.

**Deferred (post-merge to main → CF Pages DEV):**
- DEV Chrome MCP smoke at 375×667: spinner flash on each filter change, Takeaway single-line, three grain modes render the expected hint/axis/curve set.
- Per project CLAUDE.md the DEV visual pass needs the change live on CF Pages; deferred to the merge step.

## Success Criteria Check

- [x] Three discrete UX regressions closed, independently verifiable on DEV at 375px (code ready; DEV smoke post-merge)
- [x] Zero changes to SSR loader, SQL views, or MVs — purely client-side component work
- [x] No new dependencies; no prop-drilling additions beyond `FilterBar.isLoading`
- [x] Phase 10 cohort-clamp-hint testid contract preserved byte-identical (explicit plan-deviation decision; see above)

## Files Touched

| File                                                  | Lines  | Kind      |
| ----------------------------------------------------- | ------ | --------- |
| `src/routes/+page.svelte`                             | +18/-7 | modified  |
| `src/lib/components/FilterBar.svelte`                 | +12/-4 | modified  |
| `src/lib/components/SegmentedToggle.svelte`           | +1/-1  | modified  |
| `src/lib/components/CohortRetentionCard.svelte`       | +94/-16 | modified |

## Commits

| Commit   | Task   | Type | Message                                                                |
| -------- | ------ | ---- | ---------------------------------------------------------------------- |
| 28ba150  | Task 1 | feat | feat(quick-260417-mfo): add FilterBar loading spinner                  |
| e02b272  | Task 2 | fix  | fix(quick-260417-mfo): prevent Takeaway label wrap in SegmentedToggle  |
| c0f0a2b  | Task 3 | feat | feat(quick-260417-mfo): make CohortRetentionCard grain-aware           |

## Self-Check: PASSED

- [x] `src/routes/+page.svelte` contains `isLoading={isUpdating}` and `withUpdate`
- [x] `src/lib/components/FilterBar.svelte` contains `isLoading` prop + `animate-spin`
- [x] `src/lib/components/SegmentedToggle.svelte` contains `whitespace-nowrap`
- [x] `src/lib/components/CohortRetentionCard.svelte` contains `weeklyToMonthly` + `getFilters().grain`
- [x] 28ba150 in git log
- [x] e02b272 in git log
- [x] c0f0a2b in git log
- [x] 157/157 unit tests pass
