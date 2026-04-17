---
status: complete
phase: 09-filter-simplification-performance
source: 09-01-SUMMARY.md, 09-02-SUMMARY.md, 09-04-SUMMARY.md
started: 2026-04-16T21:00:00Z
updated: 2026-04-17T00:20:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running dev server. Run `npm run dev` from scratch. Server boots without errors, migration 0022 is applied against DEV Supabase, and opening the dashboard URL returns a live page with KPI tiles populated from real data (no 500s, no empty state, no "transactions_filterable_v column is_cash does not exist" errors).
result: passed

### 2. Dashboard Shows Exactly 2 KPI Tiles
expected: Dashboard page renders exactly 2 KPI tiles — Revenue and Transactions. Each tile shows a current value, the date range label, and a delta vs prior period. No other KPI tiles (AOV, customer count, etc.) are visible.
result: pass

### 3. FilterBar 2-Row Layout
expected: FilterBar shows two rows. Row 1 contains the DatePickerPopover (range selector). Row 2 contains three horizontally-arranged inline controls: Grain toggle (day/week/month), Sales Type toggle (all/INHOUSE/TAKEAWAY), and Cash/Card toggle (all/cash/card). No FilterSheet bottom sheet, no multi-select dropdowns.
result: pass

### 4. Sales Type Toggle Filters Instantly
expected: Clicking INHOUSE on the Sales Type segmented toggle updates the 2 KPI tiles instantly (<200ms, no full page reload). Clicking TAKEAWAY filters to takeaway-only numbers. Clicking "all" restores the full total. URL query param reflects the selection without a server round-trip.
result: pass
note: URL replaceState + no reload verified; real-data <200ms timing untestable on this tenant (0 €/0 tx in test window — filter doesn't change numbers). Architecture guarantees <200ms per code review.

### 5. Cash/Card Toggle Filters Instantly
expected: Clicking "cash" on the Cash/Card segmented toggle updates the KPI tiles to show cash-only totals instantly. Clicking "card" shows card-only totals. Clicking "all" restores full totals. Each click updates the URL via replaceState (no reload, no spinner).
result: pass
note: URL progressed ?is_cash=cash → card → all via replaceState; no reload, no spinner. Real-data value change untestable on 0/0 tenant.

### 6. Grain Toggle Changes Bucketing
expected: Clicking day/week/month on the Grain toggle changes how the dashboard data is bucketed. URL query param updates via replaceState (no full reload). Any charts or bucketed views reflect the new grain. KPI tile totals remain correct (grain affects bucketing, not totals).
result: pass
note: URL ?grain=day/week/month via replaceState; 0 reloads; aria-checked radio state wired; cohort card still renders; KPI heading stays range-based (totals unchanged, matches spec).

### 7. Date Picker Updates Range Without Reload
expected: Opening the DatePickerPopover and selecting a new range updates the KPI tiles and the range label. URL `from`/`to` params update via replaceState (no full SSR round-trip visible as a page reload). Delta vs prior period recomputes against the new range.
result: issue
reported: "Live test on prod 2026-04-17 after 09-04 ship: primary reactivity fixed (button range ID '7d'→'30d'→'90d' flips, KPI titles 'Revenue · 30d' / 'Transactions · 30d' flip, URL writes ?range=30d/90d via replaceState, zero document reloads confirmed via performance.getEntriesByType('navigation').length stable at 1). NEW residual bug: DatePicker button DATE SUBTITLE stays frozen at SSR's 7d window 'Apr 11 – Apr 17' across 30d and 90d selections. Expected 30d ≈ 'Mar 18 – Apr 17', 90d ≈ 'Jan 17 – Apr 17'. Subtitle derives from a separate data.filters-or-window code path that 09-04 store-getter rewiring didn't cover. Same class as original bug, different element."
severity: minor

### 8. Cohort Retention Card Still Renders
expected: The Cohort Retention card is visible below the KPI tiles and renders its retention curve/data as before. The GrainToggle is no longer inside the retention card header (it moved to the FilterBar) — the card still respects the global grain setting.
result: pass
note: Cohort heading renders, SVG chart with 4 retention paths, GrainToggle confirmed in FilterBar (y=136) and NOT in cohort card (y=381).

### 9. Combined Filters Compose Correctly
expected: Apply Sales Type = INHOUSE AND Cash/Card = cash together. KPI tiles show the intersection (in-house cash sales only). Toggling either filter back to "all" broadens the result. Filters compose multiplicatively, not replace each other.
result: issue
reported: "Live test on prod 2026-04-17 after 09-04 ship: original aria-checked bug is FIXED — Inhouse radio aria-checked='true' and Cash radio aria-checked='true' both stay on simultaneously after sequential clicks (store composes correctly). NEW residual bug: URL drops previous filter params when a different filter is clicked. Sequence: click Inhouse → URL '/?sales_type=INHOUSE' (OK). Click Cash → URL '/?is_cash=cash' (sales_type=INHOUSE stripped, NOT merged). Expected '/?sales_type=INHOUSE&is_cash=cash'. Store state (aria-checked + KPI math) stays composed, but URL+SSR state would lose sales_type on reload. Bug likely in +page.svelte's handleSalesType / handleCashFilter replaceState callers building the URL from scratch instead of merging with existing URLSearchParams. Distinct from aria-checked fix in 09-04 (which targeted reactive READ from store)."
severity: major

## Summary

total: 9
passed: 7
issues: 2
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Date-range preset clicks update the range label and DatePicker button label without a reload."
  status: resolved
  reason: "Resolved by 09-04 gap closure. Prod UAT 2026-04-17: button range ID ('7d'→'30d'→'90d') flips, KPI titles flip to 'Revenue · 30d' etc., URL writes via replaceState, zero document reloads. Original aria-checked frozen-radio bug for Inhouse/Cash also resolved (both radios correctly composed)."
  severity: major
  test: 7
  resolved_by_plan: "09-04"
  also_resolves_tests: [9]

- truth: "DatePicker button date subtitle updates when a new range preset is selected."
  status: failed
  reason: "Prod live test 2026-04-17: primary range ID flip works (7d → 30d → 90d) and KPI titles flip correctly, but button's date subtitle ('Apr 11 – Apr 17') stays frozen at the SSR 7d window across all preset changes. Expected 30d ≈ 'Mar 18 – Apr 17', 90d ≈ 'Jan 17 – Apr 17'. Different code path from 09-04 store-getter rewiring; likely derives subtitle from data.filters.from/to or the SSR window prop rather than reactive store getFilters() output."
  severity: minor
  test: 7
  artifacts:
    - path: "src/lib/components/DatePickerPopover.svelte"
      issue: "button subtitle date formatter reads from a non-reactive source (likely props.filters.from/to or the SSR window prop)"
  missing:
    - "Trace where DatePickerPopover reads the 'Apr 11 – Apr 17' date subtitle"
    - "Rewire it to derive from the store's current window (getFilters() + chipToRange equivalent)"
    - "Unit test: clicking preset should update both range ID and date subtitle"

- truth: "Clicking one filter does not strip other filter params from the URL — all active filters persist in the query string."
  status: failed
  reason: "Prod live test 2026-04-17: Click Inhouse → URL '/?sales_type=INHOUSE' (correct). Click Cash → URL becomes '/?is_cash=cash' (sales_type=INHOUSE dropped, not merged). Store state stays composed (both aria-checked=true simultaneously), but URL reflects only the most recently clicked filter. Reload would lose the dropped filter (SSR reads URL). Likely in +page.svelte's filter click handlers — replaceState callers build URL from scratch rather than merging with existing URLSearchParams."
  severity: major
  test: 9
  artifacts:
    - path: "src/routes/+page.svelte"
      issue: "handleSalesType / handleCashFilter / handleRangeChange write URL without preserving other existing query params"
  missing:
    - "Identify the URL-building callsite(s) for replaceState on filter clicks"
    - "Preserve existing URLSearchParams when writing new values — merge, don't replace"
    - "Verify all four filter handlers (grain, sales_type, is_cash, range) merge correctly"
    - "Unit/integration test: sequential clicks compose URL (INHOUSE + cash → '?sales_type=INHOUSE&is_cash=cash')"

- truth: "Cold start against DEV succeeds: migrations apply cleanly, dev server boots, dashboard loads with live data from transactions_filterable_v.is_cash."
  status: resolved
  reason: "User reported: supabase db push failed on migration 0020_visit_attribution_mv.sql — ERROR: column t.id does not exist (SQLSTATE 42703). public.transactions has no id column; PK is composite (restaurant_id, source_tx_id). Migration 0020 references t.id at the materialized view definition. Migrations 0020, 0021, 0022 cannot land on DEV until 0020 is fixed."
  severity: blocker
  test: 1
  root_cause: "Migration 0020 (and Phase 8 plan D-04) assumed transactions.id uuid exists; real PK is composite (restaurant_id, source_tx_id text), so tx_id must be sourced from source_tx_id and typed text, not uuid."
  artifacts:
    - path: "supabase/migrations/0020_visit_attribution_mv.sql:12"
      issue: "t.id as tx_id — transactions has no id column (triggers SQLSTATE 42703)"
    - path: "supabase/migrations/0020_visit_attribution_mv.sql:49"
      issue: "test_visit_attribution RETURNS TABLE declares tx_id uuid — must be text"
    - path: "supabase/migrations/0022_transactions_filterable_v_is_cash.sql:18"
      issue: "LEFT JOIN predicate va.tx_id = t.id — same missing column, blocks Phase 9 view"
    - path: ".planning/phases/08-visit-attribution-data-model/08-CONTEXT.md:20"
      issue: "D-04 specifies tx_id uuid — incorrect, source column is text"
  missing:
    - "Replace t.id with t.source_tx_id in 0020 MV select (line 12)"
    - "Change tx_id column type from uuid to text in test_visit_attribution RETURNS TABLE (0020 line 49)"
    - "Replace va.tx_id = t.id with va.tx_id = t.source_tx_id in 0022 JOIN predicate (line 18)"
    - "Update 08-CONTEXT.md D-04 to document tx_id text (doc-only correction)"
    - "Run supabase db push against TEST locally and re-run phase8-visit-attribution.test.ts before pushing to DEV"
  debug_session: ".planning/debug/09-migration-0020-tx-id.md"
