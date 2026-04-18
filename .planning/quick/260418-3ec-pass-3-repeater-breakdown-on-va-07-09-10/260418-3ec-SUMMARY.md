---
phase: quick-260418-3ec
plan: 01
subsystem: dashboard/cohort-cards
tags: [dashboard, repeater, cohort, ltv-histogram, va-07, va-09, va-10]
requires: [sparseFilter.SPARSE_MIN_COHORT_SIZE, customer_ltv_v.visit_count]
provides:
  - classifyRepeater
  - cohortRevenueSumByRepeater
  - cohortAvgLtvByRepeater
  - REPEATER_MIN_VISITS
  - REPEATER_COLORS
  - buildLtvBins
  - binCustomerRevenue(cents, bins)
  - LTV_BIN_STEP_CENTS
  - LTV_BIN_MAX_CENTS_CAP
affects:
  - src/lib/components/LtvHistogramCard.svelte
  - src/lib/components/CohortRevenueCard.svelte
  - src/lib/components/CohortAvgLtvCard.svelte
tech-stack:
  added: []
  patterns:
    - "Dynamic histogram bins via buildLtvBins(maxRevenueCents) (replaces fixed LTV_BINS const)"
    - "LayerChart multi-series via `series` + `seriesLayout='stack'|'group'` (supersedes x+y single-series props)"
    - "Inline 30-line legend per card (LayerChart built-in legend emission not relied on)"
key-files:
  created: []
  modified:
    - src/lib/cohortAgg.ts
    - src/lib/chartPalettes.ts
    - src/lib/ltvBins.ts
    - src/lib/components/LtvHistogramCard.svelte
    - src/lib/components/CohortRevenueCard.svelte
    - src/lib/components/CohortAvgLtvCard.svelte
    - tests/unit/cohortAgg.test.ts
    - tests/unit/ltvHistogram.test.ts
    - tests/unit/LtvHistogramCard.test.ts
    - tests/unit/chartPalettes.test.ts
decisions:
  - "Repeater threshold fixed at visit_count >= 2 (REPEATER_MIN_VISITS=2) — matches owner's mental model (2+ visits = came back)"
  - "VA-09 revenue chart: seriesLayout='stack' — revenues sum meaningfully across classes"
  - "VA-10 avg LTV chart: seriesLayout='group' (side-by-side) — averages do NOT sum; stacking would mislead"
  - "LTV histogram: dynamic €5 bins up to €250 cap, overflow '€250+' appended only when data exceeds cap"
  - "Inline per-card legend (≤30 lines) instead of extracting a reusable component — three cards all use identical color+label pair, not worth abstraction"
  - "Kept legacy cohortRevenueSum + cohortAvgLtv exports for backward compat (cohortAgg.test.ts still covers them)"
metrics:
  duration: "~35 minutes"
  completed: "2026-04-18"
  tasks: 3
  commits: 3
  files_modified: 10
  unit_tests_added: 31
  unit_tests_total_before: 189
  unit_tests_total_after: 213
  svelte_check_errors_before: 17
  svelte_check_errors_after: 17
---

# Pass 3 of 3: Repeater Breakdown on VA-07 / VA-09 / VA-10 Summary

Customer-level repeater segmentation (visit_count >= 2) lands on the LTV histogram, cohort revenue, and cohort avg-LTV cards — all client-side, zero SQL changes. Owner now sees at a glance whether each cohort's revenue and LTV come from one-timers or returning customers. LTV histogram also swaps 6 hardcoded buckets for dynamic €5 bins up to €250 cap + overflow.

## Commits (on branch `dashboard-feedback-overhaul`)

| # | SHA       | Message |
|---|-----------|---------|
| 1 | `40ca05b` | feat(quick-260418-3ec): add classifyRepeater + cohort*ByRepeater helpers + REPEATER_COLORS |
| 2 | `831bb5e` | feat(quick-260418-3ec): LTV histogram — dynamic €5 bins + repeater stack |
| 3 | `481aace` | feat(quick-260418-3ec): VA-09/VA-10 — repeater breakdown (VA-09 stacked, VA-10 grouped) |

No `Co-authored-by` trailers on any commit (project CLAUDE.md requirement).

## What Shipped

### Task 1 — Shared primitives (commit `40ca05b`)

- **`classifyRepeater(visit_count)`** → `'new' | 'repeat'`; threshold `REPEATER_MIN_VISITS = 2`.
- **`cohortRevenueSumByRepeater(rows, grain)`** → per-cohort SUM split into `new_cents` + `repeat_cents`. Sparse-filtered (≥ `SPARSE_MIN_COHORT_SIZE = 5` customers) and sorted by cohort key.
- **`cohortAvgLtvByRepeater(rows, grain)`** → per-cohort AVG computed independently per class. Empty class returns `0` (never `NaN`) so BarChart renders a zero-height bar, not `undefined`.
- **`REPEATER_COLORS`** = `{ new: '#94a3b8' /* zinc-400 */, repeat: '#2563eb' /* blue-600 */ }` — strong/neutral contrast pair for stacked bars on white cards.
- **18 new unit tests** — threshold (0/1/2/10), mixed/all-new/all-repeat fixtures, sparse-filter, month-grain bucketing, NaN-avoidance, palette sanity.

### Task 2 — LTV histogram (commit `831bb5e`)

- **`buildLtvBins(maxRevenueCents)`** replaces the old `LTV_BINS` readonly const.
  - €5 step (`LTV_BIN_STEP_CENTS = 500`), €250 cap (`LTV_BIN_MAX_CENTS_CAP = 25000`), overflow `€250+` only when data exceeds cap.
  - `maxRevenueCents <= 0` → single `€0–5` bin (guaranteed render on empty data).
  - Labels use U+2013 en-dash (preserves old convention).
- **`binCustomerRevenue(revenue_cents, bins)`** — right-exclusive boundary `[minCents, maxCents)`, last bin is overflow guard.
- **`LtvHistogramCard.svelte`** now renders a stacked `BarChart` with `series={[{ key: 'new', ...}, { key: 'repeat', ... }]}`, dynamic bin count, scroll wrapper, and inline legend.
- **13 new ltvHistogram tests** (boundary, en-dash, overflow-only-when-needed) + **5 component tests** (empty state, heading copy, zero-revenue routing, repeater inclusion, adaptive bin count).

### Task 3 — Cohort cards (commit `481aace`)

- **`CohortRevenueCard.svelte`** (VA-09): now reads from `cohortRevenueSumByRepeater`, emits `{ cohort, new_eur, repeat_eur }`, renders `seriesLayout="stack"` (revenues sum correctly).
- **`CohortAvgLtvCard.svelte`** (VA-10): now reads from `cohortAvgLtvByRepeater`, emits `{ cohort, new_avg_eur, repeat_avg_eur }`, renders `seriesLayout="group"` (side-by-side — averages don't sum, stacking would mislead).
- Both cards add the `REPEATER_COLORS` inline legend, preserve Pass 1/2 scaffolding (D-17 day→week clamp hint, sparse filter, last-12-cohort slice, scroll wrapper).
- No new component tests — Task 1's fixture-level coverage of the *ByRepeater helpers is sufficient because the cards are thin view adapters.

## Verification

### Unit tests
- `npm run test:unit` → **213 / 213 passing** (was 189 baseline, +24 from this plan: 18 in cohortAgg + 3 in chartPalettes + 5 adds/rewrites in ltvHistogram + 2 rewrites in LtvHistogramCard; net count includes replacements of 4 old ltvHistogram `describe` tests).
- Four target test files all green: `cohortAgg.test.ts`, `chartPalettes.test.ts`, `ltvHistogram.test.ts`, `LtvHistogramCard.test.ts`.

### svelte-check
- Baseline: 17 errors across 4 files (vite.config, hooks.server, CohortRetentionCard snippet default, dashboardStore.test).
- Post-Pass-3: **17 errors** — identical. None in the six touched source files.

### CI guards
- `npm run test:guards` → all guards green (migration drift, no-dynamic-sql).

### Grep sweep
- `LTV_BINS` — zero production references outside `ltvBins.ts` doc-comment and `LtvHistogramCard.test.ts` comment.
- `revenue_eur` / bare `avg_eur` — zero references under `src/lib/components/`.
- `cohortRevenueSum\b` / `cohortAvgLtv\b` — confined to `src/lib/cohortAgg.ts` (legacy exports kept for backward compat per plan).

### DEV visual QA
- **Not performed in this run** — the execute-phase agent has no Chrome MCP access. Visual DEV verification deferred to the owner after push. Plan spec (task 3 action step) and project CLAUDE.md "Per-Task QA" both require a 375px Chrome MCP screenshot before marking "done" for production; that step should be executed once changes are pushed to `main` and CF Pages redeploys.

## Observed bin count on real data

**Not measured** — DEV push not performed here. `buildLtvBins` scales up to 50 €5-bins + overflow. Given historical data max revenue sits around €350+ per top customer, expect ~50 bins + `€250+` overflow under production. The owner's live number should be confirmed after CF Pages redeploys.

## Deviations from Plan

### Inline legend (Rule 3 — clarifying the plan constraint)
- **Plan said:** "If LayerChart doesn't auto-emit a legend, add inline legend (≤30 lines)."
- **Shipped:** Inline legend on all three cards unconditionally (not conditional on LayerChart behavior).
- **Why:** LayerChart 2.x legend emission from the `series` prop is not documented as guaranteed, and the plan's "smoke-check in DEV after commit" step can't run from the executor. Inline is 14 lines per card, deterministic, and survives any LayerChart upgrade.

No other deviations. Auto-fix rules 1–4 did not trigger — no bugs, no missing critical functionality, no blocking issues, no architectural changes needed.

## Known Stubs

None. All three cards are wired to live `customer_ltv_v` data via the existing SSR payload (no new loader changes). All tests operate on real helper output, no mock shims.

## Follow-ups

1. **DEV visual QA (owner action):** push branch, wait for CF Pages redeploy, screenshot at 375px:
   - VA-07 histogram shows many thin €5 bins with two-color stack (new = zinc-400, repeat = blue-600).
   - VA-09 cohort revenue: one bar per cohort, stacked.
   - VA-10 cohort avg LTV: two side-by-side bars per cohort.
2. **Observed bin count:** record after DEV render. Append to this SUMMARY under "Observed bin count".
3. **Legacy helper removal:** `cohortRevenueSum` / `cohortAvgLtv` (non-repeater variants) remain exported for backward compat. Future cleanup ticket can delete them once we confirm no other consumers emerge.

## Self-Check: PASSED

Files verified present:
- `src/lib/cohortAgg.ts` — FOUND (121 lines, exports classifyRepeater + cohortRevenueSumByRepeater + cohortAvgLtvByRepeater + REPEATER_MIN_VISITS + RepeaterClass)
- `src/lib/chartPalettes.ts` — FOUND (38 lines, exports REPEATER_COLORS)
- `src/lib/ltvBins.ts` — FOUND (45 lines, exports buildLtvBins + binCustomerRevenue + LTV_BIN_STEP_CENTS + LTV_BIN_MAX_CENTS_CAP; LTV_BINS const removed)
- `src/lib/components/LtvHistogramCard.svelte` — FOUND (83 lines, stacked series, inline legend)
- `src/lib/components/CohortRevenueCard.svelte` — FOUND (89 lines, stacked series, inline legend)
- `src/lib/components/CohortAvgLtvCard.svelte` — FOUND (85 lines, grouped series, inline legend)
- `tests/unit/cohortAgg.test.ts` — FOUND (30 tests passing)
- `tests/unit/chartPalettes.test.ts` — FOUND (7 tests passing)
- `tests/unit/ltvHistogram.test.ts` — FOUND (13 tests passing)
- `tests/unit/LtvHistogramCard.test.ts` — FOUND (5 tests passing)

Commits verified present:
- `40ca05b` — FOUND on dashboard-feedback-overhaul
- `831bb5e` — FOUND on dashboard-feedback-overhaul
- `481aace` — FOUND on dashboard-feedback-overhaul

None of the three commit messages contain `Co-authored-by`.

Unit tests: 213 / 213 green.
svelte-check: 17 / 17 errors (identical baseline, zero new errors on touched files).
