---
phase: 19
plan: "02"
subsystem: dashboard-ssr
tags: [performance, deferred-fetch, cold-start, api-routes]
dependency_graph:
  requires: [19-01]
  provides: [api/item-counts, api/benchmark]
  affects: [src/routes/+page.server.ts, src/routes/+page.svelte]
tech_stack:
  added: []
  patterns: [LazyMount deferred fetch, clientFetch with window params]
key_files:
  created:
    - src/routes/api/item-counts/+server.ts
    - src/routes/api/benchmark/+server.ts
  modified:
    - src/routes/+page.server.ts
    - src/routes/+page.svelte
decisions:
  - "loadItemCounts() reads storeWindow (getWindow()) for from/to — matches active chip without SSR round-trip"
  - "Both CalendarItemsCard and CalendarItemRevenueCard share the same loadItemCounts() onvisible handler — single fetch, two consumers"
  - "loadBenchmark() fires alongside loadRetention() in CohortRetentionCard's onvisible — one scroll event triggers both deferred fetches"
  - "Pre-existing svelte-check errors (env vars, hooks types) are unrelated to plan scope and left untouched"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-07T12:09:05Z"
  tasks_completed: 4
  tasks_total: 4
  files_created: 2
  files_modified: 2
---

# Phase 19 Plan 02: Defer /api/item-counts + /api/benchmark; SSR Promise.all 6 → 4

**One-liner:** Move `itemCountsP` + `benchmarkAnchorsP/SourcesP` off SSR into `/api/item-counts` and `/api/benchmark` deferred endpoints, shrinking `Promise.all` from 6 to 4 promises and cutting SSR subrequest count from 8 to 6.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Read current files (context only) | — |
| 2 | Create `/api/item-counts/+server.ts` | 08031b1 |
| 3 | Create `/api/benchmark/+server.ts` | fb98e32 |
| 4 | Strip 3 queries from `+page.server.ts` (Promise.all 6→4) | 565ade0 |
| 5 | Wire deferred fetches in `+page.svelte` | 5d2123d |

## What Changed

**New endpoints:**
- `src/routes/api/item-counts/+server.ts` — accepts `?from=&to=`, auth-gated, returns window-scoped `item_counts_daily_v` rows
- `src/routes/api/benchmark/+server.ts` — no date params, returns `{ anchors, sources }` from `benchmark_curve_v` + `benchmark_sources_v`

**`+page.server.ts`:**
- Removed `ItemCountRow` type, `itemCountsP` fetchAll, `BenchmarkAnchorRow` type, `BenchmarkSourceRow` type, `benchmarkAnchorsP` fetchAll, `benchmarkSourcesP` fetchAll
- `Promise.all` destructuring reduced from 6 to 4 promises
- `itemCounts`, `benchmarkAnchors`, `benchmarkSources` removed from return object
- E2E fixture bypass cleaned of unused `E2E_ITEM_COUNTS_ROWS` import
- Dev-only `[ssr-perf]` log updated to `promises = 4`

**`+page.svelte`:**
- Added `ItemCountRow`, `BenchmarkAnchorRow`, `BenchmarkSourceRow` type declarations
- Added `itemCounts`, `benchmarkAnchors`, `benchmarkSources` `$state` variables (start empty `[]`)
- Added `loadItemCounts()` — fetches `/api/item-counts?from=${w.from}&to=${w.to}` using `getWindow()`
- Added `loadBenchmark()` — fetches `/api/benchmark` (lifetime data, no params)
- `CalendarItemsCard` and `CalendarItemRevenueCard` wrapped in `<LazyMount>` with `onvisible={loadItemCounts}`
- `CohortRetentionCard` LazyMount `onvisible` updated to `() => { loadRetention(); loadBenchmark(); }`
- `benchmarkAnchors` and `benchmarkSources` props now read from local `$state` (not `data.*`)

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

**Note on CalendarItemsCard/CalendarItemRevenueCard:** The plan context stated wave 1 had already wrapped these in LazyMount, but the actual file had them as direct mounts. Step 5 correctly added the LazyMount wrappers as the plan instructed (the plan says "Add `onvisible={loadItemCounts}`" to these cards). This is consistent with the plan's intent.

## Acceptance Criteria

- [x] `npm run check` passes — 9 pre-existing errors, 0 new errors from this plan
- [x] `src/routes/api/item-counts/+server.ts` exists
- [x] `src/routes/api/benchmark/+server.ts` exists
- [x] No `data.itemCounts` / `data.benchmarkAnchors` / `data.benchmarkSources` in `+page.svelte`
- [x] `Promise.all` in `+page.server.ts` has 4 promises (not 6)

## Known Stubs

None. `itemCounts`, `benchmarkAnchors`, `benchmarkSources` initialize to `[]` (empty arrays) which is the correct initial state — components render empty/loading state until the LazyMount `onvisible` callback fires.

## Threat Flags

None. New endpoints follow the established auth pattern (`safeGetSession()` + `private, no-store` cache headers). No new network surfaces beyond the existing `/api/*` pattern.

## Self-Check: PASSED

- `src/routes/api/item-counts/+server.ts` — FOUND
- `src/routes/api/benchmark/+server.ts` — FOUND
- Commits 08031b1, fb98e32, 565ade0, 5d2123d — FOUND in git log
- No `data.itemCounts` / `data.benchmarkAnchors` / `data.benchmarkSources` in `+page.svelte` — CONFIRMED
- `Promise.all` array has 3 items (dailyRowsP, priorDailyRowsP, insightP) — CONFIRMED
