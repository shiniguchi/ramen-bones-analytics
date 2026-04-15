---
phase: 06-filter-foundation
plan: 03
subsystem: filter-foundation
tags: [loader, ssr, wrapper-view, filters, tdd, migration]
requires:
  - parseFilters + FiltersState (from 06-01)
  - customToRange (from 06-01)
  - transactions table with sales_type + payment_method columns (from 0008)
provides:
  - transactions_filterable_v wrapper view (JWT-tenant-scoped; business_date + gross_cents + sales_type + payment_method)
  - +page.server.ts loader refactored to parseFilters(url) as sole URL->state converter
  - Chip-scoped KPI tiles honoring sales_type + payment_method via .in()
  - Custom date range flowing through customToRange
  - distinctSalesTypes / distinctPaymentMethods arrays on page data (unfiltered, D-14)
  - page data exposes `filters: FiltersState` for downstream Filter Bar (06-04)
affects:
  - src/routes/+page.server.ts (refactored)
  - supabase/migrations/ (+0018)
  - tests/unit/ (+pageServerLoader.test.ts)
tech-stack:
  added: []
  patterns:
    - Supabase JS no-DISTINCT workaround — select column + JS Set dedupe (FLT-07: no dynamic SQL)
    - Wrapper view with security_invoker = true + JWT claim filter (matches 0014)
    - Hand-rolled chainable supabase mock for loader integration tests
key-files:
  created:
    - supabase/migrations/0018_transactions_filterable_v.sql
    - tests/unit/pageServerLoader.test.ts
  modified:
    - src/routes/+page.server.ts
decisions:
  - Fixed-reference tiles (today/7d/30d) stay on kpi_daily_v unfiltered; only chip-scoped tiles (txCount, avgTicket) move to transactions_filterable_v (UI-SPEC lock)
  - Distinct option arrays dedupe in JS not SQL — keeps FLT-07 "no dynamic SQL" clean; Phase 8 may back with a dim view
  - Local aggregate() helper mirrors sumKpi semantics so chip tiles reuse the existing KpiAgg shape without changing UI contracts
  - Integration test uses hand-rolled chainable mock (no existing test harness for locals.supabase yet) — recording .from/.select/.in/.gte/.lte call trail per table
  - Loader still reads url.searchParams.get('__e2e') for chart bypass — this is a test flag, not a filter param, so FLT-07 "no direct searchParams for filter keys" holds
metrics:
  duration: ~18min
  tasks: 2
  files_created: 2
  files_modified: 1
  tests_added: 6 (loader integration)
  completed: "2026-04-15"
requirements: [FLT-03, FLT-04, FLT-07]
---

# Phase 6 Plan 03: Loader Filter Refactor Summary

Land the single SSR choke point for filters: add `transactions_filterable_v` wrapper view, refactor `+page.server.ts` to call `parseFilters(url)` once, route chip-scoped KPI tiles through the new view with `.in()`-honored sales_type / payment_method, and expose `distinctSalesTypes` / `distinctPaymentMethods` arrays so Plan 06-04's FilterBar can populate dropdowns directly.

## What Shipped

**Task 1 — Migration 0018 transactions_filterable_v (commit `083184c`)**
- New wrapper view over `public.transactions` joined to `public.restaurants` for business_date derivation
- `security_invoker = true` + `where restaurant_id::text = (auth.jwt() ->> 'restaurant_id')` tenancy filter (matches 0014 / 0011 pattern)
- Columns: `restaurant_id, business_date, gross_cents, sales_type, payment_method`
- `grant select ... to authenticated`; no direct `transactions` read from frontend
- Applied to DEV via `supabase db push --yes` (applies cleanly; migration-drift guard green)

**Task 2 — Loader refactor + integration test (commits `2ef33a9` RED, `1da636f` GREEN)**
- `parseFilters(url)` called exactly once; all filter params flow through it (`filters.range`, `filters.sales_type`, `filters.payment_method`, `filters.from`, `filters.to`)
- `url.searchParams.get('__e2e')` retained as the only direct searchParams read — test/bypass flag, not a filter param
- `customToRange({from, to})` used when `filters.range === 'custom'` and both literal dates present; otherwise `chipToRange(range)`
- New `queryFiltered(from, to)` helper on `transactions_filterable_v`: `.select('business_date,gross_cents,sales_type,payment_method').gte/.lte` and conditionally `.in('sales_type', filters.sales_type)` / `.in('payment_method', filters.payment_method)`
- New local `aggregate(rows)` collapses filtered rows to `{revenue_cents, tx_count, avg_ticket_cents}` mirroring `sumKpi`
- Chip-scoped tile path (`txCount`, `avgTicket`) now sources from `queryFiltered(chipW.from, chipW.to)` + prior window; fixed tiles (`revenueToday`, `revenue7d`, `revenue30d`) remain on `kpi_daily_v` unfiltered (UI-SPEC lock)
- Two new parallel distinct queries (`distinctSalesTypesP`, `distinctPaymentMethodsP`) select the column unfiltered, dedupe in JS with `new Set`, sort; errors isolate per-card to empty arrays
- Page data payload gains `filters`, `distinctSalesTypes`, `distinctPaymentMethods` (additive — existing `range`, `grain`, `window`, `kpi`, etc. still present)
- Retention / LTV / frequency / NVR / freshness / insight queries untouched (Phase 8 adds dim support)
- 6 new integration tests via hand-rolled chainable supabase mock in `tests/unit/pageServerLoader.test.ts`:
  - Test A: default URL → `filters.range === '7d'`, no `.in('sales_type', …)`
  - Test B: `?sales_type=INHOUSE` → records `.in('sales_type', ['INHOUSE'])` on `transactions_filterable_v`
  - Test C: `?payment_method=Visa,Bar` → records `.in('payment_method', ['Visa','Bar'])`
  - Test D: `?range=custom&from=2026-04-01&to=2026-04-15` → chip-window query uses the literal dates
  - Test E: returns `distinctSalesTypes: ['INHOUSE','TAKEAWAY']` + `distinctPaymentMethods: ['Bar','Visa']` (deduped + sorted from fixture)
  - Test F: fixed KPI queries (`kpi_daily_v`) never receive `.in('sales_type', …)`

## Verification

```
$ npx vitest run tests/unit/pageServerLoader.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ npx vitest run tests/unit
 Test Files  8 passed (8)
      Tests  60 passed (60)

$ bash scripts/ci-guards.sh
...
Guard 6 (no-dynamic-sql): clean
All CI guards passed.

$ supabase db push --yes
Applying migration 0018_transactions_filterable_v.sql...
Finished supabase db push.

$ grep -c "= parseFilters(url)" src/routes/+page.server.ts
1
$ grep -c "transactions_filterable_v" src/routes/+page.server.ts
6
$ grep -c "customToRange" src/routes/+page.server.ts
3
$ grep -c "distinctSalesTypes" src/routes/+page.server.ts
7
$ grep -c "distinctPaymentMethods" src/routes/+page.server.ts
7
```

## Acceptance Criteria

| Criterion                                                                 | Status |
| ------------------------------------------------------------------------- | ------ |
| Migration contains `create view public.transactions_filterable_v`          | PASS   |
| Migration tenant filter `auth.jwt() ->> 'restaurant_id'`                   | PASS   |
| Migration grant select to authenticated                                    | PASS   |
| Migration applies to DEV without error                                     | PASS   |
| Loader test file passes with ≥6 tests                                      | PASS (6/6) |
| `parseFilters(url)` invoked exactly once in loader                         | PASS   |
| `url.searchParams.get` only matches the `__e2e` bypass                     | PASS (1 match) |
| `transactions_filterable_v` referenced ≥3 times                            | PASS (6)   |
| `customToRange` referenced                                                 | PASS (3)   |
| `distinctSalesTypes` referenced ≥2 times                                   | PASS (7)   |
| `distinctPaymentMethods` referenced ≥2 times                               | PASS (7)   |
| `filters.sales_type` conditional `.in`                                     | PASS   |
| CI Guards 1–6 green                                                        | PASS   |
| Full `vitest run tests/unit` green                                         | PASS (60/60) |

## Deviations from Plan

### Rule 3 — Fixed Blocking Issues

**1. [Rule 3] svelte-check `.catch` on supabase PromiseLike is pre-existing**
- **Found during:** Task 2 type-check
- **Issue:** After adding `distinctSalesTypesP`/`distinctPaymentMethodsP` with the same `.then().catch()` pattern used elsewhere in the loader, `svelte-check` reports `Property 'catch' does not exist on type 'PromiseLike<T>'` at 2 new lines.
- **Baseline check:** `git stash && svelte-check` on pre-change HEAD shows the SAME error category already exists at 4 other `.then().catch()` chains (`freqP`, `nvrP`, `retentionP`, `ltvP`). Total went from 12 errors (baseline) → 14 (after refactor). The 2 new errors match the existing convention exactly.
- **Fix:** None — matching existing convention is correct; upgrading the whole supabase-js `.then/.catch` pattern is out of scope for this plan and would affect 6 chains in unrelated code paths. Tracked as a known wart in the loader, separate from Phase 6 scope.
- **Impact:** No runtime change; `.catch` works correctly at runtime because the supabase-js builder implements a real `PromiseLike.then` returning a real Promise under the hood. All 60 unit tests pass; Guards 1–6 clean.

### Rule 1 — Auto-Fixed Bugs

None — tests went from 5 failing → 6 passing on the first GREEN pass.

### Rule 2 — Auto-Added Functionality

None — plan spec covered everything needed.

## Commits

| Hash       | Task   | Message                                                              |
| ---------- | ------ | -------------------------------------------------------------------- |
| `083184c`  | Task 1 | feat(06-03): add transactions_filterable_v wrapper view              |
| `2ef33a9`  | Task 2 | test(06-03): add failing loader integration tests for filter refactor (RED) |
| `1da636f`  | Task 2 | feat(06-03): refactor loader to use parseFilters + transactions_filterable_v (GREEN) |

## Downstream Consumers

Plan 06-04 (FilterBar component) can now consume directly from page data:
- `data.filters` — current FiltersState for dropdown/chip reflection
- `data.distinctSalesTypes` — dropdown options for sales_type filter
- `data.distinctPaymentMethods` — dropdown options for payment_method filter
- `data.window` — the resolved chip window (custom dates honored)

The single-file loader choke point means any later filter (country, repeater) only needs to add a zod field + a `.in()` call — no wrapper-view changes, no new queries.

## Known Stubs

None — this plan ships pure data-layer refactor. No UI changes, no hardcoded empties. `distinctSalesTypes` and `distinctPaymentMethods` are live arrays from the DB (may be empty if tenant has no data, which is correct behavior).

## Self-Check: PASSED

- `supabase/migrations/0018_transactions_filterable_v.sql` FOUND
- `tests/unit/pageServerLoader.test.ts` FOUND
- `src/routes/+page.server.ts` contains `parseFilters(url)` (verified via grep)
- `src/routes/+page.server.ts` contains `transactions_filterable_v` x6 (verified)
- `src/routes/+page.server.ts` contains `customToRange` (verified)
- Commit `083184c` FOUND
- Commit `2ef33a9` FOUND
- Commit `1da636f` FOUND
- 60/60 unit tests passing
- Migration applied on DEV (supabase db push succeeded; dry-run + push both green)
- All 6 CI guards clean
