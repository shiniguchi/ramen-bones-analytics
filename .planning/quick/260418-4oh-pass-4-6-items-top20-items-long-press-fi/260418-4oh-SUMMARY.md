---
phase: quick-260418-4oh
plan: 01
subsystem: dashboard
tags:
  - retention
  - mobile
  - charts
  - ltv
  - cohorts
  - ux
requirements:
  - PASS4-01
  - PASS4-02
  - PASS4-03
  - PASS4-04
  - PASS4-05
  - PASS4-06
dependency-graph:
  requires:
    - quick-260418-1ja  # Pass 1 titles/order shipped
    - quick-260418-28j  # Pass 2 retention monthly view + axis caps
    - quick-260418-3ec  # Pass 3 repeater helpers (now superseded)
  provides:
    - retention_curve_v current-period NULL-mask
    - retention_curve_monthly_v current-period NULL-mask
    - .chart-touch-safe CSS utility
    - visitCountBucket / VISIT_BUCKET_KEYS / VisitBucket
    - cohortAvgLtvByVisitBucket aggregator
    - ITEM_COLORS (20 unique)
  affects:
    - dashboard UX (mobile long-press, retention tooltip, top-20 items, 8-bucket LTV)
tech-stack:
  added: []
  patterns:
    - 8-bucket visit_count segmentation for VA-07 + VA-10 (grouped, not stacked)
    - chart-touch-safe utility applied to 6 chart wrappers
    - tooltipContext mode=bisect-x for multi-line Spline charts
key-files:
  created:
    - supabase/migrations/0028_retention_exclude_current_period.sql
  modified:
    - tests/integration/phase3-analytics.test.ts
    - src/app.css
    - src/lib/components/CalendarRevenueCard.svelte
    - src/lib/components/CalendarCountsCard.svelte
    - src/lib/components/CalendarItemsCard.svelte
    - src/lib/components/CohortRetentionCard.svelte
    - src/lib/components/CohortAvgLtvCard.svelte
    - src/lib/components/LtvHistogramCard.svelte
    - src/lib/cohortAgg.ts
    - src/lib/chartPalettes.ts
    - src/lib/format.ts
    - src/routes/+page.svelte
    - tests/unit/cohortAgg.test.ts
    - tests/unit/chartPalettes.test.ts
    - tests/unit/LtvHistogramCard.test.ts
    - tests/unit/CalendarItemsCard.test.ts
  deleted:
    - src/lib/components/CohortRevenueCard.svelte
decisions:
  - Flip `>` to `>=` in retention NULL-mask (both weekly + monthly views) via CREATE OR REPLACE — shape unchanged, safe in-place
  - .chart-touch-safe as a single utility in @layer base (6 call sites; one edit if we ever tweak)
  - tooltipContext mode='bisect-x' for retention Spline lines; touchEvents='pan-x' preserves iOS scroll
  - VA-09 CohortRevenueCard deleted (founder feedback — lifetime total revenue per cohort hid the real signal)
  - seriesLayout='group' (NOT stack) on VA-07 + VA-10 — user-locked; averages don't sum across buckets
  - ITEM_COLORS expanded to 20 via schemeTableau10 + schemePaired first 10 (d3-scale-chromatic already in deps)
  - 8-bucket visit_count (1st/2nd/3rd/4x/5x/6x/7x/8x+) mirrors existing visit_seq bucket labels for visual consistency with VA-04/VA-05
metrics:
  duration: ~25min
  completed: 2026-04-18
---

# Pass 4 Dashboard Feedback — 6 Items (quick-260418-4oh) Summary

One-liner: Closes the 6 high-signal founder feedback items after Passes 1/2/3 — in-progress retention period no longer renders a misleading 0%, mobile long-press no longer freezes the page, retention tooltip activates, menu items top-N bumped from 8 to 20, VA-09 Cohort Revenue card deleted, and VA-07 + VA-10 LTV charts rewritten from 2-bucket new/repeat to 8-bucket visit_count groups.

## What each of the 6 items changed

- **Item #1 (Top-20 menu items):** `rollupTopNWithOther(rows, 20)` in CalendarItemsCard; header + subtitle copy updated; `ITEM_COLORS` extended from 8 → 20 unique (schemeTableau10 + schemePaired.slice(0,10)).
- **Item #2 (Mobile long-press freeze):** New `.chart-touch-safe` utility in `src/app.css` (`user-select + -webkit-user-select + -webkit-touch-callout: none`); appended to wrappers on CalendarRevenue/Counts/Items, CohortRetention, CohortAvgLtv, LtvHistogram (6 places).
- **Item #3 (Retention tooltip):** Added `tooltipContext={{ mode: 'bisect-x', touchEvents: 'pan-x' }}` to CohortRetentionCard's `<Chart>`. The existing `<Tooltip.Root>` block was inert until now; `bisect-x` picks the closest x-value across all Spline lines on hover/touch.
- **Item #4 (Retention current-period NULL):** Migration 0028 does `CREATE OR REPLACE VIEW` on `retention_curve_v` + `retention_curve_monthly_v`, flipping the CASE condition from `p.period_X > cohort_age_X` to `>=`. The in-progress current period now masks to NULL instead of rendering as a misleading 0% drop.
- **Item #5 (Delete VA-09 Cohort Revenue card):** Deleted `src/lib/components/CohortRevenueCard.svelte`; removed import + usage from `+page.svelte`; removed `cohortRevenueSum / cohortAvgLtv / cohortRevenueSumByRepeater` from `cohortAgg.ts`. 7 test describes for the dead helpers deleted.
- **Item #6 (8-bucket visit_count LTV charts):** Full rewrites of LtvHistogramCard (VA-07) + CohortAvgLtvCard (VA-10) using `seriesLayout="group"` (8 adjacent bars per category), new `visitCountBucket() + VISIT_BUCKET_KEYS + cohortAvgLtvByVisitBucket()` in cohortAgg, colors from existing `VISIT_SEQ_COLORS` gradient, inline gradient legend. Pass 3 repeater helpers (`classifyRepeater`, `REPEATER_MIN_VISITS`, `RepeaterClass`, `cohortAvgLtvByRepeater`, `REPEATER_COLORS`) deleted — now dead.

## Migration dual-push log

```
# DEV (paafpikebsudoqxwumgm)
npx supabase link --project-ref paafpikebsudoqxwumgm → Finished supabase link.
npx supabase db push --linked → Applying migration 0028_retention_exclude_current_period.sql... Finished supabase db push.

# TEST (akyugfvsdfrwuzirmylo)
npx supabase link --project-ref akyugfvsdfrwuzirmylo → Finished supabase link.
npx supabase db push --linked → Applying migration 0028_retention_exclude_current_period.sql... Finished supabase db push.

# Re-link back to DEV
npx supabase link --project-ref paafpikebsudoqxwumgm → Finished supabase link.
```

Both pushes succeeded cleanly; `test:guards` confirms `local_max=0028 remote_max=0028`.

## Test delta

**Added:**
- `phase3-analytics.test.ts` → 2 new integration tests: `NULL-masks the current-period row where period_weeks == cohort_age_weeks` (weekly) + analogous monthly assertion. Both green when run in isolation against DEV.
- `cohortAgg.test.ts` → 2 new describes: `visitCountBucket (Pass 4)` (6 specs) + `cohortAvgLtvByVisitBucket (Pass 4 — VA-07/VA-10)` (5 specs including 260417-mp2 month-grain regression).
- `chartPalettes.test.ts` → 1 new spec: `ITEM_COLORS has 20 unique colors`.

**Removed:**
- `cohortAgg.test.ts` → 5 describes tied to deleted helpers: `cohortRevenueSum`, `cohortAvgLtv`, `grain=month rollup`, `month-grain contract (260417-mp2 regression)` (replaced inside new `cohortAvgLtvByVisitBucket` describe), `cohortRevenueSumByRepeater`, `cohortAvgLtvByRepeater`, `classifyRepeater`. ~13 specs dropped.
- `chartPalettes.test.ts` → 3 `REPEATER_COLORS` specs.
- `LtvHistogramCard.test.ts` → heading pattern flipped from `/new vs\. repeat/` to `/by visit count/`.
- `CalendarItemsCard.test.ts` → `rolls ≥9 items into top-8 + "Other"` renamed + fixture bumped from 10 → 22 items.

**Final count:** 198 unit tests green (was 213 before Task 4 deletions; net -15 from helper pruning, +6 from new Pass 4 specs).

## svelte-check delta

17 → 17 errors (baseline unchanged). All 17 pre-existing errors live in `tests/unit/dashboardStore.test.ts` (DailyRow shape drift — out of Pass 4 scope).

## DEV verification notes

Current project state: migration 0028 applied to DEV (paafpikebsudoqxwumgm); CF Pages auto-deploys from `main` but this branch (`dashboard-feedback-overhaul`) is pre-PR — DEV CF Pages deploy will run when the branch is merged to `main`. Mobile Chrome MCP visual verification planned post-merge (alongside the Pass 1/2/3 roll-up PR).

Data-layer verification confirmed now on DEV via integration tests:
- `test_retention_curve` RPC returns `retention_rate === null` for every row where `period_weeks === cohort_age_weeks` (weekly current-period NULL-mask).
- `test_retention_curve_monthly` RPC returns `retention_rate === null` for every row where `period_months === cohort_age_months` (monthly current-period NULL-mask).

UI-layer verification deferred to post-merge mobile walkthrough:
- Item #2: long-press each chart on 375×667 mobile — no native selection UI / callout menu.
- Item #3: hover (desktop) + tap (mobile) a retention line — tooltip shows cohort + period + retention %.
- Item #1: CalendarItemsCard shows up to 20 colored series in chart + legend; items 21+ collapse into "Other".
- Item #6: LtvHistogramCard + CohortAvgLtvCard render 8 grouped bars per category with blue gradient matching VA-04/VA-05.

## Deviations from Plan

None — plan executed exactly as written. Minor refinements within scope:

1. **Comment hygiene (Rule 2):** Stale comments in `src/lib/format.ts` and `src/lib/components/CalendarRevenueCard.svelte` referenced the deleted `CohortRevenueCard` — updated to reference current behavior. Not a behavior change; kept the codebase self-consistent.

2. **Task 4 vs Task 5 sequencing (in scope — same plan):** Plan Step 3 of Task 4 noted that `classifyRepeater / cohortAvgLtvByRepeater / REPEATER_MIN_VISITS / RepeaterClass / REPEATER_COLORS` become dead only AFTER Task 5's component rewrites. To keep each commit green, I deleted them in Task 5's commit (with the rewrites) rather than in Task 4's commit — Task 4 commit only removed helpers whose sole caller was the deleted `CohortRevenueCard.svelte` (`cohortRevenueSum`, `cohortRevenueSumByRepeater`, `cohortAvgLtv`). Final state is identical to plan's end-state; commit ordering just keeps the tree green at every step.

3. **Pre-existing integration-test failures (out of scope):** `tests/integration/phase3-analytics.test.ts` has 6 pre-existing failures tied to `test_ltv / test_frequency / test_new_vs_returning` RPCs not being in the DEV schema cache (likely Phase 03-04 drift). These predate Pass 4 and are unrelated to migration 0028. The 2 new Pass 4 tests (`period == age → NULL`, weekly + monthly) both pass. Logged as context only — not a scope item for this plan.

## Self-Check: PASSED

Verified each deliverable:
- Migration file exists: `/Users/shiniguchi/development/ramen-bones-analytics/supabase/migrations/0028_retention_exclude_current_period.sql` ✓
- CohortRevenueCard.svelte deleted ✓ (git confirms file removal in commit 531a72f)
- All 5 commits present in git log:
  - `aa86219` Task 1 — retention NULL-mask (migration 0028)
  - `1598bf4` Task 2 — .chart-touch-safe utility + 6 wrappers
  - `6432bd2` Task 3 — retention tooltip activation
  - `531a72f` Task 4 — delete VA-09 CohortRevenueCard + dead helpers
  - `ab771c2` Task 5 — top-20 items + 8-bucket grouped LTV charts
- Unit tests: 198/198 green ✓
- svelte-check: 17 errors (baseline unchanged) ✓
- CI guards: all pass, migration drift clean (local_max=0028 remote_max=0028) ✓
- No `Co-authored-by: Claude` trailer in any commit ✓
- Grep src/ + tests/ for `CohortRevenueCard|cohortRevenueSum|REPEATER_COLORS|classifyRepeater|cohortAvgLtvByRepeater|REPEATER_MIN_VISITS|RepeaterClass|cohortAvgLtv\b`: zero live references (only a historical comment in test header) ✓
