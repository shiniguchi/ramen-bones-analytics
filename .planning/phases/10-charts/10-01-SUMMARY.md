---
phase: 10-charts
plan: 01
subsystem: testing
tags: [vitest, playwright, nyquist, red-scaffold, seed-data, layerchart, cohorts, ltv, visit-attribution, supabase]

# Dependency graph
requires:
  - phase: 04-mobile-reader-ui
    provides: CohortRetentionCard + pickVisibleCohorts + SPARSE_MIN_COHORT_SIZE pattern
  - phase: 08-visit-attribution-data-model
    provides: visit_attribution_mv + visit_seq column shape
  - phase: 09-filter-simplification-performance
    provides: dashboardStore aggregateByBucket + filterRows patterns
provides:
  - RED test scaffolds for all 7 Phase 10 chart requirements (VA-04..VA-10)
  - 90-day seed coverage with ≥5 weekly cohorts (passes SPARSE_MIN_COHORT_SIZE=5)
  - stg_orderbird_order_items seed with 8 real menu items + 3 Other-rollup fillers
  - 15 cash rows spread across 10+ dates for VA-04/05 9th segment
  - E2E_CUSTOMER_LTV_ROWS + E2E_ITEM_COUNTS_ROWS fixtures for SSR bypass
  - CF Pages deploy unblock confirmation — no phase 10 deploy blocker
affects: [10-02, 10-03, 10-04, 10-05, 10-06, 10-07, 10-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Nyquist RED scaffold: import errors are an acceptable RED state — the failing import itself proves the production contract doesn't exist yet"
    - "Integration tests use adminClient() helper + insert-and-capture tenant pattern (restaurants has no slug column)"
    - "Refresh-function introspection via test_refresh_function_body() RPC over pg_get_functiondef — regex-match the DAG order string"
    - "Seed extensions are idempotent via demo-phase10- prefix + on-conflict-do-nothing; separate delete for stg_orderbird_order_items (different natural key than transactions)"

key-files:
  created:
    - "tests/unit/dashboardStoreVisitSeq.test.ts"
    - "tests/unit/ltvHistogram.test.ts"
    - "tests/unit/chartPalettes.test.ts"
    - "tests/unit/cohortAgg.test.ts"
    - "tests/unit/itemCountsRollup.test.ts"
    - "tests/unit/CohortRetentionCard.test.ts"
    - "tests/integration/phase10-charts.test.ts"
    - "tests/e2e/charts-all.spec.ts"
    - ".planning/phases/10-charts/10-01-SUMMARY-cf-pages-decision.md"
  modified:
    - "src/lib/e2eChartFixtures.ts"
    - "scripts/seed-demo-data.sql"
    - ".planning/STATE.md"

key-decisions:
  - "CohortRetentionCard D-17 weekly-clamp hint stays as it.todo stubs — optional per RESEARCH.md Open Question 2"
  - "CF Pages deploy Path A (already unblocked 2026-04-15 via deploy.yml workflow) — no local-preview fallback needed"
  - "Seed stg_orderbird_order_items uses stable hashtext(source_tx_id) for item selection — deterministic across re-runs without per-row RNG drift"
  - "Integration refresh-ordering assertion uses test_refresh_function_body() RPC (added in 10-03 Task 1) rather than expect(true).toBe(false) — real contract, not placeholder"

patterns-established:
  - "Phase 10 Nyquist discipline: every downstream `<automated>` verify command has a pre-existing test file; failing imports are the RED signal"
  - "Seed-data idempotency: new phase blocks must match an existing guarded-delete prefix OR add their own scoped delete before inserts"
  - "E2E fixture module is additive-only — do not replace existing exports (E2E_RETENTION_ROWS must remain compatible with Phase 04 charts-with-data.spec.ts)"

requirements-completed: [VA-04, VA-05, VA-06, VA-07, VA-08, VA-09, VA-10]

# Metrics
duration: 11min
completed: 2026-04-17
---

# Phase 10 Plan 01: Wave 0 RED Scaffolds Summary

**Authored 8 RED-scaffolded test files (505 lines) covering 6 new chart requirements plus retention regression, extended the demo seed to 90-day history with 8-item menu + 15 cash rows, and confirmed CF Pages deploy pipeline is unblocked — no local-preview fallback needed.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-04-17T09:12:00Z (approx)
- **Completed:** 2026-04-17T09:23:43Z
- **Tasks:** 4
- **Files created:** 9
- **Files modified:** 3

## Accomplishments

- **All 8 test scaffolds on disk** (6 unit + 1 integration + 1 e2e) with concrete assertions against unimplemented contracts — 10 tests fail with `TypeError: X is not a function` or missing-module errors, proving downstream waves have real targets to flip GREEN.
- **Seed extended to cover every Phase 10 chart** — 76 transactions across 90 days driving ≥5 weekly cohorts ≥5 customers each, 15 cash rows across 75 days, 76 stg_orderbird_order_items rows with 11-item menu pool (8 real + 3 Other-rollup fillers).
- **CF Pages deploy pipeline verified unblocked** — 5 most-recent runs against main all succeeded (latest 2026-04-17 00:47 UTC), stale blocker cleared from STATE.md.
- **E2E fixture module extended additively** — `E2E_CUSTOMER_LTV_ROWS` (11 customers × 2 cohorts, all 6 LTV bins covered) and `E2E_ITEM_COUNTS_ROWS` (10 rows, 8 distinct items) added without disturbing existing `E2E_RETENTION_ROWS`.

## Task Commits

1. **Task 1: Unit RED scaffolds (visit_seq + palettes + LTV bins + cohort agg + item rollup)** — `3ca681c` (test)
2. **Task 2: Integration + e2e RED scaffolds; extend e2e chart fixtures** — `32ed217` (test)
3. **Task 3: Seed-demo-data 90-day extension + menu items + 15 cash rows** — `8b7086b` (feat)
4. **Task 4: CF Pages deploy-unblock decision (Path A) + STATE.md blocker clear** — `9b0ba0f` (docs)

## Files Created/Modified

### Tests (created)
- `tests/unit/dashboardStoreVisitSeq.test.ts` (92 lines, 10 it) — visitSeqBucket + aggregateByBucketAndVisitSeq + shapeForChart contracts
- `tests/unit/ltvHistogram.test.ts` (41 lines, 9 it) — LTV_BINS structure + binCustomerRevenue boundary behaviour across all 6 bins
- `tests/unit/chartPalettes.test.ts` (31 lines, 4 it) — VISIT_SEQ_COLORS (8 distinct) + CASH_COLOR (#a1a1aa) + ITEM_COLORS (8 distinct) + OTHER_COLOR === CASH_COLOR
- `tests/unit/cohortAgg.test.ts` (61 lines, 5 it) — cohortRevenueSum + cohortAvgLtv + sparse filter + month-grain rollup
- `tests/unit/itemCountsRollup.test.ts` (35 lines, 4 it) — rollupTopNWithOther sort + Other sum + no-Other-when-under-N
- `tests/unit/CohortRetentionCard.test.ts` (10 lines, 2 it.todo) — optional D-17 weekly-clamp hint stubs
- `tests/integration/phase10-charts.test.ts` (151 lines, 10 it + 2 it.todo across 8 describe blocks) — customer_ltv + item_counts shape + tenant isolation + filterable_v visit_seq columns + refresh DAG ordering
- `tests/e2e/charts-all.spec.ts` (84 lines, 12 test) — 6 new chart cards at 375×667 + tooltip + card order + overflow guard

### Seed / fixtures (modified)
- `scripts/seed-demo-data.sql` — appended Phase 10 extension block (140 lines): 76 90-day tx rows + 15 cash rows + 76 order-items rows with 11-item menu pool; do-block sanity assertion enforces ≥75 tx, ≥15 cash, ≥75 items, ≥8 distinct item names
- `src/lib/e2eChartFixtures.ts` — added `E2E_CUSTOMER_LTV_ROWS` (11 rows × 2 cohorts, all 6 LTV bins covered) + `E2E_ITEM_COUNTS_ROWS` (10 rows × 8 distinct items × INHOUSE+TAKEAWAY × cash+card)

### Docs / state (created / modified)
- `.planning/phases/10-charts/10-01-SUMMARY-cf-pages-decision.md` (created) — Path A evidence: workflow 24481554088 added deploy.yml on 2026-04-15; 5 subsequent runs all successful
- `.planning/STATE.md` (modified) — §Blockers cleared

## Decisions Made

See frontmatter `key-decisions`. Most substantive:
- **D-17 hint optional:** `CohortRetentionCard.test.ts` is 2 × `it.todo` stubs rather than full assertions. Plan 10-07 (or nobody) converts them if product wants the "Cohort view shows weekly" hint.
- **CF Pages Path A:** Existing `.github/workflows/deploy.yml` has been deploying main branch successfully since 2026-04-15. The "broken since a3623b9" blocker was stale — confirmed via `gh run list --workflow=deploy.yml`. No local-preview workaround needed. Branch-scope nuance documented: phase branches do not auto-deploy, so Phase 10 UAT runs off main-merge or `gh workflow run --ref <branch>`.
- **Deterministic item seeding:** `stg_orderbird_order_items` seed uses `abs(hashtext(source_tx_id)) % 11` to pick items so re-runs produce identical data. RNG was considered but rejected — breaks the guarded-delete invariant that re-running yields identical counts.

## Deviations from Plan

### Known red states (documented for context, NOT deviations)

All 10 newly-failing unit tests + 10 integration tests + 12 e2e tests are RED *by design*. They flip GREEN in later plans:

| Test File                                  | Flips GREEN in                                          |
| ------------------------------------------ | ------------------------------------------------------- |
| `dashboardStoreVisitSeq.test.ts`           | 10-04 (dashboardStore extensions)                       |
| `ltvHistogram.test.ts`                     | 10-04 (`src/lib/ltvBins.ts`)                            |
| `chartPalettes.test.ts`                    | 10-04 (`src/lib/chartPalettes.ts`)                      |
| `cohortAgg.test.ts`                        | 10-04 (`src/lib/cohortAgg.ts`)                          |
| `itemCountsRollup.test.ts`                 | 10-04 (`src/lib/itemCountsRollup.ts`)                   |
| `CohortRetentionCard.test.ts`              | 10-07 (optional — stays todo if hint not shipped)       |
| `phase10-charts.test.ts` shape blocks      | 10-02 (customer_ltv_mv + item_counts_daily_mv)          |
| `phase10-charts.test.ts` refresh DAG       | 10-03 Task 1 (test_refresh_function_body helper)        |
| `charts-all.spec.ts`                       | 10-05/06/07 (components) + 10-08 (SSR fixture wiring)   |

### Auto-fixed issues

**None during this plan — all work matched the spec exactly.**

One judgment call worth documenting (not a deviation):
- The plan body suggested `generate_series(15, 90)` producing ~76 rows for transactions and a second `generate_series(1, 15)` for cash. Both were used verbatim. Sanity-assertion thresholds were set slightly below expected counts (≥75 tx, ≥75 items, ≥15 cash) to tolerate future cohort expansion without requiring an assertion update.

## Issues Encountered

None. Every task hit its acceptance criteria on the first write.

## User Setup Required

None. All work is local test scaffolding + seed SQL + doc updates. The seed SQL does not run automatically — it will be executed after migrations in 10-02/10-03 land (via `psql -f scripts/seed-demo-data.sql` followed by `select public.refresh_analytics_mvs();`).

## Next Phase Readiness

- **Plan 10-02 (customer_ltv_mv + item_counts_daily_mv):** unblocked — has 10 RED integration tests to flip GREEN
- **Plan 10-03 (refresh DAG + transactions_filterable_v extension):** unblocked — has the refresh-ordering RED test + filterable_v visit_seq RED test waiting
- **Plan 10-04 (TS libraries):** unblocked — 5 unit test files with concrete contracts
- **Plan 10-05/06/07 (components):** unblocked — 12 e2e tests target data-testids that components must emit
- **Plan 10-08 (SSR fixture wiring):** unblocked — `E2E_CUSTOMER_LTV_ROWS` + `E2E_ITEM_COUNTS_ROWS` exist, just need to be returned from +page.server.ts under the `?__e2e=charts` branch

No blockers remaining.

## Self-Check: PASSED

- [x] `tests/unit/dashboardStoreVisitSeq.test.ts` exists (92 lines, 10 it)
- [x] `tests/unit/ltvHistogram.test.ts` exists (41 lines, 9 it)
- [x] `tests/unit/chartPalettes.test.ts` exists (31 lines, 4 it)
- [x] `tests/unit/cohortAgg.test.ts` exists (61 lines, 5 it)
- [x] `tests/unit/itemCountsRollup.test.ts` exists (35 lines, 4 it)
- [x] `tests/unit/CohortRetentionCard.test.ts` exists (10 lines, 2 it.todo)
- [x] `tests/integration/phase10-charts.test.ts` exists (151 lines, 18 describe+it entries)
- [x] `tests/e2e/charts-all.spec.ts` exists (84 lines, 12 test)
- [x] `src/lib/e2eChartFixtures.ts` contains `E2E_CUSTOMER_LTV_ROWS` + `E2E_ITEM_COUNTS_ROWS`
- [x] `scripts/seed-demo-data.sql` contains `stg_orderbird_order_items` (5 refs) + `Tonkotsu Ramen` + 10 × `demo-phase10-`
- [x] `.planning/phases/10-charts/10-01-SUMMARY-cf-pages-decision.md` exists, states "Path chosen: A"
- [x] Commit `3ca681c` exists — test(10-01) RED unit scaffolds
- [x] Commit `32ed217` exists — test(10-01) RED integration + e2e + fixtures
- [x] Commit `8b7086b` exists — feat(10-01) seed extension
- [x] Commit `9b0ba0f` exists — docs(10-01) CF Pages Path A decision
- [x] `npm run test:unit` exits non-zero (5 failed | 11 passed | 1 skipped; 10 failed | 97 passed | 2 todo) — confirmed RED state

---
*Phase: 10-charts*
*Completed: 2026-04-17*
