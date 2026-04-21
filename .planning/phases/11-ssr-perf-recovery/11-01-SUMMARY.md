---
phase: 11-ssr-perf-recovery
plan: 01
subsystem: ssr
tags:
  - phase-11-ssr-perf-recovery
  - ssr
  - range-clamp
  - fetchAll-cap
  - cloudflare-pages-free
dependency-graph:
  requires: []
  provides:
    - "chipToRange(range, now, { allStart }) with FROM_FLOOR signature default"
    - "parseFilters soft-clamp (FROM_FLOOR / today+365d)"
    - "FROM_FLOOR + TO_CEILING_DAYS_AHEAD exported constants"
    - "fetchAll({ pageSize, maxPages }) options-bag signature"
    - "DEFAULT_MAX_PAGES=50 + HARD_MAX_PAGES=1000 exports"
    - "+page.server.ts earliestBusinessDate injection into chipToRange"
  affects:
    - "every fetchAll callsite now silently inherits 50-page default"
tech-stack:
  added: []
  patterns:
    - "single-source-of-truth constant (FROM_FLOOR) shared across filters.ts and dateRange.ts"
    - "signature-default safety invariant — helper's own default cannot produce pathological 1970 window even if caller forgets to inject allStart"
    - "options bag migration — positional pageSize dropped, { pageSize, maxPages } passed by name"
key-files:
  created: []
  modified:
    - src/lib/dateRange.ts
    - src/lib/filters.ts
    - src/lib/supabasePagination.ts
    - src/routes/+page.server.ts
    - tests/unit/dateRange.test.ts
    - tests/unit/filters.test.ts
    - tests/unit/supabasePagination.test.ts
    - tests/unit/pageServerLoader.test.ts
decisions:
  - "D-01 implemented: chipToRange gains optional { allStart } third arg; signature default = FROM_FLOOR (not 1970). SSR loader passes tenant's earliest business_date fetched once via .order().limit(1).maybeSingle() on transactions_filterable_v."
  - "D-02 implemented: parseFilters soft-clamps well-formed ISO from<FROM_FLOOR and to>today+365d; non-ISO passes through to zod .catch default (undefined) unchanged."
  - "D-05 implemented: fetchAll defaults to 50 pages (CF Pages Free subrequest ceiling); HARD_MAX_PAGES=1000 exported for scripts."
metrics:
  duration: "~25 minutes executor wall time"
  tasks-completed: 2
  tests-added: 9
  tests-migrated: 2
  commits: 2
  files-modified: 8
  completed-date: 2026-04-21
---

# Phase 11 Plan 01: SSR Performance Recovery — Range Clamp + fetchAll Cap Summary

**One-liner:** Stop SSR from resolving range=all to 1970-01-01 — chipToRange now defaults to FROM_FLOOR (2024-01-01) and accepts tenant's earliest business_date as allStart; parseFilters soft-clamps bookmarked pathological URLs; fetchAll defaults to 50 pages (CF Pages Free subrequest ceiling).

## What Changed (per-file)

### Task 1 — Commit `e71155b`

| File                            | Lines         | Change                                                                                                                                                      |
| ------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/filters.ts`            | +22 / -1      | Add `FROM_FLOOR = '2024-01-01'` + `TO_CEILING_DAYS_AHEAD = 365` exports (D-02 single source of truth). Extend `parseFilters` to soft-clamp + `console.warn`. |
| `src/lib/dateRange.ts`          | +13 / -2      | Import `FROM_FLOOR`. `chipToRange` signature gains optional third arg `{ allStart?: string }`; `'all'` branch uses `options?.allStart ?? FROM_FLOOR`.        |
| `tests/unit/filters.test.ts`    | +67 / -2      | 2 constant-export cases + 5 clamp cases (from-clamp, to-clamp, warn spy, pass-through, non-ISO pass-through).                                                |
| `tests/unit/dateRange.test.ts`  | +35 / -2      | Replace epoch-to-today case with 5 new cases: allStart override, FROM_FLOOR default, single-source invariant, explicit-beats-default, future-allStart pass-through. |

### Task 2 — Commit `fde52fc`

| File                                    | Lines     | Change                                                                                                                                                                                                                           |
| --------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/supabasePagination.ts`         | +21 / -10 | Replace `const MAX_PAGES = 1000` with exported `DEFAULT_MAX_PAGES = 50` + `HARD_MAX_PAGES = 1000`. `fetchAll(buildQuery, { pageSize?, maxPages? })` options bag replaces positional `pageSize`. Throw message interpolates live maxPages. |
| `src/routes/+page.server.ts`            | +21 / -6  | Import `FROM_FLOOR`. Add `earliestBusinessDate` query block (one indexed `.order().limit(1).maybeSingle()` via existing `transactions_filterable_v` RLS-scoped view). Pass `{ allStart: earliestBusinessDate ?? FROM_FLOOR }` to `chipToRange`. |
| `tests/unit/supabasePagination.test.ts` | +65 / -2  | Migrate Test 6 from positional pageSize to options bag; add D-05 suite (4 cases) covering constants, default 50-page cap, caller-supplied maxPages, and pageSize override.                                                       |
| `tests/unit/pageServerLoader.test.ts`   | +9 / -5   | Rule 3 auto-fix: the 'is_cash in select' test previously indexed `filterable[0]`, but transactions_filterable_v is now queried twice per SSR (earliest-date first, dailyRows second). Test now scans all queries for an `is_cash` select — the real invariant. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Update `pageServerLoader.test.ts is_cash in select` test to scan all queries**

- **Found during:** Task 2 post-build test sweep
- **Issue:** Plan Task 2 adds a new `transactions_filterable_v` query (earliestBusinessDate) that is the FIRST recorded query for that table. The existing `pageServerLoader.test.ts` test at line 147 asserted `filterable[0].calls[...]` includes `is_cash` — which now fails because `filterable[0]` is the new `SELECT business_date` query.
- **Fix:** Updated the test to scan all queries on `transactions_filterable_v` for an `is_cash` select (the real invariant — the dashboard render must receive `is_cash` from *some* query on this table). Dropped the positional `[0]` assumption.
- **Files modified:** `tests/unit/pageServerLoader.test.ts`
- **Commit:** `fde52fc`

### Plan call-outs (not deviations — per plan action 6)

- No `fetchAll(fn, 500)` positional callsites existed in `src/` — the only non-default positional callsite was inside the pagination unit test (Test 6), which was migrated to the options bag per the plan.

## Test Verify Output

```bash
$ npx vitest run tests/unit/dateRange.test.ts tests/unit/filters.test.ts tests/unit/supabasePagination.test.ts

Test Files  3 passed (3)
Tests       50 passed (50)
Duration    1.48s
```

## Build Output

```
✓ built in 11.27s
Using @sveltejs/adapter-cloudflare  ✔ done
```

No TypeScript errors. The signature change to `fetchAll` propagates cleanly through all 10 existing callsites (they use the zero-arg form, so inherit DEFAULT_MAX_PAGES=50 automatically).

## Full Unit Suite (context, not plan scope)

Running the full `tests/unit/` suite shows 9 pre-existing failures that are NOT caused by this plan (verified via `git stash` snapshot):

- `CalendarCards.test.ts` (4 tests) — blocked by uncommitted user changes in `CalendarRevenueCard.svelte`, `CalendarCountsCard.svelte` (plan-protected files).
- `CohortRetentionCard.test.ts` (1 test) — unrelated weekly-clamp hint.
- `ci-guards.test.ts` (1 test) — unrelated raw-table guard.
- `pageServerLoader.test.ts > does NOT query kpi_daily_v` (1 test) — will be resolved by Plan 11-02 (moves kpi_daily_v off the SSR critical path).
- `sparseFilter.test.ts` (2 tests) — unrelated MAX_COHORT_LINES constant drift.

These 9 failures exist on both sides of this plan and are documented in `deferred-items.md`-equivalent form here.

## Production Smoke Check (Deferred)

**Phase 11 is a multi-plan recovery.** The live `curl` smoke tests in `<verification>` will run after 11-02 + 11-03 complete, per the wave plan. Rationale: 11-01 alone clamps the input window but 4 lifetime-unbounded fetchAll callsites still fire on every SSR (~20-30 subrequests cold-cache). 11-02 moves those off the SSR critical path, which is the other half of the 1102 fix. Running the smoke test before 11-02 lands risks seeing an intermittent 1102 that would be misattributed.

Deferred curl commands (to run after 11-03):

```bash
# Expected: HTTP 303 (redirect) or HTTP 200 — never HTTP 404 size=9
curl -sS -o /dev/null -w "HTTP %{http_code} size=%{size_download}\n" \
  'https://ramen-bones-analytics.pages.dev/?range=all'

# Expected: x-sveltekit-page: true
curl -I https://ramen-bones-analytics.pages.dev/login 2>&1 | grep -i 'x-sveltekit-page'

# Pathological URL manual crafting — now clamped at parseFilters layer
curl -sS -o /dev/null -w "HTTP %{http_code} size=%{size_download}\n" \
  'https://ramen-bones-analytics.pages.dev/?range=custom&from=1970-01-01&to=2026-04-21&grain=week&days=3,4,5,6,7'
```

## Uncommitted User Files — Untouched

Verified at commit boundaries via `git status --porcelain`:

```
 M src/lib/components/CalendarCountsCard.svelte
 M src/lib/components/CalendarItemRevenueCard.svelte
 M src/lib/components/CalendarItemsCard.svelte
 M src/lib/components/CalendarRevenueCard.svelte
 M src/lib/dashboardStore.svelte.ts
 M tests/unit/CalendarCards.test.ts
```

All six pre-existing M-marks are preserved; no protected file touched.

## Self-Check: PASSED

- `src/lib/dateRange.ts`: `grep -q "options?:"` → FOUND; `allStart` appears 4 times; `import { FROM_FLOOR } from './filters'` present.
- `src/lib/filters.ts`: `FROM_FLOOR = '2024-01-01'` exported; `TO_CEILING_DAYS_AHEAD = 365` exported; 3 `console.warn` occurrences.
- `src/lib/supabasePagination.ts`: `DEFAULT_MAX_PAGES=50` + `HARD_MAX_PAGES=1000` exported; `const MAX_PAGES` removed.
- `src/routes/+page.server.ts`: `earliestBusinessDate` declared + assigned + consumed (3 refs); `FROM_FLOOR` imported + used.
- Commit `e71155b` in `git log --oneline`: FOUND.
- Commit `fde52fc` in `git log --oneline`: FOUND.
- 50 plan-scoped unit tests pass; build exits 0.
- No accidental file deletions in either commit.
- Protected files show only pre-existing M-marks.
