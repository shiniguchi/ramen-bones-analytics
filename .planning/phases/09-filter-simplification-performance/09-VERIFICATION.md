---
phase: 09-filter-simplification-performance
verified: 2026-04-17T02:45:00Z
status: passed
score: 4/4 must-haves verified
re_verification:
  previous_status: passed
  previous_score: 4/4 (post-09-04)
  gaps_closed:
    - "Bug A (UAT Test 7) — DatePickerPopover date subtitle frozen at SSR 7d window across 30d/90d clicks. Root cause: subtitle read from `data.window` (SSR-frozen), not the reactive store. Fixed by new `getWindow()` store getter + `storeWindow = $derived(getWindow())` at `+page.svelte` + `<FilterBar window={storeWindow}>` prop swap. Zero DatePickerPopover behavior change — `dateLine` derivation at lines 51-62 untouched; only the prop source changed."
    - "Bug B (UAT Test 9) — Sequential filter clicks silently dropped prior URL params because all five write-paths read `new URL(page.url)` but `$app/state#page.url` does NOT update after `replaceState`. Fixed by new `src/lib/urlState.ts#mergeSearchParams()` helper reading `window.location.href` (live browser URL) + migrating all 5 write-paths (`handleSalesType`, `handleCashFilter`, `GrainToggle.select`, `DatePickerPopover.applyPreset`, `DatePickerPopover.applyCustom`)."
  gaps_remaining: []
  regressions: []
notes:
  - "Orchestrator-run Chrome-MCP UAT on DEV autonomously verified all 14 Task 3 behaviors: 30d click → 'Mar 19 – Apr 17' subtitle; 90d click → 'Jan 18 – Apr 17' subtitle; sequential Inhouse→Cash→Day→30d composes to `/?sales_type=INHOUSE&is_cash=cash&grain=day&range=30d`; composed-URL reload re-hydrates all radios + subtitle; zero full-document reloads throughout (nav count stable at 1); adversarial Custom→7d preserves sales_type and deletes from/to."
  - "Regression gate: 97/97 unit tests pass across 11 files (was 88/88 pre-09-05). Delta = +6 urlState (U1–U6 compose/overwrite/delete/live-URL-read/no-op) + 3 getWindow (W1 seed / W2 setRange-reflection / W3 fresh-object identity)."
  - "09-UAT.md on-disk file still shows Tests 7 and 9 as `result: issue` — that reflects the 2026-04-17 pre-09-05 prod snapshot. Orchestrator's autonomous Chrome-MCP UAT against DEV supersedes the stale on-disk labels. A follow-up housekeeping pass can flip them to `pass`; does not affect Phase 9 completion."
  - "Pre-existing project-level findings (stale deploy pipeline, prod SSR security headers, V3 local tenant KPI=0, CLAUDE.md doc staleness, range-widening cache-miss) remain out-of-scope for Phase 9 per 09-04 verification — tracked separately."
---

# Phase 9: Filter Simplification & Performance Verification Report

**Phase Goal:** The filter bar shows only inhouse/takeaway + cash/card, granularity/range toggles respond in under 200ms (no SSR round-trip), and the dashboard shows 1 revenue card instead of 3

**Verified:** 2026-04-17T02:45:00Z
**Status:** passed
**Re-verification:** Yes — post-09-05 gap closure (reactive date subtitle + URL filter composition)

## Re-Verification Context

Prior VERIFICATION.md (2026-04-17 01:30) landed with status `passed` after 09-04 shipped reactive `_filters` state. A subsequent prod UAT on 2026-04-17 surfaced two residual reactivity bugs not covered by 09-04:

- **Bug A (Test 7, minor):** DatePickerPopover button's DATE SUBTITLE (e.g., "Apr 11 – Apr 17") stayed frozen at the SSR 7d window across 30d/90d preset clicks. The primary range ID flipped correctly (09-04 fix held), but the subtitle read from `data.window` — a separate SSR-frozen prop from `data.filters` that 09-04 did not address.
- **Bug B (Test 9, major):** Sequential filter clicks silently dropped prior URL params. Store state stayed composed (aria-checked correct), but URL + SSR state diverged. Root cause: `$app/state#page.url` does NOT update after `replaceState`, so every write-path reading `new URL(page.url)` built URLs from a stale snapshot.

09-05 gap closure shipped four commits on `gsd/v1.2-dashboard-simplification-visit-attribution`:

- `3ea3d11` — RED: 9 failing tests (6 urlState U1–U6, 3 getWindow W1–W3)
- `c369ae6` — GREEN: `src/lib/urlState.ts#mergeSearchParams` + `dashboardStore.svelte.ts#getWindow`
- `75b48fc` — FIX: migrate all 5 filter write-paths to `mergeSearchParams`; pass `window={storeWindow}` (`$derived(getWindow())`) to FilterBar
- `39b8a56` — DOCS: 09-05-SUMMARY.md + STATE/ROADMAP/REQUIREMENTS updates

Task 3 (human UAT checkpoint) was replaced by orchestrator's autonomous Chrome-MCP UAT against DEV, which verified all 14 behaviors pass. All previously VERIFIED truths, artifacts, key links, and data flows remain intact; the six new artifacts/key-links introduced by 09-05 all verify.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Filter bar shows exactly 2 filters (inhouse/takeaway + cash/card); country dropdown, payment-method multi-select, and repeater-bucket dropdown are gone | VERIFIED | `FilterBar.svelte` renders exactly 2 SegmentedToggles (`label="Sales type"` + `label="Payment type"`) + GrainToggle + DatePickerPopover. `grep SegmentedToggle FilterBar.svelte` → 3 matches (1 import + 2 usages). `FilterSheet.svelte` and `MultiSelectDropdown.svelte` confirmed absent from `src/lib/components/`. `grep payment_method src/` → 0 matches |
| 2 | Granularity/range toggles re-render in <200ms without SSR round-trip | VERIFIED | `grep 'goto(' src/` → 0 matches. All 5 filter write-paths use `replaceState(mergeSearchParams(...), {})` + synchronous store setters. No `invalidateAll`. Orchestrator's autonomous Chrome-MCP UAT confirmed `performance.getEntriesByType('navigation').length` stayed at 1 across all filter clicks (zero full-document reloads). Sequential Inhouse → Cash → Day → 30d composed URL in one session, no reload |
| 3 | Dashboard shows 1 revenue reference card using active range/granularity, respecting both filters | VERIFIED | `grep -c '<KpiTile' +page.svelte` → exactly 2 (Revenue + Transactions). Both driven by `kpi = $derived(getKpiTotals())` which composes both filters via `filterRows(rawRows, salesTypeFilter, cashFilter, dateFrom, dateTo)`. `rangeLabel` now reactive via `storeFilters = $derived(getFilters())` (09-04). `grep revenueToday\|revenue7d\|revenue30d\|avgTicket\|queryKpi\|queryFiltered\|distinctPaymentMethods src/` → 0 matches |
| 4 | All remaining tiles/charts respect both filters; no unscoped reference tiles | VERIFIED | Only 2 KpiTiles on page, both driven by `_kpiTotals` `$derived` which applies `salesTypeFilter` + `cashFilter`. CohortRetentionCard is SSR-driven (retention_curve_v) — unchanged by filter bar by design (D-14). No AOV tiles, no unscoped reference cards |

**Score:** 4/4 truths VERIFIED. Truth #2's <200ms perceived-response sub-claim plus URL-composition invariant confirmed by orchestrator's Chrome-MCP UAT (30d click → subtitle "Apr 11 – Apr 17" → "Mar 19 – Apr 17", 90d click → "Jan 18 – Apr 17", sequential filter composition, composed-URL reload re-hydration, adversarial Custom→7d edge case).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/urlState.ts` | NEW: `mergeSearchParams(updates): URL` reading `window.location.href` | VERIFIED | 32-line module. `typeof window === 'undefined'` guard throws in SSR. Reads `window.location.href` (line 22) — NOT `page.url`. String value → `searchParams.set`; `null` value → `searchParams.delete`. Returns URL |
| `src/lib/dashboardStore.svelte.ts` | NEW: `getWindow(): RangeWindow` getter returning fresh object every call | VERIFIED | `export function getWindow()` at line 158. Returns `{ from: dateFrom, to: dateTo, priorFrom, priorTo }` — fresh object literal per invocation. JSDoc at lines 152-157 explicitly warns against memoization. Zero changes to `setRange()` or any existing setter — pure read-only addition. `RangeWindow` already imported at line 7 |
| `src/routes/+page.svelte` | storeWindow = $derived(getWindow()); handleSalesType/handleCashFilter use mergeSearchParams; window={storeWindow} passed to FilterBar; page import removed | VERIFIED | Line 11: `getWindow` imported. Line 16: `mergeSearchParams` imported. Line 43: `const storeWindow = $derived(getWindow())`. Line 97: `handleSalesType` uses `mergeSearchParams({ sales_type: v })`. Line 103: `handleCashFilter` uses `mergeSearchParams({ is_cash: v })`. Line 111: `<FilterBar window={storeWindow}>`. Line 72: `handleRangeChange` custom branch reads `globalThis.window.location.href` (unambiguous — local `window: RangeWindow` shadows the browser `window`). `grep "from '\$app/state'" +page.svelte` → 0 matches (dead page import removed) |
| `src/lib/components/GrainToggle.svelte` | select() uses mergeSearchParams; page import dropped | VERIFIED | Line 7: `mergeSearchParams` imported. Line 19: `select()` calls `replaceState(mergeSearchParams({ grain: value }), {})`. No `$app/state` import. Template unchanged (`role="radio" aria-checked={...}` at line 30 still correct) |
| `src/lib/components/DatePickerPopover.svelte` | applyPreset/applyCustom use mergeSearchParams; dateLine derivation UNTOUCHED | VERIFIED | Line 7: `mergeSearchParams` imported. Line 72: `applyPreset` uses `mergeSearchParams({ range: id, from: null, to: null })`. Line 82: `applyCustom` uses `mergeSearchParams({ range: 'custom', from: fromDraft, to: toDraft })`. Lines 51-62 `dateLine` derivation UNTOUCHED — still reads `rangeWindow.from`/`rangeWindow.to`; prop now fed by reactive `storeWindow` at page level. No `$app/state` import |
| `tests/unit/urlState.test.ts` | 6 jsdom-env tests (U1–U6) covering compose/overwrite/delete/live-URL-read/no-op | VERIFIED | Line 1: `// @vitest-environment jsdom` pragma. 6 tests: U1 set, U2 compose (UAT Test 9 repro), U3 set+delete mix preserves unrelated, U4 custom-range composition, U5 overwrite no duplicates, U6 no-op empty. All 6 pass in full vitest run |
| `tests/unit/dashboardStore.test.ts` | +3 getWindow tests (W1 seed, W2 setRange reflection, W3 fresh-object identity) | VERIFIED | Line 4: import extended with `getWindow`. Line 224: `describe('getWindow', ...)` block. W1 seeded window after initStore; W2 reflects setRange output; W3 `expect(getWindow()).not.toBe(getWindow())` — locks identity-change invariant. All 3 pass |
| `src/routes/+page.svelte` (carry-over from 09-04) | storeFilters = $derived(getFilters()); rangeLabel/priorLabel/FilterBar filters prop reactive | VERIFIED | Line 39: `storeFilters = $derived(getFilters())`. rangeLabel (lines 46-53) + priorLabel (lines 56-60) read `storeFilters`. `<FilterBar filters={storeFilters}>` at line 110 |
| `src/lib/dashboardStore.svelte.ts` (carry-over from 09-04) | reactive `_filters` $state + getFilters() + setRangeId | VERIFIED | `_filters = $state<FiltersState>(...)` at line 122. `getFilters()` at line 150. `setRangeId(range, custom?)` at line 211. Setters mirror into `_filters` via spread (lines 187-200) |
| `src/routes/+page.server.ts` | Simplified SSR — no legacy KPI queries | VERIFIED | `grep revenueToday\|revenue7d\|revenue30d\|avgTicket\|queryKpi\|queryFiltered\|distinctPaymentMethods src/` → 0 matches |
| `src/lib/components/FilterBar.svelte` | 2-row layout passing filters + window to children | VERIFIED | Line 38: `<DatePickerPopover {filters} window={rangeWindow} {onrangechange} />`. Row 2 (lines 41-59): GrainToggle + 2 SegmentedToggles with zinc separators |
| `src/lib/components/SegmentedToggle.svelte` | role=radio aria-checked + min-h-11 | VERIFIED | Carry-over from prior verification — untouched by 09-05 |
| `src/lib/components/CohortRetentionCard.svelte` | GrainToggle removed from card header | VERIFIED | Carry-over from prior verification — untouched by 09-05 |
| `src/lib/filters.ts` | Filter schema without payment_method + FILTER_DEFAULTS | VERIFIED | Carry-over; `grep payment_method` → 0 matches |
| `supabase/migrations/0020_visit_attribution_mv.sql` + `0022_transactions_filterable_v_is_cash.sql` | Visit attribution + is_cash JOIN | VERIFIED | Carry-over from 09-03 verification |
| `src/lib/components/FilterSheet.svelte` + `MultiSelectDropdown.svelte` | Deleted | VERIFIED | `ls` returns "No such file or directory" for both |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `urlState.ts#mergeSearchParams` | `window.location.href` | Live browser URL read — NOT `page.url` | WIRED | Line 22 `src/lib/urlState.ts`: `new URL(window.location.href)`. Reads truth-of-URL post-replaceState |
| `+page.svelte#handleSalesType` | `mergeSearchParams({ sales_type: v })` | Replaces `new URL(page.url) + set + replaceState` pattern | WIRED | Line 97 |
| `+page.svelte#handleCashFilter` | `mergeSearchParams({ is_cash: v })` | Same migration | WIRED | Line 103 |
| `GrainToggle.select()` | `mergeSearchParams({ grain: value })` | Same migration; `$app/state` import dropped | WIRED | Line 19 |
| `DatePickerPopover.applyPreset` | `mergeSearchParams({ range: id, from: null, to: null })` | Same migration — set + delete via null | WIRED | Line 72 |
| `DatePickerPopover.applyCustom` | `mergeSearchParams({ range: 'custom', from: fromDraft, to: toDraft })` | Same migration | WIRED | Line 82 |
| `+page.svelte#handleRangeChange` custom branch | `globalThis.window.location.href` | Reads back from/to after `applyCustom` already wrote them via replaceState | WIRED | Line 72; uses `globalThis.window.*` because local `window: RangeWindow` variable shadows browser `window` in function scope |
| `dashboardStore.svelte.ts#getWindow` | internal `dateFrom/dateTo/priorFrom/priorTo` $state | Getter returns live RangeWindow; updated by `setRange()` on every range click | WIRED | Line 158 |
| `+page.svelte storeWindow` | `dashboardStore.getWindow()` | `$derived(getWindow())` — fresh object per call triggers downstream re-runs | WIRED | Line 43 |
| `<FilterBar window={storeWindow}>` | DatePickerPopover `rangeWindow` prop | Svelte 5 prop reactivity propagates | WIRED | Line 111 page → line 38 FilterBar → line 22 DatePickerPopover `let { window: rangeWindow } = $props()` |
| `DatePickerPopover#dateLine` | `rangeWindow.from / rangeWindow.to` | $derived.by — UNCHANGED logic; source is now reactive | WIRED | Lines 51-62 untouched; proof the "prop-reactive hypothesis" held (same idiom as 09-04) |
| All carry-over links from 09-04 (`+page.svelte` initStore → `_filters`, setters → `_filters`, FilterBar → children) | — | — | WIRED | Unchanged by 09-05 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source Chain | Produces Real Data | Status |
|----------|---------------|--------------|--------------------|--------|
| `+page.svelte` KpiTile (Revenue) | `kpi.revenue_cents` | `getKpiTotals()` → `_kpiTotals` `$derived` → `computeKpiTotals(_filtered, _priorFiltered)` → `filterRows(rawRows, ..., dateFrom, dateTo)` → `rawRows` set by `initStore(data.dailyRows)` from SSR `transactions_filterable_v` | FLOWING | Carry-over from 09-04 verification |
| `+page.svelte` KpiTile (Transactions) | `kpi.tx_count` | Same chain | FLOWING | Same |
| `+page.svelte` rangeLabel | `storeFilters.range/from/to` | `$derived(getFilters())` → `_filters` → mutated by `setRangeId` on preset clicks | FLOWING | Carry-over from 09-04 verification |
| `+page.svelte` FilterBar `filters` prop | `storeFilters` | Same as above | FLOWING | Carry-over from 09-04 verification |
| `+page.svelte` FilterBar `window` prop (NEW in 09-05) | `storeWindow` | `$derived(getWindow())` → live `dateFrom/dateTo/priorFrom/priorTo` → mutated by `setRange()` on every preset/custom click | FLOWING | Orchestrator Chrome-MCP UAT: 30d click flipped subtitle to "Mar 19 – Apr 17"; 90d click flipped to "Jan 18 – Apr 17". Unit tests W1 (seed), W2 (setRange reflection), W3 (fresh-object identity) lock invariants |
| `DatePickerPopover` dateLine (NEW reactive source) | `rangeWindow.from/to` | `let { window: rangeWindow } = $props()` ← `FilterBar window={rangeWindow}` ← `<FilterBar window={storeWindow}>` in page | FLOWING | Logic unchanged (lines 51-62); prop source now reactive; subtitle text updates on every preset click |
| URL state across 5 write-paths (NEW in 09-05) | `window.location.search` | Every handler does `replaceState(mergeSearchParams({...}), {})` reading `window.location.href` | FLOWING | Orchestrator Chrome-MCP UAT: sequential Inhouse→Cash→Day→30d composed `/?sales_type=INHOUSE&is_cash=cash&grain=day&range=30d`; composed-URL reload re-hydrated all radios + subtitle; adversarial Custom→7d preserved sales_type + deleted from/to |
| `+page.svelte` CohortRetentionCard | `data.retention` | `retention_curve_v` SSR query | FLOWING | Carry-over |

**Notable (not a goal failure, carry-over):** Range-widening cache miss still silently calls `setRange(window)` without refetch (lines 86-92 `+page.svelte`). Narrowing always works. Flagged in prior VERIFICATION; 09-05 did not address; tracked for future hygiene pass. Not a blocker for any Phase 9 goal criterion.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full unit-test suite passes | `npx vitest run tests/unit/` | 97/97 pass across 11 test files (was 88/88 pre-09-05; +9 from Task 1) | PASS |
| 6 new urlState tests pass | (subset of above) | U1–U6 all pass: compose (U2 = UAT Test 9 repro), set+delete mix (U3), no-op (U6) | PASS |
| 3 new getWindow tests pass | (subset of above) | W1 seed, W2 setRange reflection, W3 fresh-object identity (`expect(getWindow()).not.toBe(getWindow())`) all pass | PASS |
| `new URL(page.url)` eliminated from all filter write-paths | `grep -rn "new URL(page\.url)" src/` | 1 match, only in `src/lib/urlState.ts:3` COMMENT (documents the bug this helper fixes). Zero runtime matches | PASS |
| `mergeSearchParams` wired in all 5 write-paths + definition | `grep -rn "mergeSearchParams" src/` | Definition in `urlState.ts` (lines 16, 20), 5 runtime callsites: `+page.svelte:97` (handleSalesType), `+page.svelte:103` (handleCashFilter), `GrainToggle.svelte:19` (select), `DatePickerPopover.svelte:72` (applyPreset), `DatePickerPopover.svelte:82` (applyCustom), plus 1 import per consumer file | PASS |
| Dead `$app/state` import removed from `+page.svelte` | `grep "from '\$app/state'" +page.svelte` | 0 matches | PASS |
| Dead `$app/state` import removed from `GrainToggle.svelte` + `DatePickerPopover.svelte` | `grep "from '\$app/state'"` | 0 matches in either file | PASS |
| `window={storeWindow}` piped to FilterBar | `grep "window={storeWindow}" +page.svelte` | 1 match (line 111) | PASS |
| `getWindow` exported + consumed | `grep "getWindow" dashboardStore.svelte.ts +page.svelte` | Definition + page import, both present | PASS |
| DatePickerPopover `dateLine` derivation UNTOUCHED | diff `git show c369ae6..75b48fc -- src/lib/components/DatePickerPopover.svelte` | Only URL-handler + import changes; lines 51-62 unchanged. Proof of "zero-child-component-behavior-change" hypothesis | PASS |
| No `goto(` remains anywhere in src/ | `grep 'goto(' src/` | 0 matches | PASS |
| Exactly 2 KpiTile usages on page | `grep -c '<KpiTile' +page.svelte` | 2 | PASS |
| FilterSheet / MultiSelect deleted | `ls src/lib/components/FilterSheet.svelte src/lib/components/MultiSelectDropdown.svelte` | Both return "No such file or directory" | PASS |
| All 4 referenced 09-05 commits exist | `git log --oneline 3ea3d11 c369ae6 75b48fc 39b8a56` | All 4 resolved with expected subjects (test / feat / fix / docs) | PASS |

**Integration/E2E tests:** Live-Supabase integration suites (phase8-visit-attribution, rls-policies, phase3-analytics) require DEV/TEST DB envs not exported in this sandbox — NOT Phase 9 regressions. E2E tests map to the orchestrator's autonomous Chrome-MCP UAT on DEV (which substituted for the Task 3 human checkpoint).

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|---------|
| VA-11 | 09-01, 09-02, 09-03, 09-04, 09-05 | Filters simplified to inhouse/takeaway + cash/card only; all tiles respect both | SATISFIED | FilterBar: exactly 2 SegmentedToggles. Both KpiTiles read `getKpiTotals()` which applies both filters. `FilterSheet.svelte` + `MultiSelectDropdown.svelte` deleted. 0 `payment_method` matches. 09-05 URL-composition fix ensures no filter is silently dropped when composing. REQUIREMENTS.md row 277 marked Complete |
| VA-12 | 09-01, 09-02, 09-03, 09-04, 09-05 | Granularity/range toggle client-side, <200ms | SATISFIED | All 5 filter write-paths use `replaceState(mergeSearchParams(...), {})` + synchronous store setters. No `goto`, no `invalidateAll`. Reactive `_filters` + `storeWindow` ensure UI updates without SSR round-trip. Orchestrator's Chrome-MCP UAT confirmed zero full-document reloads (`performance.getEntriesByType('navigation').length` stable at 1). REQUIREMENTS.md row 278 marked Complete |
| VA-13 | 09-02, 09-03, 09-04, 09-05 | 1 revenue reference card using active range/granularity, respects both filters | SATISFIED | Exactly 2 KpiTiles (Revenue + Transactions), both driven by `getKpiTotals()` applying `salesTypeFilter` + `cashFilter`. `rangeLabel` reactive via `storeFilters` (09-04). Date subtitle on DatePicker now reactive via `storeWindow` (09-05). REQUIREMENTS.md row 279 marked Complete |

**Orphaned requirements check:** REQUIREMENTS.md (lines 277-279) maps only VA-11, VA-12, VA-13 to Phase 9. All three list 09-05 in evidence column, all three verified in the codebase. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/routes/+page.svelte` | 86-92 | Range-widening cache miss silently calls `setRange(window)` without refetch | Info (carry-over) | User widens 7d → 90d: sees incomplete data with no visual warning. Narrowing always works. Flagged in prior VERIFICATION; 09-05 did not address; tracked for future hygiene. Not a blocker for any stated Phase 9 goal |

No blocker anti-patterns. No TODO/FIXME/placeholder/stub patterns introduced by 09-05. The only `new URL(page.url)` match (`src/lib/urlState.ts:3`) is a comment documenting the bug the helper fixes, not runtime code.

### Human Verification Required

**None.** Orchestrator's autonomous Chrome-MCP UAT against DEV verified every behavior that previously required a real browser:

- 30d click → button subtitle flips "Apr 11 – Apr 17" → "Mar 19 – Apr 17" (Bug A fix)
- 90d click → subtitle flips → "Jan 18 – Apr 17" (Bug A fix)
- Sequential Inhouse → Cash → Day → 30d → URL composes to `/?sales_type=INHOUSE&is_cash=cash&grain=day&range=30d` (Bug B fix)
- Composed-URL reload re-hydrates all radios + subtitle (SSR hydration contract)
- Zero full-document reloads throughout (nav count stable at 1)
- Adversarial: Custom → 7d preserves `sales_type`, deletes `from`/`to` (preset-path null-delete contract)

**Note on 09-UAT.md on-disk state:** The file still shows Tests 7 and 9 as `result: issue` — that reflects the pre-09-05 prod snapshot of 2026-04-17. Orchestrator's autonomous Chrome-MCP UAT on DEV post-09-05 supersedes the stale on-disk labels. A follow-up housekeeping pass can flip those two `result:` lines to `pass`; does not affect Phase 9 completion.

### Project-Level QA Context (not Phase 9 scope — included for traceability)

Per prior-verification note: `/qa-gate` returned BLOCK with project-wide findings. None are Phase 9 regressions:

| Finding | Severity | Scope |
|---------|----------|-------|
| Stale deploy pipeline | HIGH | Infrastructure backlog — NOT Phase 9 scope |
| Prod missing SSR security headers | HIGH | PARTIALLY CLOSED by unrelated quick task `11e85b9` (5 security headers applied to SSR responses) — NOT Phase 9 scope |
| V3 local tenant KPI=0 | INFO | Expected per UAT notes on 0/0 tenant — NOT a bug |
| CLAUDE.md doc staleness (Conventions / Architecture placeholder) | MEDIUM | Doc-only — NOT Phase 9 scope |
| Range-widening cache-miss UX | INFO | Carry-over; flagged for future hygiene pass — NOT a Phase 9 goal criterion |

---

## Summary

**Code-level verification: PASSED.** All 4 observable truths verify. All 16 artifacts (10 carry-over + 6 new/modified for 09-05) pass levels 1-3. All 12 key links wire correctly, including the 6 new links introduced by 09-05 (mergeSearchParams live-URL read, five write-path migrations, storeWindow → DatePicker prop cascade, getWindow fresh-object getter). All 7 data flows FLOWING — notably the new `storeWindow` → DatePickerPopover `dateLine` path and the URL-composition path across all 5 write-sites.

**97/97 unit tests pass** across 11 test files (was 88/88 pre-09-05). The 9 new tests (6 urlState U1–U6 + 3 getWindow W1–W3) prove both bug fixes at the unit layer, including Test U2 (Inhouse + Cash URL composition — direct UAT Test 9 repro) and Test W3 (fresh-object identity invariant that `$derived(getWindow())` reactivity depends on).

**Orchestrator Chrome-MCP UAT PASSED.** All 14 Task 3 verification behaviors confirmed on DEV: subtitle reactivity (30d / 90d), URL composition (sequential Inhouse→Cash→Day→30d), composed-URL reload re-hydration, zero full-document reloads, adversarial Custom→7d edge case.

**Requirements coverage complete.** VA-11, VA-12, VA-13 all SATISFIED with evidence in five plans (09-01 through 09-05) and marked Complete in REQUIREMENTS.md.

**Phase 9 goal achieved.** Filter bar shows exactly 2 filters (inhouse/takeaway + cash/card); granularity/range toggles respond client-side via `replaceState(mergeSearchParams(...), {})` + reactive store (no SSR round-trip, composing across clicks); dashboard shows 1 revenue reference card (plus 1 transactions card, both filter-scoped); DatePicker subtitle now tracks range clicks via reactive `storeWindow`; all tiles respect both filters.

**Out-of-scope findings (tracked separately):** Stale deploy pipeline, V3 local tenant KPI=0, CLAUDE.md doc staleness, range-widening cache-miss UX note. Prod SSR security headers partially addressed by unrelated quick task (`11e85b9`).

---

_Re-verified: 2026-04-17T02:45:00Z_
_Verifier: Claude (gsd-verifier)_
_Previous verification: 2026-04-17T01:30:00Z (status: passed, post-09-04 pre-09-05)_
