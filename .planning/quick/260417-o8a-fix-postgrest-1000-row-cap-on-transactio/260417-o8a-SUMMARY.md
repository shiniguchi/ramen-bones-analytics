---
phase: quick/260417-o8a
plan: 01
subsystem: dashboard-ssr
tags: [pagination, postgrest, ssr, regression-tests, bug-fix]
dependency_graph:
  requires: []
  provides: [fetchAll pagination helper, paginated SSR queries]
  affects: [src/routes/+page.server.ts, dashboard revenue KPIs, all chart data]
tech_stack:
  added: [src/lib/supabasePagination.ts]
  patterns: [fetchAll loop pattern for PostgREST max_rows bypass]
key_files:
  created:
    - src/lib/supabasePagination.ts
    - tests/unit/supabasePagination.test.ts
  modified:
    - src/routes/+page.server.ts
    - tests/unit/pageServerLoader.test.ts
key_decisions:
  - pageSize=1000 (Supabase free-tier max_rows default — safe floor)
  - RangeBuilder uses PromiseLike not Promise (PostgrestFilterBuilder is Thenable but not Promise)
  - retention_curve_v, insights_v, data_freshness_v left uncapped (no observed cap risk)
  - MAX_PAGES=1000 safety cap prevents runaway loops on buggy builders
metrics:
  duration: ~25min
  completed: 2026-04-17
  tasks: 2
  files: 4
---

# Quick Task 260417-o8a: Fix PostgREST 1000-Row Cap on Transaction Queries — Summary

**One-liner:** Pagination helper `fetchAll()` loops `.range(offset, offset+pageSize-1)` until exhausted, wired into all four uncapped SSR queries that were silently truncating €203k to €29,945.

## What Was Built

### Task 1: `fetchAll` pagination helper (RED → GREEN)

`src/lib/supabasePagination.ts` exports:

```typescript
export async function fetchAll<T>(
  buildQuery: () => RangeBuilder<T>,
  pageSize = 1000
): Promise<T[]>
```

Loop contract:
1. Call `buildQuery().range(offset, offset + pageSize - 1)`
2. If error: throw (caller's `.catch` logs + falls back to `[]`)
3. If empty or short page: break
4. Otherwise: accumulate + advance offset

Safety: `MAX_PAGES = 1000` cap (1M rows) throws on runaway loops.

**Final pageSize used:** 1000 (Supabase free-tier default; if Supabase drops max_rows below 1000, lower this constant).

**7 unit tests pass:** multi-page exhaustion, single full page + empty stop, single partial page, empty page, error propagation, custom pageSize, range off-by-one bounds.

Commits:
- `5860a68` — RED test (module not found, expected)
- `9b3fd4f` — GREEN implementation

### Task 2: Wire fetchAll into four +page.server.ts queries

All four high-row-count queries replaced with `fetchAll()` wrappers:

| Query | Table | Change |
|-------|-------|--------|
| dailyRowsP | transactions_filterable_v (current) | `.then()` → `fetchAll()` |
| priorDailyRowsP | transactions_filterable_v (prior) | `.then()` → `fetchAll()` |
| customerLtvP | customer_ltv_v | `.then()` → `fetchAll()` |
| itemCountsP | item_counts_daily_v | `.then()` → `fetchAll()` |

Untouched (no cap risk): `retention_curve_v` (≤208 rows), `insights_v` (limit 1), `data_freshness_v` (maybeSingle).

**3 regression tests added to `pageServerLoader.test.ts`:**
- **Regression A:** 2500-row canned fixture → `dailyRows.length === 2500` with exact `.range()` bounds `[0,999]`, `[1000,1999]`, `[2000,2999]`
- **Regression B:** All 4 tables show ≥1 `.range()` call (pagination wiring verified)
- **Regression C:** `customer_ltv_v` PostgREST error → `customerLtv === []`, other cards survive (D-22 preserved)

**Test count:** 160 → 170 unit tests (all pass).

Commit: `4243562`

## Pre-fix vs Post-fix

| Metric | Before | After |
|--------|--------|-------|
| Revenue (range=all) | €29,945 | €203,293 (expected) |
| tx_count (range=all) | 1,000 | 6,896 (expected) |
| Calendar months shown | ~6 random months | Jun 2025 – Apr 2026 (11 months) |
| Root cause | Uncapped `.then()` chain hit PostgREST max_rows=1000 | `fetchAll()` paginates until exhausted |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `RangeBuilder` interface used `Promise` instead of `PromiseLike`**
- **Found during:** Task 2 `npm run check`
- **Issue:** `PostgrestFilterBuilder.range()` returns a `PostgrestFilterBuilder` (Thenable but not full `Promise`) — strict TypeScript rejected the assignment to `Promise<...>` return type.
- **Fix:** Changed `RangeBuilder<T>.range()` return type from `Promise<...>` to `PromiseLike<...>`. Both the unit-test mock (plain Promise) and the real supabase-js builder satisfy `PromiseLike`.
- **Files modified:** `src/lib/supabasePagination.ts`
- **Commit:** `4243562` (included in Task 2 commit)

**2. [Rule 1 - Bug] Regression A test asserted single RecordedQuery with 3 range calls**
- **Found during:** Task 2 first GREEN run
- **Issue:** `fetchAll` calls `buildQuery()` once per page — each page creates a fresh `RecordedQuery`. Three pages = three separate query records, each with 1 range call. Test searched for one query with 3 range calls → `undefined`.
- **Fix:** Changed assertion to collect all `.range()` calls across all queries for the table and use `toContainEqual()` for each expected bound pair.
- **Files modified:** `tests/unit/pageServerLoader.test.ts`
- **Commit:** `4243562`

## Known Stubs

None. The helper is fully wired and operational. Data flows from Supabase through fetchAll to the dashboard.

## Pre-existing Issues (Out of Scope)

- `src/routes/+page.server.ts:123` — `retention_curve_v` `.then().catch()` chain has a pre-existing TS error (`Property 'catch' does not exist on type 'PromiseLike'`). This existed before this task (main repo had 5 such errors; we reduced to 1 by wrapping the 4 capped queries). The `retention_curve_v` query is intentionally not wrapped (no cap risk) — fixing this pre-existing TS error is out of scope for this task.
- Deno `std/assert` import errors in `supabase/functions/` — pre-existing, unrelated.

## Self-Check: PASSED

- `src/lib/supabasePagination.ts` — FOUND
- `tests/unit/supabasePagination.test.ts` — FOUND
- `tests/unit/pageServerLoader.test.ts` — FOUND (extended)
- Commit `5860a68` — FOUND (RED tests)
- Commit `9b3fd4f` — FOUND (GREEN implementation)
- Commit `4243562` — FOUND (Task 2 wiring + regression tests)
- All 170 unit tests pass
- Build succeeds with CF adapter
