---
phase: quick-260417-mp2
plan: 01
subsystem: dashboard
tags: [bugfix, regression, tdd, cohort, ltv]
dependency-graph:
  requires: []
  provides:
    - "YYYY-MM contract between pickCohortKey and formatBucketLabel"
  affects:
    - "src/routes/ dashboard (Cohort Revenue + Cohort Avg LTV cards)"
    - "reactive $derived chain in dashboardStore.svelte.ts"
tech-stack:
  added: []
  patterns:
    - "TDD RED/GREEN commit split for 1-line production fix"
    - "Integration test binds pure aggregator to downstream formatter to catch silent-fallback crashes"
key-files:
  created: []
  modified:
    - "src/lib/cohortAgg.ts (2 lines: comment + slice)"
    - "tests/unit/cohortAgg.test.ts (4 new assertions, 1 updated)"
decisions:
  - "Fix at source (pickCohortKey slice) not at sink (formatBucketLabel defensive parse) — contract is simpler to enforce upstream"
  - "Comment phrased via customer_ltv_v wrapper view (not _mv suffix) to avoid tripping Guard 1 regex"
metrics:
  duration: "3min"
  completed: "2026-04-17"
  tasks: 2
  files_changed: 2
requirements:
  - QUICK-260417-mp2
---

# Quick Task 260417-mp2: Fix Silent Dashboard Crash (formatBucketLabel) Summary

## One-Liner

Sliced `pickCohortKey` month branch to `YYYY-MM` — `parseISO(bucket + '-01')` in `formatBucketLabel` stops throwing `RangeError: Invalid time value`, unblocking Cohort Revenue + Cohort Avg LTV cards and restoring non-zero KPI tiles on month grain.

## Root Cause

| Layer | Actual | Expected |
|---|---|---|
| DB: `customer_ltv_v.cohort_month` (Postgres DATE) | `'2025-06-01'` | — |
| `pickCohortKey(row, 'month')` (before) | `'2025-06-01'` (raw passthrough) | `'2025-06'` (length 7) |
| `formatBucketLabel(bucket + '-01', 'month')` | `parseISO('2025-06-01-01')` → Invalid Date → RangeError | `parseISO('2025-06-01')` → valid |
| Effect | `$derived` chain crashes; 3 stack traces; KPI tiles silently fall back to `0 €` | Cards render, tiles show real € |

The type comment at `cohortAgg.ts:10` claimed `YYYY-MM-01` but the DB column type is Postgres `DATE`, which serializes to `YYYY-MM-DD`. The comment was aspirational; the data was the truth.

## Exact Diff

**src/lib/cohortAgg.ts:**
```diff
-  cohort_month: string;  // YYYY-MM-01
+  cohort_month: string;  // YYYY-MM-DD (Postgres DATE via customer_ltv_v) — sliced to YYYY-MM by pickCohortKey

 function pickCohortKey(row: CustomerLtvRow, grain: 'week' | 'month'): string {
-  return grain === 'week' ? row.cohort_week : row.cohort_month;
+  return grain === 'week' ? row.cohort_week : row.cohort_month.slice(0, 7);
 }
```

**tests/unit/cohortAgg.test.ts:**
- Imported `formatBucketLabel` from `dashboardStore.svelte`
- Updated existing grain=month assertion `'2026-03-01'` → `'2026-03'`
- Added `describe('month-grain contract (260417-mp2 regression)')` with 3 tests:
  - **A:** `cohortRevenueSum(..., 'month')[0].cohort === '2025-06'` (length 7)
  - **B:** `cohortAvgLtv(..., 'month')[0].cohort === '2025-06'` (length 7)
  - **C:** `formatBucketLabel(row.cohort, 'month')` does NOT throw + returns `'Jun'`

Commits:
- Task 1 RED: `62fab3e` — test(quick-260417-mp2): add failing regression tests
- Task 2 GREEN: `c389bd4` — fix(quick-260417-mp2): slice cohort_month to YYYY-MM

## RED Proof (Task 1 under old code)

```
FAIL  tests/unit/cohortAgg.test.ts > month-grain contract (260417-mp2 regression) > C — formatBucketLabel accepts each cohort key without throwing
AssertionError: expected [Function] to not throw an error but 'RangeError: Invalid time value' was thrown

- Expected: undefined
+ Received: "RangeError: Invalid time value"

FAIL  tests/unit/cohortAgg.test.ts > ... > A — cohortRevenueSum returns YYYY-MM ...
Expected: "2025-06"
Received: "2025-06-01"
```

Exact error from Test C — `RangeError: Invalid time value` — matches the stack trace reported in production at `https://ramen-bones-analytics.pages.dev`.

## GREEN Proof (Task 2)

```
npm run test:unit
 Test Files  21 passed (21)
      Tests  160 passed (160)
```

160/160 tests pass (was 156 before; +4 new regression tests). Zero collateral damage.

## Verification (Local)

- [x] `npx vitest run tests/unit/cohortAgg.test.ts` → 8/8 pass
- [x] `npm run test:unit` → 160/160 pass across 21 files
- [x] `git diff --stat HEAD~2` → exactly 2 files touched
- [x] `git diff src/lib/cohortAgg.ts` → 2 modified lines, no added/deleted blocks
- [x] `bash scripts/ci-guards.sh` → `All CI guards passed.`

## DEV Verification

**Not yet performed in this worktree.** Worktree commits sit on branch `worktree-agent-a5c58cfd` — not merged to `main`. Once merged, CF Pages auto-deploys within ~2min; manual Chrome MCP verification of the live dashboard at https://ramen-bones-analytics.pages.dev with month-grain toggle was NOT executed from this execution context (no Chrome MCP session). Pre-deploy gates (unit tests + ci-guards) are green — the DEV check is a mechanical step for the reviewer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing `.svelte-kit/tsconfig.json` in worktree**
- **Found during:** Task 1 first vitest run
- **Issue:** Vitest failed to load `tests/setup.ts` because `tsconfig.json` extends `./.svelte-kit/tsconfig.json`, which SvelteKit generates on first sync. The agent worktree had never been synced.
- **Fix:** Ran `npx svelte-kit sync` to generate `.svelte-kit/tsconfig.json` + types.
- **Files modified:** none (generated files are git-ignored)
- **Commit:** none needed

**2. [Rule 3 - Blocking] Plan's comment text tripped Guard 1 (`_mv` regex)**
- **Found during:** Task 2 `npm run test:unit` — `ci-guards.test.ts` failed
- **Issue:** The plan prescribed comment text `YYYY-MM-DD (Postgres DATE from customer_ltv_mv)`. Guard 1 forbids `\b[a-z_]+_mv\b` anywhere under `src/`, including inside comments. The regex can't distinguish code from doc strings.
- **Fix:** Changed comment phrasing from `customer_ltv_mv` to `via customer_ltv_v` — the wrapper view is what app code actually reads, so the attribution is more correct anyway.
- **Files modified:** `src/lib/cohortAgg.ts` (same 1 comment line, different text)
- **Commit:** Folded into Task 2 commit `c389bd4`

## Known Stubs

None. Fix is complete; no placeholder data, no TODO markers, no follow-up tasks required.

## Deferred Issues

None. Full unit suite is green after both deviations resolved.

## Cross-Link to Project Memory

This bug is the **exact pattern** warned about in `.claude/memory/project_silent_error_isolation.md` (2026-04-17 incident): a downstream throw inside a reactive `$derived` chain gets swallowed by per-card error-isolation, producing `0 €` KPI tiles with no user-visible signal. The memory was written after a different silent-fallback (`.catch(() => [])`) masked a Postgres permission error for hours. This `RangeError` sat live for 3 stack traces on the production dashboard before a human user noticed the zero'd tiles — same failure mode, different trigger.

**Takeaway reinforced:** integration tests (not just pure-function tests) must bind the aggregator to the downstream formatter so contract drift between them cannot silently fall back. Test C in this plan is that integration binding.

## Self-Check: PASSED

- [x] `src/lib/cohortAgg.ts` exists and diff shows 2 modified lines — FOUND
- [x] `tests/unit/cohortAgg.test.ts` exists and contains new describe block — FOUND
- [x] Commit `62fab3e` (Task 1 RED) present in `git log` — FOUND
- [x] Commit `c389bd4` (Task 2 GREEN) present in `git log` — FOUND
- [x] `npm run test:unit` → 160/160 pass — VERIFIED
- [x] `bash scripts/ci-guards.sh` → All guards clean — VERIFIED
