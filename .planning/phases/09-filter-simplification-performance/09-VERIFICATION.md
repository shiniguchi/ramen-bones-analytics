---
phase: 09-filter-simplification-performance
verified: 2026-04-17T00:30:00Z
status: human_needed
score: 4/4 must-haves verified (automated); UAT Tests 2-9 awaiting re-run
re_verification: true
previous_status: passed
previous_score: 4/4
gaps_closed:
  - "Migrations 0020/0021/0022 now land cleanly on DEV (09-03 gap closure)"
  - "UAT Test 1 (cold-start smoke) passed on DEV post-migration-fix"
  - "Key link migration-0022 → visit_attribution_mv now JOINs on source_tx_id (was t.id)"
gaps_remaining: []
regressions: []
human_verification:
  - test: "UAT Test 2 — Dashboard Shows Exactly 2 KPI Tiles on DEV"
    expected: "Revenue + Transactions tiles render with live values, delta vs prior; no other KPI tiles (AOV, customer count) visible"
    why_human: "Visual rendering and KPI value correctness on DEV — was blocked pre-09-03 by migration failure, now needs re-run on post-fix DEV"
  - test: "UAT Test 3 — FilterBar 2-Row Layout on DEV"
    expected: "Row 1 DatePickerPopover; Row 2 Grain + Sales Type + Cash/Card inline toggles; no FilterSheet/multi-selects"
    why_human: "Visual layout at 375px viewport requires real browser"
  - test: "UAT Test 4 — Sales Type Toggle Filters Instantly (<200ms)"
    expected: "Clicking INHOUSE updates KPI tiles in <200ms, no page reload, URL updates via replaceState"
    why_human: "Perceived timing requires real browser measurement; asserts VA-12 <200ms contract"
  - test: "UAT Test 5 — Cash/Card Toggle Filters Instantly (<200ms)"
    expected: "Clicking Cash updates KPI tiles instantly, URL updates via replaceState, no spinner"
    why_human: "Perceived timing + URL state in browser"
  - test: "UAT Test 6 — Grain Toggle Changes Bucketing"
    expected: "Day/Week/Month toggle re-buckets data client-side; URL updates via replaceState; totals unchanged"
    why_human: "Client-side re-bucketing visual verification in browser"
  - test: "UAT Test 7 — Date Picker Updates Range Without Reload"
    expected: "Range change updates tiles + labels; URL from/to params update via replaceState; no reload"
    why_human: "SPA behavior + prior-period delta recomputation visible only in browser"
  - test: "UAT Test 8 — Cohort Retention Card Still Renders"
    expected: "Cohort retention card renders retention curve; GrainToggle no longer in card header (moved to FilterBar); card respects global grain"
    why_human: "Chart rendering + layout verification"
  - test: "UAT Test 9 — Combined Filters Compose Correctly"
    expected: "Sales Type=INHOUSE + Cash/Card=cash shows intersection (in-house cash sales only); multiplicative composition"
    why_human: "Cross-filter correctness with real data on DEV"
  - test: "VA-12 <200ms performance feel"
    expected: "Client-side grain/range toggle responds within perceivable instant (<200ms) on DEV against live Supabase"
    why_human: "Subjective performance feel cannot be grepped; requires real human on real device"
notes:
  - "CLAUDE.md /qa-gate returned BLOCK with 1 HIGH (prod missing security headers — PRE-EXISTING, not Phase 9 scope)"
  - "2 MEDIUM doc-staleness warnings in CLAUDE.md (Conventions / Architecture sections are placeholder — NOT Phase 9 scope)"
  - "UAT Tests 2-9 status on disk is result: blocked — will flip to pending/passed only after standard UAT workflow re-runs them"
---

# Phase 9: Filter Simplification & Performance Verification Report

**Phase Goal:** The filter bar shows only inhouse/takeaway + cash/card, granularity/range toggles respond in under 200ms (no SSR round-trip), and the dashboard shows 1 revenue card instead of 3

**Verified:** 2026-04-17T00:30:00Z
**Status:** human_needed
**Re-verification:** Yes — post-gap-closure (09-03 migration PK fix)

## Re-Verification Context

Previous verification ran before the 09-03 gap-closure plan and marked status `passed` based on code-level verification alone. Between that verification and this one:

- 09-03 gap closure shipped: migrations 0020/0022 `t.id -> t.source_tx_id`, `tx_id uuid -> text`, and 0021 rewritten as DROP + CREATE VIEW. Migrations 0020/0021/0022 now apply cleanly on DEV.
- UAT Test 1 (cold-start smoke) passed on DEV (confirmed in `09-UAT.md`: `passed: 1, issues: 0, blocked: 8`).
- UAT Tests 2-9 remain at `result: blocked, blocked_by: prior-phase` on disk. They were blocked by the migration failure, which is now fixed — but the standard UAT workflow has not yet re-run them. This is the sole reason status is `human_needed` and not `passed`.

All code-level truths, artifacts, key links, and data flows remain VERIFIED after the 09-03 changes. One key link is improved: migration 0022's JOIN predicate now correctly references `t.source_tx_id` (was `t.id` in previous verification — a latent bug that would have failed at DB level).

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Filter bar shows exactly 2 filters (inhouse/takeaway + cash/card); country dropdown, payment-method multi-select, and repeater-bucket dropdown are gone | VERIFIED | `FilterBar.svelte` contains exactly 2 `SegmentedToggle` instances (`label="Sales type"`, `label="Payment type"`) plus `GrainToggle`. `FilterSheet.svelte` and `MultiSelectDropdown.svelte` deleted. `payment_method` has 0 matches in `src/lib/filters.ts`. `distinctPaymentMethods` has 0 matches in `src/` |
| 2 | Granularity/range toggles re-render in <200ms without SSR round-trip | VERIFIED (code) / HUMAN_NEEDED (feel) | `GrainToggle.svelte` uses `replaceState` + `setGrain()` (0 `goto(` matches). `DatePickerPopover.svelte` uses `replaceState` + `onrangechange` callback (0 `goto(` matches, 0 `invalidateAll`). Reactive chain confirmed. <200ms perceived response requires human feel-test (see human_verification) |
| 3 | Dashboard shows 1 revenue reference card using active range/granularity, respecting both filters | VERIFIED | `+page.svelte` contains exactly 2 `<KpiTile` elements ("Revenue · {rangeLabel}" + "Transactions · {rangeLabel}") driven by `getKpiTotals()` which composes `filterRows(rawRows, salesTypeFilter, cashFilter, ...)`. No `revenueToday`/`revenue7d`/`revenue30d`/`avgTicket` references remain |
| 4 | All remaining tiles and charts respect both filters; no unscoped reference tiles | VERIFIED | Only tiles on page are 2 KpiTiles driven by dashboardStore `_kpiTotals` `$derived`. CohortRetentionCard is SSR-driven (retention_curve_v) — unchanged by filter bar by design (D-14 / Pitfall 6) |

**Score:** 4/4 truths verified programmatically. Truth #2's sub-claim (<200ms perceived response) requires human verification.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/0022_transactions_filterable_v_is_cash.sql` | View with is_cash via visit_attribution_mv JOIN | VERIFIED | Exists; `LEFT JOIN public.visit_attribution_mv va`; `COALESCE(va.is_cash, true)`; JOIN predicate uses `t.source_tx_id` (corrected in 09-03) |
| `supabase/migrations/0020_visit_attribution_mv.sql` | MV sources tx_id from source_tx_id (text) | VERIFIED | Line 12: `t.source_tx_id as tx_id`; Line 48: `tx_id text` in test helper (09-03 gap closure) |
| `src/lib/filters.ts` | Schema: is_cash enum, sales_type enum, no payment_method | VERIFIED | Contains `IS_CASH_VALUES`, `SALES_TYPE_FILTER_VALUES`, `is_cash: z.enum`. Zero matches for `payment_method` or `csvArray` |
| `src/lib/dashboardStore.svelte.ts` | Client-side rebucket reactive store | VERIFIED | Extension `.svelte.ts`. Exports `bucketKey`, `filterRows`, `aggregateByBucket`, `computeKpiTotals`, `initStore`, `setGrain`, `setSalesType`, `setCashFilter`, `setRange`, `cacheCovers`, `updateCache`. Uses `$state` + `$derived`. Getter pattern (`getKpiTotals`) for derived exports |
| `src/lib/components/SegmentedToggle.svelte` | Generic 3-state toggle with ARIA | VERIFIED | `role="group"`, `role="radio"`, `aria-checked`, `min-h-11`, `bg-blue-50 text-blue-600` |
| `src/lib/components/FilterBar.svelte` | 2-row layout with inline toggles | VERIFIED | Row 1 DatePickerPopover; Row 2 GrainToggle + 2 SegmentedToggles with zinc separators. No FilterSheet, no MultiSelectDropdown, no sheetOpen, no distinctPaymentMethods references |
| `src/routes/+page.server.ts` | Simplified SSR returning raw daily rows | VERIFIED | Returns `dailyRows` + `priorDailyRows` from `transactions_filterable_v`. No `queryKpi`, `queryFiltered`, `distinctPaymentMethodsP`, `revenueToday`, `revenue7d`, `revenue30d`, `avgTicket` |
| `src/routes/+page.svelte` | 2 KPI tiles driven by dashboardStore | VERIFIED | Exactly 2 `<KpiTile` usages. Imports `initStore`, `getKpiTotals`. `$effect` wires SSR data to store. `$derived(getKpiTotals())` drives tiles |
| `src/lib/components/GrainToggle.svelte` | replaceState-based | VERIFIED | `replaceState` + `setGrain`, 0 `goto` matches |
| `src/lib/components/DatePickerPopover.svelte` | replaceState-based + callback | VERIFIED | `replaceState` + `onrangechange`, 0 `goto(` and 0 `invalidateAll` |
| `src/lib/components/CohortRetentionCard.svelte` | GrainToggle removed from card header | VERIFIED | No GrainToggle import/usage. Props interface is `{ data }` only. Header is `<h2>Cohort retention</h2>` |
| `tests/unit/dashboardStore.test.ts` | 14 unit tests for pure store functions | VERIFIED | File exists; 14 tests pass |
| `tests/unit/filters.test.ts` | Updated filter schema tests | VERIFIED | 20 tests pass |
| `src/lib/components/FilterSheet.svelte` | Deleted | VERIFIED | File does not exist |
| `src/lib/components/MultiSelectDropdown.svelte` | Deleted | VERIFIED | File does not exist |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `+page.svelte` | `dashboardStore.svelte.ts` | `initStore` in `$effect` | WIRED | `$effect(() => { initStore({ dailyRows, priorDailyRows, window, grain, salesType, cashFilter }) })` |
| `+page.svelte` | `dashboardStore.svelte.ts` | `getKpiTotals()` in `$derived` | WIRED | `const kpi = $derived(getKpiTotals())` — getter pattern required by Svelte 5 |
| `FilterBar.svelte` | `+page.svelte` handlers | `onsalestypechange`/`oncashfilterchange` callbacks | WIRED | FilterBar emits; page handlers call `setSalesType`/`setCashFilter` + `replaceState` |
| `GrainToggle.svelte` | `$app/navigation` + store | `replaceState(url, {})` + `setGrain(value)` | WIRED | URL sync + store update confirmed |
| `DatePickerPopover.svelte` | `+page.svelte` via `onrangechange` | `replaceState` + callback | WIRED | `applyPreset()` + `applyCustom()` both wired |
| `migration 0022` | `visit_attribution_mv` | LEFT JOIN on `source_tx_id` (fixed in 09-03) | WIRED | `va.tx_id = t.source_tx_id` — types align (both text) |
| `migration 0020` | `transactions` | `t.source_tx_id as tx_id` | WIRED | MV compiles against real composite-PK schema |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source Chain | Produces Real Data | Status |
|----------|---------------|--------------|--------------------|--------|
| `+page.svelte` KpiTile (Revenue) | `kpi.revenue_cents` | `getKpiTotals()` → `_kpiTotals` `$derived` → `computeKpiTotals(_filtered, _priorFiltered)` → `filterRows(rawRows, ...)` → `rawRows` set by `initStore(data.dailyRows)` | `dailyRows` from `transactions_filterable_v` Supabase query on DEV — confirmed via UAT Test 1 and DB count 6896 MV rows | FLOWING |
| `+page.svelte` KpiTile (Transactions) | `kpi.tx_count` | Same chain | Same | FLOWING |
| `+page.svelte` CohortRetentionCard | `data.retention` | `retention_curve_v` SSR query in `+page.server.ts` | SSR-fetched live data | FLOWING |

**Notable limitation (documented, not a goal failure):** When a user widens the date range past the cached window (e.g., 7d → 90d), `handleRangeChange` calls `setRange(window)` without triggering a new fetch. The comment says "SSR will refetch on next load" but no navigation is fired. Range widening past cache silently shows incomplete data. Not a blocker for the stated <200ms goal — flagged as a human verification item.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase 9 unit tests pass | `npx vitest run tests/unit/filters.test.ts tests/unit/dashboardStore.test.ts` | 34/34 pass | PASS |
| Full unit-test suite passes | `npx vitest run tests/unit/` | 80/80 pass (10 files) | PASS |
| FilterSheet / MultiSelect deleted | `ls FilterSheet.svelte MultiSelectDropdown.svelte` | Both missing | PASS |
| No legacy KPI queries | `grep revenueToday\|revenue7d\|revenue30d\|avgTicket\|queryKpi\|queryFiltered src/` | 0 matches | PASS |
| Exactly 2 KpiTile usages | `grep -c '<KpiTile' +page.svelte` | 2 usages + 1 import | PASS |
| `payment_method` removed from filter schema | `grep payment_method src/lib/filters.ts` | 0 matches | PASS |
| `distinctPaymentMethods` removed | `grep distinctPaymentMethods src/` | 0 matches | PASS |
| `goto` removed from GrainToggle | `grep 'goto(' src/lib/components/GrainToggle.svelte` | 0 matches | PASS |
| `goto` / `invalidateAll` removed from DatePickerPopover | `grep 'goto(\|invalidateAll' DatePickerPopover.svelte` | 0 matches | PASS |

**Integration/E2E tests skipped:** Integration tests against live Supabase (phase8-visit-attribution, rls-policies, phase3-analytics) currently fail in this sandbox because they require DEV/TEST DB URLs that are not exported. They are NOT Phase 9 regressions — Phase 8 integration suite was verified green against TEST during 09-03 gap closure. E2E tests (tests/e2e/*) require a running dev server and are out of scope for this automated verification; they map to the human UAT tests below.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| VA-11 | 09-01, 09-02, 09-03 | Filters simplified to inhouse/takeaway + cash/card only; all tiles respect both | SATISFIED (code) | FilterBar: 2 SegmentedToggles. Both KpiTiles read `getKpiTotals()` which applies both filters. Dead components deleted |
| VA-12 | 09-01, 09-02, 09-03 | Granularity/range toggle client-side, <200ms | SATISFIED (code) / HUMAN_NEEDED (feel) | All filter controls use `replaceState` + synchronous store updates. No `goto`, no `invalidateAll`. <200ms perceived response requires human timing on DEV |
| VA-13 | 09-02, 09-03 | 1 revenue reference card using active range/granularity, respects both filters | SATISFIED | Exactly 2 KpiTiles (Revenue + Transactions), both driven by `getKpiTotals()`, both respecting `salesTypeFilter` + `cashFilter` |

**Orphaned requirements check:** REQUIREMENTS.md maps only VA-11, VA-12, VA-13 to Phase 9. All 3 are claimed in plans and verified. No orphaned requirements. (09-03 plan additionally lists VA-01 and VA-02 in its frontmatter because the migration fix directly unblocks those Phase 8 requirements; REQUIREMENTS.md Evidence column correctly credits 09-03 as gap-closure evidence for VA-01/VA-02.)

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/routes/+page.svelte` | 59-65 | Range-change cache miss silently calls `setRange(window)` without fetching wider data | Warning | User widens 7d → 90d: sees incomplete data with no visual indication. Narrowing always works. Flagged for human verification. Not a blocker for stated <200ms goal |

No blocker anti-patterns. No TODO/FIXME/placeholder/stub patterns found in Phase 9 files.

### Project-Level QA Context (not Phase 9 scope — included for traceability)

| Finding | Severity | Scope |
|---------|----------|-------|
| Prod missing security headers | HIGH | PRE-EXISTING — not Phase 9 scope. `/qa-gate` BLOCK return. Track in infrastructure/deploy backlog |
| `CLAUDE.md` "Conventions not yet established" | MEDIUM | Doc staleness — NOT Phase 9 scope |
| `CLAUDE.md` "Architecture not yet mapped" | MEDIUM | Doc staleness — NOT Phase 9 scope |

### Human Verification Required

UAT Tests 2-9 remain at `result: blocked, blocked_by: prior-phase` on disk (see `09-UAT.md`). They were blocked by the migration failure that 09-03 fixed. The standard UAT workflow must re-run these against post-fix DEV before Phase 9 can flip to fully `passed`.

#### 1. UAT Test 2 — Dashboard Shows Exactly 2 KPI Tiles on DEV

**Test:** Load the dashboard on DEV. Confirm exactly 2 KPI tiles render (Revenue + Transactions) with live values + prior-period deltas. No AOV, customer count, or other tiles.
**Expected:** Revenue and Transactions tiles with live numbers from Supabase.
**Why human:** Visual rendering and KPI value correctness on DEV. Was blocked pre-09-03 by migration failure; now needs re-run on post-fix DEV.

#### 2. UAT Test 3 — FilterBar 2-Row Layout on DEV

**Test:** Open dashboard at 375px. Confirm Row 1 shows DatePickerPopover and Row 2 shows Grain + Sales Type + Cash/Card inline segmented toggles with zinc separators. Confirm horizontal scroll on row 2 works without visible scrollbar.
**Expected:** Correct 2-row layout; touch-friendly; active state shows blue-50/blue-600.
**Why human:** Visual layout at 375px viewport requires real browser.

#### 3. UAT Test 4 — Sales Type Toggle Filters Instantly (<200ms)

**Test:** Click "Inhouse" on the Sales Type toggle. Measure perceived response time.
**Expected:** KPI tiles update within ~50-200ms, no loading spinner, no page navigation, URL updates to `?sales_type=INHOUSE`.
**Why human:** Perceived timing requires real browser measurement. Asserts VA-12 <200ms contract.

#### 4. UAT Test 5 — Cash/Card Toggle Filters Instantly (<200ms)

**Test:** Click "Cash" on Cash/Card toggle.
**Expected:** KPI tiles update instantly; URL updates via replaceState; no spinner.
**Why human:** Perceived timing + URL state in browser.

#### 5. UAT Test 6 — Grain Toggle Changes Bucketing

**Test:** Click Day/Week/Month on grain toggle.
**Expected:** URL updates; client-side rebucketing (no reload); KPI tile totals unchanged (grain affects bucketing, not totals).
**Why human:** Client-side re-bucketing visual verification in browser.

#### 6. UAT Test 7 — Date Picker Updates Range Without Reload

**Test:** Open DatePickerPopover; switch to a different preset (e.g., 30d); then to custom range.
**Expected:** KPI tiles + range labels update; URL from/to params via replaceState; prior-period delta recomputes.
**Why human:** SPA behavior + prior-period delta recomputation visible only in browser.

#### 7. UAT Test 8 — Cohort Retention Card Still Renders

**Test:** Scroll to cohort retention card.
**Expected:** Retention curve chart renders; GrainToggle is NOT inside the card header (moved to FilterBar); card respects global grain setting.
**Why human:** Chart rendering + layout verification.

#### 8. UAT Test 9 — Combined Filters Compose Correctly

**Test:** Set Sales Type = INHOUSE AND Cash/Card = cash simultaneously.
**Expected:** KPI tiles show intersection (in-house cash sales only). Toggling either back to "all" broadens.
**Why human:** Cross-filter correctness with real data on DEV; multiplicative composition.

#### 9. VA-12 <200ms Performance Feel

**Test:** Subjective responsiveness audit — click through every filter toggle on DEV and feel for jitter/lag.
**Expected:** All interactions feel instant (<200ms).
**Why human:** Subjective performance feel cannot be grepped; requires real human on real device.

#### 10. Range-Widening Cache-Miss Behavior

**Test:** Load dashboard on default 7d. Switch to 90d via date picker.
**Expected:** Either correct 90d data fetches and displays, OR a visible warning about limited coverage. Silent wrong data (7d masquerading as 90d) would be a regression to address.
**Why human:** Cache-coverage fallback is `setRange` without fetching — needs human judgment on whether MVP UX is acceptable or requires a follow-up fix.

---

## Summary

**Code-level verification: PASSED.** All 4 observable truths, all 15 artifacts, all 7 key links, and 2 data-flow chains verify against the codebase. All 80 unit tests pass. Migration 0020/0022 schema is correct post-09-03 gap closure.

**Requires human re-run:** UAT Tests 2-9 are on disk as `result: blocked` (blocked_by: prior-phase, now resolved). They need to be re-executed via the standard UAT workflow against the post-migration-fix DEV dashboard. Until that happens, Phase 9 status cannot flip from `human_needed` to `passed`.

**Known documented limitation (not a blocker):** Range widening past the local cache silently displays incomplete data. Flagged for human judgment; does not violate any stated success criterion.

**Out-of-scope findings (project-level):** `/qa-gate` HIGH on missing prod security headers (PRE-EXISTING, not Phase 9) and 2 MEDIUM CLAUDE.md doc-staleness items are noted for traceability but do not affect Phase 9 status.

---

_Re-verified: 2026-04-17T00:30:00Z_
_Verifier: Claude (gsd-verifier)_
_Previous verification: 2026-04-16T23:04:00Z (status: passed, pre-09-03)_
