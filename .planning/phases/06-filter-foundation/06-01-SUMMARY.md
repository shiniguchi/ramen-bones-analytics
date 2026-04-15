---
phase: 06-filter-foundation
plan: 01
subsystem: filter-foundation
tags: [zod, filters, date-range, ci-guard, tdd]
requires: []
provides:
  - parseFilters(url) — single URL → FiltersState converter
  - FILTER_DEFAULTS frozen constant (range=7d, grain=week)
  - FiltersState type (zod inferred)
  - customToRange({from,to}) with Berlin-stable prior-window math
  - Guard 6 (no-dynamic-sql) wired into scripts/ci-guards.sh
  - tests/e2e/filter-bar.spec.ts with 8 FLT-tagged fixme stubs
affects:
  - src/lib/dateRange.ts (append-only: customToRange added, chipToRange untouched)
  - scripts/ci-guards.sh (append-only: Guard 6 wired in)
tech-stack:
  added: [zod@^3.23.3]
  patterns:
    - zod .catch() per-field coercion (D-17)
    - CSV multi-select parsing via .transform() + .pipe(z.array(z.enum()))
key-files:
  created:
    - src/lib/filters.ts
    - tests/unit/filters.test.ts
    - scripts/ci-guards/no-dynamic-sql.sh
    - tests/e2e/filter-bar.spec.ts
  modified:
    - package.json (+ zod dep)
    - package-lock.json
    - src/lib/dateRange.ts (+ customToRange export)
    - tests/unit/dateRange.test.ts (+ 4 customToRange cases)
    - scripts/ci-guards.sh (+ Guard 6 wiring)
decisions:
  - Tests placed in tests/unit/ not src/lib/ to match project convention (test:unit scoped)
  - Guard 6 added as scripts/ci-guards/no-dynamic-sql.sh sub-script, invoked from existing single-file runner scripts/ci-guards.sh (project does not have scripts/ci-guards/run.sh)
  - csvArray uses .optional().catch(() => undefined) so a single invalid enum value collapses the whole array to undefined (D-17 strict-tolerance tradeoff)
metrics:
  duration: ~8min
  tasks: 3
  files_created: 4
  files_modified: 5
  tests_added: 15 (11 filters + 4 customToRange)
  completed: "2026-04-15"
---

# Phase 6 Plan 01: Filter Foundation Summary

Install zod, ship the single flat filter schema (`src/lib/filters.ts`), extend `dateRange.ts` with `customToRange`, land CI Guard 6 (no dynamic SQL), and seed 8 FLT-tagged Playwright fixme stubs — the foundation every later Phase 6 plan consumes.

## What Shipped

**Task 1 — zod filter schema (commit `878083d`)**
- Added `zod@^3.23.3` dependency
- `src/lib/filters.ts`: `filtersSchema`, `parseFilters(url)`, `FILTER_DEFAULTS` (frozen `{range:'7d',grain:'week'}`), `FiltersState` type
- Per-field `.catch()` coercion on `range`, `grain`, `from`, `to`, `sales_type`, `payment_method` — malformed params never throw
- `tests/unit/filters.test.ts`: 11 cases — defaults, CSV multi-select, D-17 coercion (range=bogus, grain=lightyear, from=not-a-date, unknown param, SQL-injection attempt), FILTER_DEFAULTS frozen invariant

**Task 2 — customToRange (commit `cf1c132`)**
- Appended `customToRange({from,to})` to `src/lib/dateRange.ts`
- UTC-midnight integer-day arithmetic preserves literal Berlin ISO strings (no TZ re-shift on user-picked dates)
- Swaps inverted input (`to < from`) instead of throwing — D-17 tolerance
- `tests/unit/dateRange.test.ts`: +4 cases (7-day window, single-day, inverted swap, TZ stability)
- `chipToRange` untouched — preset path preserved

**Task 3 — Guard 6 + e2e stubs (commit `65b0301`)**
- `scripts/ci-guards/no-dynamic-sql.sh`: standalone guard greps src/ `*.ts/*.svelte` for `${` inside `.from(/.rpc(`
- `scripts/ci-guards.sh`: wired Guard 6 into main runner after Guard 5
- `tests/e2e/filter-bar.spec.ts`: 8 `test.fixme()` stubs — FLT-01 (×2), FLT-02, FLT-03, FLT-04, FLT-07, D-13, D-18 — Playwright `--list` confirms all 8 are enumerated
- Synthetic probe evidence: `echo 'sb.from(\`tx_${foo}\`)' > src/_probe.ts && bash scripts/ci-guards/no-dynamic-sql.sh` → exit `1` ✓ (probe removed)

## Verification

```
$ npx vitest run tests/unit/filters.test.ts tests/unit/dateRange.test.ts
 Test Files  2 passed (2)
      Tests  19 passed (19)

$ bash scripts/ci-guards.sh
...
Guard 6 (no-dynamic-sql): clean
All CI guards passed.

$ npx playwright test tests/e2e/filter-bar.spec.ts --list
Total: 8 tests in 1 file
```

## Deviations from Plan

### Rule 3 — Fixed Blocking Issues

**1. [Rule 3] Test file path convention**
- **Found during:** Task 1
- **Issue:** Plan specified `src/lib/filters.test.ts` and `src/lib/dateRange.test.ts`, but `package.json` scopes `test:unit` to `tests/unit/` (`"test:unit": "vitest run tests/unit"`). Colocated tests would not be picked up by the runner.
- **Fix:** Placed new suites at `tests/unit/filters.test.ts` and extended the existing `tests/unit/dateRange.test.ts` (which already tested `chipToRange`).
- **Files modified:** `tests/unit/filters.test.ts` (new), `tests/unit/dateRange.test.ts` (appended).
- **Impact:** None — all acceptance criteria still met; tests run via existing `test:unit` script.

**2. [Rule 3] CI guards runner path**
- **Found during:** Task 3
- **Issue:** Plan assumed `scripts/ci-guards/run.sh` directory structure; project has a single-file runner `scripts/ci-guards.sh`.
- **Fix:** Created `scripts/ci-guards/no-dynamic-sql.sh` as a standalone sub-script (matches plan's future-proofing intent) and wired it into the existing `scripts/ci-guards.sh` with a delegated `bash` call. All existing guards (1, 2, 3, 3b, 4, 5) untouched.
- **Files modified:** `scripts/ci-guards.sh` (+10 lines).

### Rule 1 — Auto-Fixed Bugs

**1. [Rule 1] Inverted customToRange test expected wrong prior window**
- **Found during:** Task 2 GREEN run
- **Issue:** Test case `customToRange({from:'2026-04-15', to:'2026-04-08'})` expected `priorFrom='2026-04-01'` / `priorTo='2026-04-07'`. Swapped window is Apr 8..15 inclusive = 8 days, so prior = Mar 31..Apr 7.
- **Fix:** Corrected expected values to `priorFrom='2026-03-31'`.
- **Files modified:** `tests/unit/dateRange.test.ts`.

## Commits

| Hash       | Task   | Message                                                              |
| ---------- | ------ | -------------------------------------------------------------------- |
| `878083d`  | Task 1 | feat(06-01): add zod filter schema + parseFilters                    |
| `cf1c132`  | Task 2 | feat(06-01): add customToRange with Berlin-stable prior window       |
| `65b0301`  | Task 3 | feat(06-01): add Guard 6 no-dynamic-sql + filter-bar e2e stubs       |

## Known Stubs

None — this plan ships pure infrastructure (parser, guard, test scaffold). No UI, no stubs in production code. The 8 `test.fixme()` entries in `tests/e2e/filter-bar.spec.ts` are intentional RED stubs that Plans 06-03 and 06-04 flip to live tests as FLT features ship.

## Downstream Consumers

Plans 06-03 (loader refactor) and 06-04 (FilterBar component) can now import:
- `parseFilters`, `FILTER_DEFAULTS`, `FiltersState` from `$lib/filters`
- `customToRange` from `$lib/dateRange`
- Flip `test.fixme` → `test` in `tests/e2e/filter-bar.spec.ts` as each FLT-XX lands

## Self-Check: PASSED

- `src/lib/filters.ts` FOUND
- `tests/unit/filters.test.ts` FOUND
- `scripts/ci-guards/no-dynamic-sql.sh` FOUND (executable)
- `tests/e2e/filter-bar.spec.ts` FOUND (8 fixme stubs)
- `src/lib/dateRange.ts` contains `customToRange` export (verified)
- Commit `878083d` FOUND
- Commit `cf1c132` FOUND
- Commit `65b0301` FOUND
- 19/19 unit tests passing (filters + dateRange)
- Guard 6 clean on current src/, exits 1 on synthetic probe
