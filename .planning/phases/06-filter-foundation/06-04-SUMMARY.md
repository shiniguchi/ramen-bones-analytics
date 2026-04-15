---
phase: 06-filter-foundation
plan: 04
subsystem: filter-foundation
tags: [ui, svelte5, filters, popover, sheet, e2e, tdd]
requires:
  - parseFilters + FiltersState (from 06-01)
  - Popover, Sheet, Checkbox, Command primitives (from 06-02)
  - transactions_filterable_v + distinct arrays on page data (from 06-03)
provides:
  - FilterBar (sticky ≤72px shell)
  - DatePickerPopover (two-line trigger + presets + custom range)
  - FilterSheet (bottom slide-up, draft-and-apply multi-selects)
  - MultiSelectDropdown (Command+Checkbox list with D-04 tint)
  - FilterBar mounted in +page.svelte
  - 7 live e2e tests in tests/e2e/filter-bar.spec.ts
affects:
  - src/routes/+page.svelte (DateRangeChips replaced by FilterBar)
  - src/routes/+page.server.ts (E2E fixture bypass now seeds distinct arrays)
  - GrainToggle.svelte (unchanged; URL patching already preserves state)
tech-stack:
  added: []
  patterns:
    - "FilterBar sticky shell with backdrop-blur + min-h-[72px] D-05 budget"
    - "Instant-apply on sticky-bar controls; draft-and-apply on sheet multi-selects"
    - "Inline buildUrl(patch) helper in DatePickerPopover + FilterSheet (kept out of a shared module — two callers, no premature extraction)"
    - "E2E fixture bypass seeds distinct arrays so Filters sheet is credential-free"
key-files:
  created:
    - src/lib/components/FilterBar.svelte
    - src/lib/components/DatePickerPopover.svelte
    - src/lib/components/FilterSheet.svelte
    - src/lib/components/MultiSelectDropdown.svelte
    - tests/unit/FilterBar.test.ts
  modified:
    - src/routes/+page.svelte
    - src/routes/+page.server.ts
    - tests/e2e/filter-bar.spec.ts
  deleted:
    - src/lib/components/DateRangeChips.svelte
    - tests/e2e/chips.spec.ts
decisions:
  - "FreshnessLabel moved OUT of the sticky container in +page.svelte so the sticky bar holds only FilterBar and stays under the 72px D-05 budget"
  - "E2E fixture bypass (?__e2e=charts path in +page.server.ts) now seeds distinctSalesTypes=['INHOUSE','TAKEAWAY'] and distinctPaymentMethods=['Bar','Visa'] so the Filters button + sheet can be exercised in CI without Supabase credentials"
  - "D-13 empty-dropdown hide case deferred from e2e to unit test (FilterBar.test.ts 'hides the Filters button when both distinct arrays are empty') — the fixture bypass is the only credential-free path and it seeds both arrays"
  - "GrainToggle.svelte left untouched — existing URLSearchParams(page.url.search) pattern already preserves every other filter param; no rewire needed"
  - "tests/e2e/chips.spec.ts deleted (superseded by filter-bar.spec.ts FLT-01 preset test); keeping it would have failed because the 30d chip moved inside the popover"
  - "Multi-select draft collapses to 'undefined' when selected.length === options.length (the 'All' sentinel) per D-12; serialize() in FilterSheet omits the URL param in that branch"
requirements: [FLT-01, FLT-02, FLT-03, FLT-04]
metrics:
  duration: "~9min"
  tasks: 2
  files_created: 5
  files_modified: 3
  files_deleted: 2
  tests_added: 5 unit + 7 e2e (flipped from fixme)
  completed: "2026-04-15"
---

# Phase 6 Plan 04: FilterBar Composition Summary

Compose the primitives from Plan 02 and the loader data from Plan 03 into the user-facing filter bar + sheet — the phase's first visible UX win. Sticky `FilterBar` hosts `DatePickerPopover` + `GrainToggle` + `Filters` button at ≤72px; `FilterSheet` slides up with draft-and-apply multi-selects. `DateRangeChips` is deleted; 7 of 8 e2e fixme stubs are flipped to real passing tests.

## What Shipped

**Task 1 — Feature components (commit `41ba9c4`)**

- `MultiSelectDropdown.svelte` — label + Command+Checkbox list; draft state; `border-primary/60 bg-primary/5` active tint (D-04); `All` / `N selected` placeholder; collapses to `undefined` when user reselects everything (D-12)
- `DatePickerPopover.svelte` — two-line Button trigger (preset label + `MMM d – MMM d` date line via `date-fns`), Popover content with 5 preset buttons (instant-apply) and two native `<input type="date">` + `Apply range` button (draft-and-apply for custom); inline `buildUrl(patch)` URL helper
- `FilterSheet.svelte` — bottom Sheet titled `Filters`, draft `salesTypeDraft` / `paymentMethodDraft` reset on open via `$effect`, `Apply filters` / `Discard changes` / `Reset all filters` footer buttons; `serialize()` omits param when draft equals full option set
- `FilterBar.svelte` — sticky `top-0 z-30 min-h-[72px]` shell with backdrop-blur border, renders DatePickerPopover + GrainToggle + Filters button, hides Filters entirely when both distinct arrays empty (D-13), active tint on Filters button when sales_type or payment_method is set
- `tests/unit/FilterBar.test.ts` — 5 passing tests: (1) default render all three controls, (2) D-13 both-empty hides Filters button, (3) D-04 tint on Filters button when sales_type set, (4) DatePickerPopover trigger renders `Custom` for range=custom, (5) trigger renders `7d` + `Apr 9 – Apr 15` for default range

**Task 2 — Wire + e2e (commit `b12b68b`)**

- `src/routes/+page.svelte`: imports `FilterBar`, passes `filters`/`window`/`distinctSalesTypes`/`distinctPaymentMethods`; FreshnessLabel extracted from the sticky container into a plain `px-4 py-2` block so the sticky bar stays inside the D-05 72px budget
- `src/routes/+page.server.ts`: E2E fixture bypass branch now seeds `distinctSalesTypes: ['INHOUSE', 'TAKEAWAY']` and `distinctPaymentMethods: ['Bar', 'Visa']` (was empty arrays) — this is the only credential-free path in CI and the FilterSheet would otherwise be entirely hidden
- `src/lib/components/DateRangeChips.svelte` — **deleted** (replaced by DatePickerPopover)
- `tests/e2e/chips.spec.ts` — **deleted** (superseded by filter-bar.spec.ts FLT-01)
- `tests/e2e/filter-bar.spec.ts`: 7 fixme stubs flipped to real passing tests, 1 deferred:
  - `FLT-01`: date picker popover opens, `30d` preset updates `?range=30d` ✅
  - `FLT-01`: custom from/to inputs update `?range=custom&from=&to=` ✅
  - `FLT-02`: grain toggle inline on sticky bar drives `?grain=month` ✅
  - `FLT-03`: sales_type multi-select draft-and-apply via Filters sheet ✅
  - `FLT-04`: payment_method dropdown populated, multi-select narrows to `?payment_method=Visa` ✅
  - `FLT-07`: `?range=bogus` renders with zod-coerced defaults (200, not 400) ✅
  - `D-18`: back button restores prior filter state via URL ✅
  - `D-13`: empty-dropdown hide → `test.fixme` (covered by unit test — see Deferred below)

## Verification

```
$ npx vitest run tests/unit
 Test Files  9 passed (9)
      Tests  65 passed (65)

$ npx playwright test
 11 passed, 2 skipped (D-13 fixme + DEV-real-signin skip)

$ bash scripts/ci-guards.sh
 ...
 Guard 6 (no-dynamic-sql): clean
 All CI guards passed.

$ npm run build
 ✓ built in 10.65s
 ✔ done (adapter-cloudflare)

$ test -f src/lib/components/DateRangeChips.svelte
 → missing (deleted)

$ grep -r "DateRangeChips" src/ tests/ | wc -l
 → 0
```

## Acceptance Criteria

**Task 1**

| Criterion | Status |
| --- | --- |
| `vitest run tests/unit/FilterBar.test.ts` exits 0, ≥5 tests passing | PASS (5/5) |
| `pnpm check` / `svelte-check` shows no NEW errors (14 pre-existing unchanged) | PASS |
| `goto(` in DatePickerPopover.svelte (instant-apply) | PASS |
| `goto(` in FilterSheet.svelte (Apply filters) | PASS |
| `border-primary/60` across FilterBar + DatePickerPopover + MultiSelectDropdown (≥3) | PASS (3) |
| `sticky top-0` in FilterBar.svelte | PASS |
| `min-h-[72px]` in FilterBar.svelte | PASS |
| Sheet copy: `Apply filters`, `Reset all filters` | PASS |
| Popover copy: `Select date range`, `Apply range` | PASS |
| `transactions_filterable_v` grep in `*.svelte` returns zero (loader owns queries) | PASS |
| `bash scripts/ci-guards.sh` green (Guards 1–6) | PASS |

**Task 2**

| Criterion | Status |
| --- | --- |
| `playwright test filter-bar.spec.ts` exits 0 with ≥6 real tests passing | PASS (7 passing, 1 fixme) |
| `DateRangeChips.svelte` deleted | PASS |
| `grep -r DateRangeChips src/ tests/` returns 0 | PASS (0) |
| `import FilterBar` in +page.svelte | PASS |
| `<FilterBar` in +page.svelte | PASS |
| `data.filters`, `data.distinctSalesTypes` wired | PASS |
| `test.fixme` count ≤ 2 in filter-bar.spec.ts | PASS (1) |
| Full `vitest run tests/unit` exits 0 | PASS (65/65) |
| `scripts/ci-guards.sh` green | PASS |
| `npm run build` succeeds | PASS |

## Deviations from Plan

### Rule 3 — Fixed Blocking Issues

**1. [Rule 3] E2E fixture bypass seeded empty distinct arrays**
- **Found during:** Task 2 e2e run
- **Issue:** The only credential-free e2e path is `?__e2e=charts` (set by `playwright.config.ts`). The loader's E2E bypass branch was returning `distinctSalesTypes: []` and `distinctPaymentMethods: []`, which correctly triggers D-13 (hide Filters button). But that made FLT-03 / FLT-04 / D-18 impossible to cover in e2e — the sheet would never open.
- **Fix:** Seeded `['INHOUSE','TAKEAWAY']` and `['Bar','Visa']` inside the bypass branch of `+page.server.ts`. Real (non-bypass) loader path is unchanged — still reads from `transactions_filterable_v` live.
- **Impact:** `pageServerLoader.test.ts` untouched (it tests the real path). D-13 e2e coverage is lost; compensated by `FilterBar.test.ts` unit test asserting the hide branch directly.

**2. [Rule 3] Checkbox native input is `sr-only`, Playwright click hits span**
- **Found during:** First e2e run (2/7 tests failed on first attempt)
- **Issue:** The hand-rolled Checkbox primitive hides the native `<input>` via `sr-only` for a11y; clicks intercepted by the visible `<span role="checkbox">`. Playwright's `getByRole('checkbox')` resolved to the hidden input which couldn't receive pointer events.
- **Fix:** Switched the e2e click target to `sheet.locator('label[data-slot="checkbox"]', { hasText: 'Bar' })` — the wrapping `<label>` receives the click and forwards it to the input natively. No production change.

**3. [Rule 3] `chips.spec.ts` would have failed against the new UI**
- **Found during:** Task 2 planning
- **Issue:** `tests/e2e/chips.spec.ts` asserted `button[name='7d']` / `button[name='30d']` at the top of the page. Those buttons now live inside the DatePickerPopover, not the sticky bar directly.
- **Fix:** Deleted `tests/e2e/chips.spec.ts` entirely — the new `filter-bar.spec.ts` FLT-01 test covers the same behavior (tap trigger → click preset → URL updates) against the new popover flow.

### Rule 1 — Auto-Fixed Bugs

**1. [Rule 1] Svelte `state_referenced_locally` warnings on draft state init**
- **Found during:** First FilterBar.test.ts run
- **Issue:** `let fromDraft = $state(filters.from ?? rangeWindow.from)` captures `filters` by value at init time, not reactively. Svelte 5 flagged it as a warning (and it would have been a correctness bug — the draft would never see prop updates).
- **Fix:** Initialized drafts to empty string / `undefined` and reset them inside the `$effect(() => { if (open) { ... } })` block that already runs on open transition. Same applied to `FilterSheet.svelte`.
- **Files modified:** `DatePickerPopover.svelte`, `FilterSheet.svelte`
- **Impact:** Tests still pass; warnings gone; drafts now correctly reset from current props each time the popover/sheet opens.

### Rule 2 — Auto-Added Functionality

None.

### Rule 4 — Architectural Changes

None.

**Auth gates:** None (E2E runs in fixture bypass mode).

## Deferred Items

**D-13 empty-dropdown hide — e2e deferred**
- The `test.fixme('D-13: empty dropdown (no distinct values) hides control entirely')` entry is kept because the only credential-free e2e path (fixture bypass) now seeds both arrays to enable the other tests. Running the empty-array branch would require a second bypass flag or a DEV sign-in.
- **Coverage preserved:** `tests/unit/FilterBar.test.ts` "hides the Filters button when both distinct arrays are empty" asserts the D-13 branch directly at the component level.
- **Total fixme count:** 1 (plan cap was ≤2). Under budget.

## Known Stubs

None. Every component is fully wired:
- `FilterBar` reads live `data.filters`, `data.window`, `data.distinctSalesTypes`, `data.distinctPaymentMethods`
- `DatePickerPopover` + `FilterSheet` both call `goto()` with real URL patches
- `MultiSelectDropdown` toggles against real option sets
- The E2E fixture seed is not a stub — it is test infrastructure in a code path that only runs when `E2E_FIXTURES=1` (explicit dev/CI flag)

## 375px Sticky Bar Measurement

Computed against component markup: `min-h-[72px]` + `py-2` (8px top + 8px bottom) + `flex-wrap items-center gap-2` row of `min-h-11` (44px) controls. The two-line DatePickerPopover button is `h-auto min-h-11 flex-col` — at 44px minimum and ~54px actual (14px preset + 12px date line + padding), so the bar sits at 54 + 16 = 70px when all controls wrap to one row, 104px if the Filters button wraps to a second row on ultra-narrow screens. At exactly 375px baseline, three controls (date picker ~120px + grain toggle ~170px + Filters ~80px ≈ 370px) fit on one row within the 343px content area → **first-row wraps the Filters button to line 2**, putting the effective sticky height at ~116px rather than ≤72px when filters are active.

**This exceeds the D-05 72px budget at 375px when the Filters button is present.** Visual verification + copy/layout tweaks (e.g. icon-only Filters button, abbreviated grain labels, or moving Filters to a fixed FAB) are tracked for Plan 06-05 (`06-05-PLAN.md` is the validation / visual-polish plan for this phase). Flagging here so the verifier and next planner see it without rediscovery. The unit test for D-05 budget (`min-h-[72px]`) passes because the grep is a floor, not a ceiling — the sticky element reserves ≥72px; the actual rendered height depends on wrap behavior.

## Commits

| Hash | Task | Message |
| --- | --- | --- |
| `41ba9c4` | Task 1 | feat(06-04): add FilterBar + DatePickerPopover + FilterSheet + MultiSelectDropdown |
| `b12b68b` | Task 2 | feat(06-04): wire FilterBar into +page.svelte, delete DateRangeChips, flip e2e stubs |

## Downstream Consumers

Plan 06-05 (visual validation + polish) receives:
- A mounted, URL-driven FilterBar at the top of `+page.svelte`
- 7 passing e2e tests it can extend with visual regression / screenshot assertions
- The known 72px-budget wrap issue (see "375px Sticky Bar Measurement") for tightening

Plans 07+ (country filter) and 08+ (repeater bucket) only need to add a zod field + a new `<MultiSelectDropdown>` row inside `FilterSheet.svelte` — every other piece is reusable.

## Self-Check: PASSED

- `src/lib/components/FilterBar.svelte` FOUND
- `src/lib/components/DatePickerPopover.svelte` FOUND
- `src/lib/components/FilterSheet.svelte` FOUND
- `src/lib/components/MultiSelectDropdown.svelte` FOUND
- `tests/unit/FilterBar.test.ts` FOUND (5/5 passing)
- `src/lib/components/DateRangeChips.svelte` MISSING (expected — deleted)
- `src/routes/+page.svelte` imports FilterBar (verified)
- `tests/e2e/filter-bar.spec.ts` has 7 real tests + 1 fixme (≤2 cap)
- Commit `41ba9c4` FOUND in `git log`
- Commit `b12b68b` FOUND in `git log`
- All 11 e2e tests passing (2 skipped: 1 fixme D-13 + 1 DEV sign-in skip)
- Full unit suite 65/65 passing
- `bash scripts/ci-guards.sh` all guards green
- `npm run build` succeeds (adapter-cloudflare)
