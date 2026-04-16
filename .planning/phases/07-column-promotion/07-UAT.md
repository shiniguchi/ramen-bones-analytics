---
status: partial
phase: 07-column-promotion
source: [07-01-SUMMARY.md, 07-02-SUMMARY.md, 07-03-SUMMARY.md, 07-04-SUMMARY.md]
started: 2026-04-16T00:00:00Z
updated: 2026-04-16T02:05:00Z
---

## Current Test

[testing paused — 3 items blocked on auth/deploy]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running dev server, `npm run dev` from scratch. Server boots without errors; homepage loads and shows live KPIs from Supabase DEV.
result: pass
evidence: |
  vite v8.0.8 boot, ready in 1736 ms on :5173, no stderr errors.
  GET / → 303 → /login 200 (39KB HTML, SSR auth gate as designed, `error: null` form state).

### 2. Migration 0019 Applied on DEV
expected: `public.transactions` has `wl_issuing_country char(2)` + `card_type text`; `public.normalize_card_type(text)` and `public.country_name_to_iso2(text)` exist; `transactions_filterable_v` exposes `wl_issuing_country`.
result: pass
evidence: |
  `npx tsx scripts/debug/07-02-verify.ts` output:
    - schema check (new columns exist): true
    - view has wl_issuing_country column: true
    - Row distribution contains ISO-2 codes (DE, JP, US, GB, NL, FR, AT, …) proving
      both normalizers ran successfully during backfill.

### 3. Historical Backfill Coverage
expected: DEV: country-notnull ≥ 5,000, card_type-notnull ≥ 6,800, ≥ 30 non-DE countries.
result: pass
evidence: |
  transactions.total = 6896
  transactions.wl_issuing_country NOT NULL = 5271 (76%, ≥ 5000 ✓)
  transactions.card_type NOT NULL = 6842 (99.2%, ≥ 6800 ✓)
  Distinct countries: DE + 33 non-DE (AT, CH, US, GB, JP, TW, FR, NL, IT, CN, IE, FI,
  AU, SE, HK, GE, PL, ES, BE, KR, DK, IL, HU, CA, BG, TR, PH, BR, UA, KG, PT, CZ, …) ✓
  20-invoice spot check: pass=20 fail=0

### 4. Country Filter Visible in Filter Sheet
expected: On 375px viewport, FilterSheet shows a Country section with meta-sentinels (Germany only, Non-Germany only, Unknown) + specific ISO-2 codes loaded from the DISTINCT loader.
result: blocked
blocked_by: server
reason: |
  Local dev server /login gate requires credentials (no DEV_USER in .env); CF Pages
  DEV deploy pipeline is pre-existing broken (shared blocker tracked in STATE.md and
  Phase-06 UAT). Code-level coverage stands in: 22/22 FLT-05 tests pass live
  (tests/unit/filters-country.test.ts, tests/unit/country-multiselect.test.ts,
  tests/unit/FilterBar.test.ts, tests/integration/filter-country-loader.test.ts).
  Visual tick-through deferred until a login path opens (test auth helper or pipeline repair).

### 5. Country Filter Applies to KPIs
expected: Selecting `JP` in Country filter reshapes KPI tiles + charts to show only JP-issued transactions; active filter chip reads "Country: JP".
result: blocked
blocked_by: server
reason: |
  Same auth/deploy blocker as test 4. Code-level coverage: the integration test
  `tests/integration/filter-country-loader.test.ts` (6/6 passing) drives
  `applyCountryFilter()` against a real Supabase TEST project and asserts the
  WHERE clause reshapes result rows correctly (`.eq`, `.or`, `.is`, `.in` branches).

### 6. Mutual Exclusion (D-05)
expected: Selecting a meta-sentinel clears specific ISO-2 codes and vice versa; they cannot coexist in the selection.
result: blocked
blocked_by: server
reason: |
  Same auth/deploy blocker. Code-level coverage: `tests/unit/country-multiselect.test.ts`
  (5/5 passing) exercises the D-05 mutual-exclusion branches of `CountryMultiSelect.svelte`
  directly via Svelte 5 `$bindable` + `onSelectionChange` spy pattern.

## Summary

total: 6
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 3

## Gaps

<!-- No functional gaps found. All 6 tests either passed or are blocked on the
     pre-existing auth/deploy infrastructure (not phase-07 scope). Code-level
     coverage via 22/22 FLT-05 test suite stands in as interim evidence;
     visual UAT deferred until DEV deploy or test-user helper lands. -->
