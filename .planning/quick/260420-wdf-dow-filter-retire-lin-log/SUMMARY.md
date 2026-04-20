---
task: 260420-wdf
title: Day-of-week filter + retire Lin/Log toggle
status: complete
completed: 2026-04-20
commits:
  - 03db100
  - 1c9cf3a
  - 7027b4b
  - 545273c
  - d2f536d
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

### Chrome MCP QA on localhost — PASS (incl. SQL cross-check)

Orchestrator ran Chrome MCP QA at `http://localhost:5173` against DEV DB. Cross-checked chart values per month against direct SQL aggregates from `transactions_filterable_v` (row-level tx) and `item_counts_daily_mv` (per-item) for both `Mon-Fri` and `Sat-Sun` filter states.

| Scope | Filter | UI value | SQL ground truth | Match |
|---|---|---|---|---|
| Revenue KPI tile | All days | €203.3K | €203,293.00 | exact |
| Revenue KPI tile | Mon-Fri | €102.7K | €102,721.50 | exact |
| Revenue KPI tile | Sat-Sun | €100.6K | €100,571.50 | exact |
| Tx KPI tile | All days | 6,896 | 6,896 | exact |
| Tx KPI tile | Mon-Fri | 3,571 | 3,571 | exact |
| Tx KPI tile | Sat-Sun | 3,325 | 3,325 | exact |
| Calendar Counts — 11 monthly bars | Sat-Sun | 224/241/458/214/368/430/223/384/301/349/133 | same | exact |
| Calendar Revenue — 11 monthly bars | Sat-Sun | €6.6K/7.1K/13.4K/6.7K/11.1K/13.3K/6.8K/12.3K/9.1K/10.2K/3.8K | €6,629 / 7,146.50 / 13,422.50 / 6,690 / 11,118.50 / 13,306.50 / 6,805.50 / 12,318.50 / 9,086 / 10,211.50 / 3,837 | exact (0.1K rounding) |
| Items Sold Y-axis peak | Sat-Sun | 515 (Aug 2025) | Jiro-Kei Ramen = 515 | exact |
| Items Sold Y-axis peak | Mon-Fri | 428 (Oct 2025) | Jiro-Kei Ramen = 428 | exact |
| Per-item Revenue chart | Sat-Sun | €6.6K/7.1K/13.4K/... | item_counts_daily_mv Sat-Sun sum | exact |

### Bug caught + fixed mid-QA — follow-up commit 7027b4b

`CalendarItemsCard.svelte` and `CalendarItemRevenueCard.svelte` do their own client-side filter (sales_type + is_cash) and were NOT checking `days`. Chrome MCP QA caught the per-item Revenue chart showing all-days values (€13.5K for Jun 2025 = Mon-Fri €6.9K + Sat-Sun €6.6K combined) when Sat-Sun filter was active.

Fix: added Mon-first DOW predicate to both cards' `filtered` derivation, matching `dashboardStore.filterRows`. Re-verified in Chrome MCP post-fix — all per-item chart values match SQL per filter.

Commit: `7027b4b` — `fix(quick-260420-wdf): apply day-of-week filter to item cards`.

### Scope expansion: Repeater card now honors day filter — commit 545273c

User pushback: "I actually want the day filter to apply to the Repeaters card". Original plan explicitly excluded cohort cards with the amber caveat banner.

Chose Option A (full recomputation, not membership filter): when the user picks a subset of weekdays, we treat it as "what if we'd never opened on excluded days?" — `visit_count` drops, `cohort_month` shifts to first visit on a selected day, customers whose visits all land on excluded days are dropped entirely.

Implementation:
- New SSR fetch `repeaterTxP` in `+page.server.ts`: lifetime transactions (`card_hash`, `business_date`, `gross_cents`), unfiltered by chip window. Payload ~200 KB (6.9 K rows × 3 fields).
- `cohortAgg.ts`: new `recomputeCustomerLtvFromTx(rows, days)` helper. Excludes Apr 2026 Worldline blackout (2026-04-01..04-11, matching `customer_ltv_mv`) + filters DOW via Mon-first predicate + groups by card_hash. Client-side rebuild of what `customer_ltv_mv` would look like under the filter hypothesis.
- `RepeaterCohortCountCard.svelte`: new `repeaterTx` prop. When `days.length === 7`, use SSR `customerLtv` directly (fast path, no recomputation). When filter active, call `recomputeCustomerLtvFromTx` → feed to existing `cohortRepeaterCountByVisitBucket`. Caveat banner removed.
- `CohortRetentionCard.svelte` caveat kept — retention requires period-by-period recomputation against a moving horizon, deferred out of 260420-wdf scope.

Tests: 6 new unit tests in `cohortAgg.test.ts` covering DOW transform edge cases (Sunday=7 not 0), cohort shift under exclusion, blackout window, empty-input and all-excluded cases. `cohortAgg.test.ts` 13 → 19 passing.

### Cloud QA (ramen-bones-analytics.pages.dev) — all values exact-match SQL

Full cross-check via `document.querySelectorAll('text.fill-zinc-700')` + `/mcp__supabase-dev__query` ground-truth SQL aggregates:

| State | Verified charts | Match |
|---|---|---|
| No filter | KPI tiles + Repeater 11 cohorts | ✓ |
| days=1,2,3,4,5 (Mon-Fri) | KPI + Cal Counts 11 + Cal Revenue 11 + Item Revenue 11 + Repeater 10 (Feb=4 sparse-filtered) + per-bucket Jun 2025 (6 non-zero buckets) + per-bucket Mar 2026 | ✓ |
| days=6,7 (Sat-Sun) | KPI + Cal Counts 11 + Cal Revenue 11 + Item Revenue 11 + Repeater 10 + per-bucket Jun 2025 (6 non-zero buckets) + per-bucket Aug 2025 (5 non-zero buckets) | ✓ |
| Retention caveat still shown | | ✓ kept |
| Repeater caveat removed | | ✓ |
| Lin/Log toggle absent | | ✓ |
| Console errors across all states | zero | ✓ |

Deploy: CF Pages run [24671097691](https://github.com/shiniguchi/ramen-bones-analytics/actions/runs/24671097691) (success).

### Deferred — `npm run build`

Build fails on pre-existing missing `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (worktree has no `.env`). Out of scope; passes after merge where CF Pages deploy secrets are present.

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

### UX polish — sticky filter header (commit d2f536d)

User asked for the filter bar to stay visible on scroll. `FilterBar.svelte` already had `sticky top-0 z-30` applied (line 88, added as part of Phase 9) but the bar wasn't pinning.

Root cause: `src/routes/+layout.svelte:6` had `overflow-x-hidden` on the outer wrapper. `overflow-x: hidden` creates an implicit scroll container (browser computes `overflow-y: auto` too), and `position: sticky` binds to the nearest scroll container rather than the viewport. The sticky element stuck to the top of the wrapper (which grows with content) instead of the visible viewport edge.

Fix: swap `overflow-x-hidden` → `overflow-x-clip`. `overflow: clip` blocks horizontal overflow without creating a scroll container, so sticky descendants now bind to the viewport. Browser support: Chrome 90+ / Safari 15.4+ / Firefox 81+.

Diff: one line in `src/routes/+layout.svelte`.

Chrome MCP QA on DEV (ramen-bones-analytics.pages.dev) at 390×844 mobile viewport — scrolled past heatmap + cohort charts + repeater charts, filter bar stayed pinned across all scroll depths. Zero regressions to chart tooltips or horizontal-scroll chart wrappers (confirmed sibling `overflow-x-auto` still works; clip is on ancestor, not an ancestor scroll container).

Memory note: ties to an older lesson about being careful with layout-wrapper overflow rules — sticky behavior is easy to break invisibly.
