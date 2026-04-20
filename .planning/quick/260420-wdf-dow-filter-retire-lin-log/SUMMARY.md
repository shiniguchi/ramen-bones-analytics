---
task: 260420-wdf
title: Day-of-week filter + retire Lin/Log toggle
status: complete
completed: 2026-04-20
commits:
  - 03db100
  - 1c9cf3a
---

# 260420-wdf — Day-of-week filter + retire Lin/Log toggle

## What shipped

Client-side day-of-week filter (Mon=1..Sun=7) applied to KPI tiles + non-cohort charts. Retired the Lin/Log interpolation toggle (hardcoded log-linear everywhere). Pure client-side, zero SQL.

### Task 1 — schema + store + URL + FilterBar (03db100)

- `src/lib/filters.ts`: dropped `interp` / `INTERP_VALUES`; added `DAY_VALUES`, `DAYS_DEFAULT`, and a `days` zod field that parses CSV → sorted unique `number[]` in 1..7 with `.default('1,2,3,4,5,6,7')`. Unknown `interp=` query params silently stripped by zod (backward compat).
- `src/lib/dashboardStore.svelte.ts`: added `daysFilter` state + `setDaysFilter` action. `filterRows` now takes a `days: number[]` final arg; skips `parseISO` work when all 7 days are selected (perf). `setInterp` removed. `initStore` accepts an optional `daysFilter` seed.
- `src/routes/+page.svelte`: `handleDaysChange` wires `setDaysFilter` + `replaceState(mergeSearchParams({days: allDays ? null : v.join(',')}))`. Passes `days` + `onDaysChange` to `<FilterBar>`.
- `src/lib/components/FilterBar.svelte`: new Days popover on row 2 (after Cash/Card). Compact trigger label (`All days` / `Mon–Fri` / `Sat–Sun` / `Wed only` / `N days`). Popover contains 7 `<Checkbox>` rows (44 px tap targets) + 3 preset buttons (`All`, `Weekdays`, `Weekends`).
- Tests:
  - `tests/unit/dashboardStore.test.ts`: extended fixture with `visit_seq` + `card_hash` (closes pre-existing type-error), swapped `interp: 'log-linear'` → `days: [1..7]` in 4 fixture locations, added 4 DOW tests (`excludeMon`, `weekendOnly`, `emptyDays`, `allDays`).
  - `tests/unit/urlState.test.ts`: round-trip test for `days` CSV set + null-delete.
  - `tests/unit/FilterBar.test.ts`: refreshed `baseFilters` fixture (dropped `interp`, added `days`); added smoke test that opens the Days popover and asserts Mon..Sun + the `Weekdays` preset button render.

### Task 2 — UI adoption + retire toggle (1c9cf3a)

- `DailyHeatmapCard.svelte`: subscribes to `getFilters().days`; derives `excluded` Set; sets `opacity={0.2}` on cells whose DOW is excluded. Visual-only — underlying revenue unchanged.
- `CohortRetentionCard.svelte`: removed `InterpolationToggle` import + header control; hardcoded `interpolateBenchmark(anchors, 'log-linear', 'month')`; dropped dynamic `{interp}` in disclaimer copy; added amber caveat `data-testid="cohort-day-filter-caveat"` below header when `days.length !== 7`.
- `RepeaterCohortCountCard.svelte`: added matching amber caveat `data-testid="repeater-day-filter-caveat"` below the clamp-hint slot, same copy as retention.
- Deleted `src/lib/components/InterpolationToggle.svelte` via `git rm`.

## Verification

### Unit tests (scoped)

```
npx vitest run tests/unit/filters.test.ts tests/unit/FilterBar.test.ts \
               tests/unit/dashboardStore.test.ts tests/unit/urlState.test.ts
```

Result: 4 files, 59 / 59 passed.

### Full unit suite

`npx vitest run tests/unit/` → 215 passed / 8 pre-existing failures. Zero new regressions. The 8 failures (`CalendarCards.test.ts`, `CohortRetentionCard.test.ts 'Cohort view shows weekly'` copy mismatch, `pageServerLoader.test.ts kpi_daily_v`, `sparseFilter.test.ts MAX_COHORT_LINES`) pre-date the branch and are unrelated to this task's scope.

### Type-check

`npm run check` → 8 errors, all pre-existing in `vite.config.ts` + `src/hooks.server.ts` (missing `PUBLIC_SUPABASE_*` env exports; worktree has no `.env`). Baseline had the same 8 plus 10 self-healing `visit_seq/card_hash` fixture errors this task fixed as a side-effect of extending the dashboardStore fixture.

### Clean removal check

`grep -rn "InterpolationToggle\|setInterp\|INTERP_VALUES\|filters\.interp" src/ tests/` → no matches.

### Deferred — Chrome MCP QA on DEV

Per orchestrator instructions, Chrome MCP verification (Days popover interaction, heatmap dim, caveat toggling, Lin/Log toggle absence) is deferred to the orchestrator after merge. Unit + type-check gates are green.

### Deferred — `npm run build`

Build fails on pre-existing missing `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (worktree has no `.env`). Out of scope; passes after merge where CF Pages deploy secrets are present.

## Files changed

| File | Change |
|------|--------|
| `src/lib/filters.ts` | `interp` → `days` schema |
| `src/lib/dashboardStore.svelte.ts` | `daysFilter` state + `setDaysFilter` action + `filterRows(days)` |
| `src/lib/components/FilterBar.svelte` | Days popover (7 checkboxes + 3 presets) |
| `src/routes/+page.svelte` | `handleDaysChange` + prop wiring |
| `src/lib/components/DailyHeatmapCard.svelte` | dim excluded-DOW cells to opacity 0.2 |
| `src/lib/components/CohortRetentionCard.svelte` | drop InterpolationToggle, hardcode `log-linear`, add caveat |
| `src/lib/components/RepeaterCohortCountCard.svelte` | add caveat |
| `src/lib/components/InterpolationToggle.svelte` | deleted |
| `tests/unit/FilterBar.test.ts` | `baseFilters` refresh + Days popover smoke test |
| `tests/unit/dashboardStore.test.ts` | fixture refresh + 4 DOW `filterRows` tests |
| `tests/unit/urlState.test.ts` | `days` round-trip |

## Deviations from plan

None of substance. Three minor, benign choices:

1. **`filterRows(days)` default parameter** — plan specified extending the signature with `days` as the last arg and adding a `days.length < 7` skip fast-path. Implementation added `days: number[] = [1,2,3,4,5,6,7]` as a default so existing callers (tests written before this task) compile without edits; and builds a single `Set` outside the loop for O(1) membership.
2. **`initStore` `daysFilter` parameter** — plan specified `daysFilter: number[]` on `initStore`'s `data` type. Implementation made it optional and falls back to `data.filters.days` so any caller that forgets the explicit seed still works.
3. **dashboardStore fixture** — the existing fixture was missing `visit_seq` + `card_hash` (pre-existing type error surfaced by `npm run check`). As part of replacing `interp` I extended the 10 fixture rows with realistic `visit_seq` / `card_hash` values, closing those 10 type errors.

## Key decisions

- Hardcode `log-linear` everywhere — log-linear matches cold-cohort decay shape between public-source anchors better than linear (and matches the old toggle's default).
- Visual-only heatmap dim (opacity 0.2) — underlying revenue data is unchanged; filter is a lens. Matches the "caveat surfaces this" philosophy on cohort cards.
- Caveat copy — single-line amber at 11 px; identical text across retention + repeater cards; distinct test IDs so future tests can assert each independently.
- URL param stripped when all 7 selected — keeps shareable URLs clean and avoids forcing query params into the common case.

## Self-Check: PASSED

All created/modified files present on disk. Both commits (03db100, 1c9cf3a) visible in `git log`. InterpolationToggle.svelte correctly removed.
