---
phase: 19
plan: "01"
subsystem: frontend
tags: [performance, lazy-loading, dynamic-import, svelte5, mobile]
dependency_graph:
  requires: []
  provides: [lazy-mount-loader-prop]
  affects: [src/lib/components/LazyMount.svelte, src/routes/+page.svelte]
tech_stack:
  added: []
  patterns: [dynamic-import-on-scroll, intersection-observer-deferred-module-download]
key_files:
  created:
    - tests/unit/lazy-mount-loader.test.ts
  modified:
    - src/lib/components/LazyMount.svelte
    - src/routes/+page.svelte
decisions:
  - Use Component<any> for loader return type to avoid strict Svelte generic mismatch
  - Use {@const DynComp = Loaded} pattern instead of deprecated <svelte:component this={...}> (Svelte 5 runes mode)
  - Convert all snippet-form LazyMounts to loader form (9 total — CampaignUpliftCard, DailyHeatmapCard, CalendarCountsCard, CalendarRevenueCard, CalendarItemsCard, CalendarItemRevenueCard, CohortRetentionCard, RepeaterCohortCountCard, MdeCurveCard)
metrics:
  duration: "~10 minutes"
  completed: "2026-05-07"
  tasks_completed: 3
  files_changed: 3
---

# Phase 19 Plan 01: LazyMount loader prop + 5-card defer Summary

**One-liner:** Dynamic-import deferral via new `loader` prop on `LazyMount` eliminates all 9 eager chart-card imports from the initial JS bundle — modules (including LayerChart + d3 transitive deps) only download when the card scrolls into view.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Extend LazyMount.svelte with loader + props props | 4ba351b |
| 2 | Defer 5 eager chart cards + convert 4 existing snippet-LazyMounts | 6cb26d7 |
| 3 | Add LazyMount loader prop smoke test | 31bb070 |

## What Was Built

### LazyMount.svelte changes

- Added `loader?: () => Promise<{ default: Component<any> }>` prop
- Added `props?: Record<string, unknown>` prop (passed through to dynamic component)
- `children` prop made optional (was `Snippet`, now `Snippet | undefined`)
- Added `Loaded = $state<Component<any> | null>(null)` for dynamic import resolution
- `$effect` now calls `loader().then((m) => (Loaded = m.default))` on intersection
- SSR/no-IntersectionObserver fallback also triggers `loader()` immediately
- Three-branch render: `!mounted` skeleton → loader branch (Loaded or skeleton) → children branch
- Updated header comment with two-usage-pattern documentation

### +page.svelte changes

- **Removed static imports:** `CalendarRevenueCard`, `CalendarCountsCard`, `CalendarItemsCard`, `CalendarItemRevenueCard`, `MdeCurveCard` (5 imports)
- **Removed static imports (via snippet conversion):** `CohortRetentionCard`, `DailyHeatmapCard`, `RepeaterCohortCountCard`, `CampaignUpliftCard` (4 more)
- All 9 chart cards now loaded via `<LazyMount loader={() => import(...)} />`
- All existing `onvisible` callbacks and `props` data bindings preserved

## Acceptance Criteria

- [x] `npm run check` passes (9 pre-existing errors in unrelated files; 0 new errors from this plan)
- [x] `npm run test:unit` passes for new test (pre-existing `sparseFilter.test.ts` failures out-of-scope)
- [x] Static imports for 5 chart cards removed from `+page.svelte`
- [x] All 5 new cards mounted via `<LazyMount loader={...} />`
- [x] All existing snippet-form LazyMounts converted to loader form
- [x] `LazyMount.svelte` has the `loader` and `props` props

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript generic mismatch on loader prop**
- **Found during:** Task 2 (`npm run check` after page.svelte edits)
- **Issue:** `loader` typed as `() => Promise<{ default: Component }>` (where `Component` = `Component<{}, {}, string>`) conflicted with actual Svelte components whose `$$ComponentProps` include required props (e.g., `data`, `dataWeekly`, etc.)
- **Fix:** Widened type to `Component<any>` with eslint-disable comment
- **Files modified:** `src/lib/components/LazyMount.svelte`
- **Commit:** 6cb26d7

**2. [Rule 1 - Bug] Deprecated `<svelte:component>` in Svelte 5 runes mode**
- **Found during:** Task 2 (`npm run check` warning)
- **Issue:** `<svelte:component this={Loaded}>` is deprecated in Svelte 5 runes mode — components are dynamic by default
- **Fix:** Replaced with `{@const DynComp = Loaded}<DynComp {...props} />` pattern
- **Files modified:** `src/lib/components/LazyMount.svelte`
- **Commit:** 6cb26d7

## Known Stubs

None — all 9 cards receive the same data/props they had before conversion.

## Deferred Items

- `tests/unit/sparseFilter.test.ts` has 2 pre-existing failures (`MAX_COHORT_LINES` constant mismatch — test expects 12, actual is 100). Not caused by this plan. Logged for future triage.

## Self-Check: PASSED

- `src/lib/components/LazyMount.svelte` — FOUND
- `src/routes/+page.svelte` — FOUND (modified)
- `tests/unit/lazy-mount-loader.test.ts` — FOUND
- Commit 4ba351b — FOUND
- Commit 6cb26d7 — FOUND
- Commit 31bb070 — FOUND
