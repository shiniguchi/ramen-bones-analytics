---
phase: 10
slug: charts
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sourced from `.planning/phases/10-charts/10-RESEARCH.md` §"Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (unit + integration)** | Vitest `^4.1.4` |
| **Framework (e2e)** | `@playwright/test ^1.59.1` at 375×667 mobile-chrome |
| **Config files** | `vitest.config.ts` (per package.json scripts), `playwright.config.ts` verified |
| **Quick run command** | `npm run test:unit` |
| **Integration command** | `npm run test:integration` (needs TEST Supabase project) |
| **E2E command** | `npm run test:e2e` (with `E2E_FIXTURES=1` pre-set in `playwright.config.ts:44`) |
| **Guards command** | `npm run test:guards` |
| **Full suite command** | `npm test && npm run test:e2e && npm run test:guards` |
| **Estimated runtime (full)** | ~120 seconds (unit ~10s, integration ~40s, e2e ~60s, guards ~5s) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit && npm run test:guards` (≤30s total)
- **After every plan wave:** Run full suite — `npm test && npm run test:e2e && npm run test:integration && npm run test:guards`
- **Before `/gsd:verify-work`:** Full suite must be green AND manual 375px UAT on DEV (CF Pages preview)
- **Max feedback latency:** 30 seconds (per-task); 120 seconds (per-wave)

---

## Per-Task Verification Map

> Task IDs will be filled in after `gsd-planner` produces PLAN.md files. Each plan task MUST map to at least one row below.

| Req ID | Behavior | Test Type | Automated Command | File Exists | Task ID | Status |
|--------|----------|-----------|-------------------|-------------|---------|--------|
| VA-04 | Calendar revenue stacked by visit_seq, 9 segments, honors both filters, respects grain | unit (aggregator) | `npx vitest run tests/unit/dashboardStoreVisitSeq.test.ts` | ❌ W0 | TBD | ⬜ pending |
| VA-04 | Calendar revenue renders at 375px with correct bar count + segment colors | e2e (visual) | `npx playwright test tests/e2e/charts-all.spec.ts -g "VA-04"` | ❌ W0 | TBD | ⬜ pending |
| VA-05 | Calendar customer counts (tx_count metric instead of revenue) | unit (aggregator) | same `dashboardStoreVisitSeq.test.ts` with `metric='tx_count'` | ❌ W0 | TBD | ⬜ pending |
| VA-05 | Calendar counts renders at 375px | e2e | `npx playwright test tests/e2e/charts-all.spec.ts -g "VA-05"` | ❌ W0 | TBD | ⬜ pending |
| VA-06 | CohortRetentionCard carries forward (existing test) | e2e (regression) | `npx playwright test tests/e2e/charts-with-data.spec.ts` | ✅ exists | TBD | ⬜ pending |
| VA-06 | Optional: inline weekly-clamp hint when global grain=day (D-17) | unit (component) | `npx vitest run tests/unit/CohortRetentionCard.test.ts` | ❌ W0 | TBD | ⬜ pending |
| VA-07 | LTV histogram 6 bins, correct customer counts per bin | unit | `npx vitest run tests/unit/ltvHistogram.test.ts` | ❌ W0 | TBD | ⬜ pending |
| VA-07 | LTV histogram at 375px — empty / sparse / populated | e2e | `npx playwright test tests/e2e/charts-all.spec.ts -g "VA-07"` | ❌ W0 | TBD | ⬜ pending |
| VA-08 | `item_counts_daily_mv` joins item_name with transactions + visit_attribution | integration (DB shape) | `npx vitest run tests/integration/phase10-charts.test.ts -t "item_counts_daily_mv"` | ❌ W0 | TBD | ⬜ pending |
| VA-08 | Top-8 + "Other" client-side rollup | unit | `npx vitest run tests/unit/itemCountsRollup.test.ts` | ❌ W0 | TBD | ⬜ pending |
| VA-08 | Renders at 375px | e2e | `npx playwright test tests/e2e/charts-all.spec.ts -g "VA-08"` | ❌ W0 | TBD | ⬜ pending |
| VA-09 | Cohort total revenue GROUP BY client-side + sparse filter | unit | `npx vitest run tests/unit/cohortAgg.test.ts -t "revenue"` | ❌ W0 | TBD | ⬜ pending |
| VA-09 | Cohort total revenue at 375px with sparse-hint | e2e | `npx playwright test tests/e2e/charts-all.spec.ts -g "VA-09"` | ❌ W0 | TBD | ⬜ pending |
| VA-10 | Cohort avg LTV GROUP BY client-side | unit | `npx vitest run tests/unit/cohortAgg.test.ts -t "avg"` | ❌ W0 | TBD | ⬜ pending |
| VA-10 | Renders at 375px | e2e | `npx playwright test tests/e2e/charts-all.spec.ts -g "VA-10"` | ❌ W0 | TBD | ⬜ pending |
| — | `customer_ltv_mv` tenant isolation (tenant A can't read tenant B) | integration | `npx vitest run tests/integration/phase10-charts.test.ts -t "tenant isolation"` | ❌ W0 | TBD | ⬜ pending |
| — | `item_counts_daily_mv` tenant isolation | integration | same file, same describe | ❌ W0 | TBD | ⬜ pending |
| — | `refresh_analytics_mvs()` runs new MVs in correct DAG order | integration | `npx vitest run tests/integration/phase10-charts.test.ts -t "refresh ordering"` | ❌ W0 | TBD | ⬜ pending |
| — | `transactions_filterable_v` exposes `visit_seq` + `card_hash` columns | integration | `npx vitest run tests/integration/phase10-charts.test.ts -t "visit_seq column"` | ❌ W0 | TBD | ⬜ pending |
| — | CI guard: no raw `customer_ltv_mv` or `item_counts_daily_mv` refs from `src/` | guards | `bash scripts/ci-guards.sh` | ✅ exists (regex update may be needed) | TBD | ⬜ pending |
| — | Raw MVs still REVOKED from authenticated role | integration | extend `tests/integration/tenant-isolation.test.ts` | ✅ exists (extend) | TBD | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

**Test files to create (red-scaffolding before implementation):**

- [ ] `tests/unit/dashboardStoreVisitSeq.test.ts` — `aggregateByBucketAndVisitSeq()` + `visitSeqBucket()` + `shapeForChart()` pure-function tests. Fixture with visit_seq=1..9+NULL across 2 weeks. ~8 tests.
- [ ] `tests/unit/ltvHistogram.test.ts` — `LTV_BINS` coverage + `binCustomerRevenue()` boundary tests (0, 999, 1000, 2499, 25000, MAX). ~6 tests.
- [ ] `tests/unit/chartPalettes.test.ts` — `VISIT_SEQ_COLORS.length === 8`, colors distinct, `ITEM_COLORS.length === 8`. ~3 tests.
- [ ] `tests/unit/cohortAgg.test.ts` — client-side GROUP BY revenue SUM + AVG + sparse-filter integration. ~5 tests.
- [ ] `tests/unit/itemCountsRollup.test.ts` — top-8 + "Other" rollup helper for VA-08. ~4 tests.
- [ ] `tests/unit/CohortRetentionCard.test.ts` (optional) — weekly-clamp hint when global grain=day. ~2 tests.
- [ ] `tests/integration/phase10-charts.test.ts` — new MV shape + tenant isolation + refresh ordering + view extension column checks. Covers:
  - `customer_ltv_mv` shape (one row per customer, correct cohort_week)
  - `customer_ltv_v` 2-tenant isolation (Phase 3 fixture pattern)
  - `item_counts_daily_mv` shape (row per date × item × sales_type × is_cash)
  - `item_counts_daily_v` 2-tenant isolation
  - `transactions_filterable_v` has `visit_seq` + `card_hash` columns
  - `refresh_analytics_mvs()` calls all 5 MVs in DAG order
  - ~10 tests.
- [ ] `tests/e2e/charts-all.spec.ts` — 6 new charts × 3 states (empty, sparse, populated) at 375px, tap-tooltip smoke, no console errors. ~18 tests.
- [ ] `src/lib/e2eChartFixtures.ts` extension — add `E2E_CUSTOMER_LTV_ROWS`, `E2E_ITEM_COUNTS_ROWS`; extend SSR bypass in `+page.server.ts` lines 20–43.
- [ ] `scripts/seed-demo-data.sql` extension — add 90-day history, 15+ cash rows, `stg_orderbird_order_items` seed.

**Framework install:** None — Vitest + Playwright already configured.

**Guards update:**

- [ ] `scripts/ci-guards.sh` Guard 1 regex allowlist extension — confirm new MV names (`customer_ltv_mv`, `item_counts_daily_mv`) are permitted inside `supabase/migrations/` but BLOCKED from `src/`. Verify with a negative test.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visit-count stacked bar color gradient perceptual correctness (light→dark blue reads as "new→regular") | VA-04 / D-06 | Subjective color perception at 375px physical device | Open DEV dashboard on actual mobile phone, scroll to Calendar Revenue chart, confirm 1st-timer bars are visibly light-blue and 8x+ are visibly dark-blue without needing the tooltip. |
| Tap-to-reveal tooltips feel responsive on touch | VA-04/05/07/08/09/10 / D-20 | Automated tests click elements; real finger taps differ | On DEV preview, tap each stacked-bar segment and each histogram bar. Tooltip appears within 100ms and stays visible until tap-elsewhere. |
| 9-color + gray (cash) legend at 375px is readable | VA-04 / D-08 | Perceptual | Visual check — gradient legend bar + "Cash" swatch fit inline under each calendar chart without overflow. |
| Lazy-mount below-fold (if implemented per D-11) doesn't produce pop-in flash | VA-04..10 | Animation perception | Scroll through dashboard on real phone; charts below fold appear cleanly, no layout shift. |
| Top-8 + "Other" in item chart is "obviously the right 8" | VA-08 / D-14 | Requires domain knowledge of the owner's menu | Owner review: "do these 8 look like my actual best-sellers?" |
| CF Pages preview pipeline renders latest commit | VA-04..10 / Phase Goal Success #7 | Existing blocker from Phase 6 — broken deploy pipeline since a3623b9 | See [## Blockers] below — must be unblocked before phase UAT closes. |

---

## Blockers (must resolve before phase passes)

1. **CF Pages deploy pipeline broken since commit `a3623b9`** — per STATE.md (Phase 6 blocker, still open). Affects Phase 10 in the same way: 375px visual verification on DEV is the Phase Goal success criterion #7, and currently DEV is stale behind ~30+ commits. Two options:
   - **Early unblock task** in Phase 10 plan (Wave 0 or Wave 1)
   - **Accept local-preview-only verification** in Phase 10, spin a separate gap-closure phase for CF Pages fix

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency <30s per-task
- [ ] CF Pages deploy blocker resolved (or path documented)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
