---
phase: 09-filter-simplification-performance
plan: 05
subsystem: ui
tags: [svelte5, runes, reactive-store, filters, sveltekit, url-composition, gap-closure]

# Dependency graph
requires:
  - phase: 09-filter-simplification-performance
    provides: reactive _filters state + getFilters() + replaceState pattern from 09-04
provides:
  - `src/lib/urlState.ts` with `mergeSearchParams(updates): URL` — reads live `window.location.href`, composes partial updates, returns URL for `replaceState`
  - `src/lib/dashboardStore.svelte.ts` new `getWindow(): RangeWindow` getter — returns fresh object every call so `$derived(getWindow())` re-runs on every `setRange()`
  - `+page.svelte` `storeWindow = $derived(getWindow())` piped into `<FilterBar window={storeWindow}>` — fixes DatePickerPopover date subtitle reactivity
  - All five filter write-paths (`handleSalesType`, `handleCashFilter`, `GrainToggle.select`, `DatePickerPopover.applyPreset`, `DatePickerPopover.applyCustom`) now use `mergeSearchParams` — sequential clicks compose URL instead of overwriting
  - UAT Tests 7 (date subtitle) and 9 (URL composition) ready to flip from `issue` → `pass` at next `/gsd:verify-work 9`
affects: [phase-9-uat-remaining-tests, phase-10-charts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "URL composition helper: single place reads `window.location.href` (not `page.url`) as the source of truth for post-replaceState writes — prevents silent param-drop class of bugs across all filter click handlers"
    - "Reactive RangeWindow getter: same module-private $state + public getter idiom as 09-04's `_filters`, but exposes the existing dateFrom/dateTo/priorFrom/priorTo vars without rewriting setRange(); fresh-object identity per call drives downstream `$derived(getWindow())` re-runs"

key-files:
  created:
    - src/lib/urlState.ts
    - tests/unit/urlState.test.ts
    - .planning/phases/09-filter-simplification-performance/09-05-SUMMARY.md
  modified:
    - src/lib/dashboardStore.svelte.ts
    - src/routes/+page.svelte
    - src/lib/components/GrainToggle.svelte
    - src/lib/components/DatePickerPopover.svelte
    - tests/unit/dashboardStore.test.ts

key-decisions:
  - "Root cause of Bug A (Test 7): the 09-04 fix rewired `data.filters` → `getFilters()` but did NOT rewire `data.window` — a different prop on the same FilterBar, different code path. The frozen-SSR pattern had a second instance left uncaught."
  - "Root cause of Bug B (Test 9): `page.url` from `$app/state` reflects the last full NAVIGATION event, NOT `replaceState` updates. `window.location.href` is the correct live source for composing URL updates after `replaceState`. Every filter click handler that read `page.url` was silently building URLs from a stale snapshot."
  - "Separate `getWindow()` getter (not a `setWindowId()` action) because `setRange()` already writes all four window vars — the fix is pure exposure, not new state. Zero risk to the existing widest-window cache semantics that drive KPI math."
  - "One helper, five callsites. A shared `mergeSearchParams` helper instead of duplicating `new URL(window.location.href) + searchParams.set + replaceState` five times — next filter added to the app can't silently regress this class of bug."

patterns-established:
  - "When a prop reads from an SSR snapshot and the UI needs reactivity, expose a reactive getter from the store and pipe it through a `$derived` at the page level — NO child-component change required. (Same idiom as 09-04 `getFilters()`, now applied to `getWindow()`.)"
  - "URL-composing helpers must read `window.location.href`, never `page.url`, after the first `replaceState` in the session. Future filters: use `mergeSearchParams` from day 1."

requirements-completed: [VA-11, VA-12, VA-13]

# Metrics
duration: ~4 min (code execution) + human UAT pending
completed: 2026-04-17
---

# Phase 9 Plan 5: Reactive Date Subtitle + URL Composition Summary

**Closed two residual filter-reactivity bugs surfaced by UAT 2026-04-17 after 09-04 shipped — date subtitle now tracks range clicks via `getWindow()` reactive prop, and sequential filter clicks compose URL params via a shared `mergeSearchParams` helper that reads the live browser URL instead of the stale `page.url`.**

## Performance

- **Duration:** ~4 min code execution (3 commits, 02:30 → 02:34) + human UAT pending
- **Completed:** 2026-04-17 (code); UAT gate open
- **Tasks:** 3 (1 TDD auto + 1 rewire auto + 1 human UAT checkpoint — code tasks complete)
- **Files modified:** 5 source + 2 test
- **Deviations:** 0 (no Rule-1/2/3 fixes needed; pre-existing TS errors unchanged per deferred-items.md scope boundary)

## Accomplishments

- New `src/lib/urlState.ts` with `mergeSearchParams(updates): URL` — reads `window.location.href`, applies partial updates (string=set, null=delete), returns URL for `replaceState`
- New `getWindow(): RangeWindow` getter in `dashboardStore.svelte.ts` — returns a FRESH object every call, so `$derived(getWindow())` re-runs on every `setRange()`; identity-change invariant locked by unit test W3
- All five filter write-paths migrated from `new URL(page.url)` to `mergeSearchParams(..)`: `+page.svelte#handleSalesType`, `+page.svelte#handleCashFilter`, `GrainToggle.select`, `DatePickerPopover.applyPreset`, `DatePickerPopover.applyCustom`
- `+page.svelte` passes `window={storeWindow}` (reactive) to `<FilterBar>`; DatePickerPopover's `dateLine` derivation untouched — the prop-reactive hypothesis from 09-04 held a second time
- Dead `page` import from `$app/state` removed from `+page.svelte`, `GrainToggle.svelte`, and `DatePickerPopover.svelte`
- Unit suite: 88 → 97 (+6 urlState U1–U6, +3 getWindow W1–W3), 97/97 green on `npx vitest run tests/unit/`
- `npx svelte-kit sync` clean; `npx tsc --noEmit -p .` reports the same 10 pre-existing errors from deferred-items.md — zero new errors introduced

## Task Commits

1. **Task 1 RED — Add failing tests for mergeSearchParams + getWindow** — `3ea3d11` (test)
2. **Task 1 GREEN — Add mergeSearchParams helper and getWindow store getter** — `c369ae6` (feat)
3. **Task 2 — Merge URL params on filter clicks; pass reactive window to DatePicker** — `75b48fc` (fix)
4. **Task 3 — Human UAT on DEV/prod** — pending (no code commit; verification only)

Plan metadata commit (this SUMMARY + STATE.md + ROADMAP.md + REQUIREMENTS.md updates) is the final commit below.

## Exact Edits Applied

### `src/lib/urlState.ts` (new file, 32 lines)

- New module exporting `mergeSearchParams(updates: Record<string, string | null>): URL`
- Reads `window.location.href` as the source URL — not `page.url` from `$app/state`, which is the stale SSR-era snapshot after `replaceState`
- For each key in `updates`: string value → `url.searchParams.set(key, value)`; `null` value → `url.searchParams.delete(key)`
- Browser-only — throws a clear `'mergeSearchParams requires a browser environment'` error if called in SSR (all callers are click handlers by construction)

### `src/lib/dashboardStore.svelte.ts` (+11 lines)

- New `getWindow(): RangeWindow` getter added after the existing `getFilters` export
- Returns `{ from: dateFrom, to: dateTo, priorFrom, priorTo }` — a FRESH object literal every call
- JSDoc explicitly warns against memoization — downstream `$derived(getWindow())` depends on identity change to re-run
- Zero changes to `setRange()` or any other setter — pure read-only addition

### `src/routes/+page.svelte` (+13/-11 lines)

- Imports: added `getWindow` to the dashboardStore import; added `import { mergeSearchParams } from '$lib/urlState';`; removed `import { page } from '$app/state';` (dead after the migration)
- New `const storeWindow = $derived(getWindow());` below the existing `storeFilters` derivation
- `handleSalesType`: `new URL(page.url) + .set + replaceState` → `replaceState(mergeSearchParams({ sales_type: v }), {})`
- `handleCashFilter`: same migration to `mergeSearchParams({ is_cash: v })`
- `handleRangeChange`'s custom-recovery branch now reads from `globalThis.window.location.href` instead of `page.url` — `globalThis` prefix needed because the local `window: RangeWindow` variable shadows the browser `window` inside the function
- `<FilterBar>` prop: `window={data.window}` → `window={storeWindow}`

### `src/lib/components/GrainToggle.svelte` (+1/-1 lines, reorganized)

- Imports: `import { page } from '$app/state';` dropped; `import { mergeSearchParams } from '$lib/urlState';` added
- `select()`: `new URL(page.url) + .set('grain', v) + replaceState(url)` → `replaceState(mergeSearchParams({ grain: value }), {})`
- No template changes

### `src/lib/components/DatePickerPopover.svelte` (+12/-14 lines)

- Imports: `import { page } from '$app/state';` dropped (no consumer remained after migration); `import { mergeSearchParams } from '$lib/urlState';` added
- `applyPreset`: `new URL(page.url) + .set('range', id) + .delete('from') + .delete('to') + replaceState(url)` → `replaceState(mergeSearchParams({ range: id, from: null, to: null }), {})`
- `applyCustom`: `new URL(page.url) + 3× .set + replaceState(url)` → `replaceState(mergeSearchParams({ range: 'custom', from: fromDraft, to: toDraft }), {})`
- **`dateLine` derivation UNTOUCHED** — lines 51-62 still read from `rangeWindow.from`/`rangeWindow.to`. The fix is that the prop is now reactive (fed from `storeWindow` at the page level), not that the derivation logic changed. Proof the prop-reactive hypothesis held a second time, same as 09-04.

### `tests/unit/urlState.test.ts` (new file, 55 lines)

- `// @vitest-environment jsdom` pragma on line 1 (matches FilterBar.test.ts pattern — vitest.config.ts default environment is `node`)
- Six tests (U1–U6) covering:
  - U1: set new param on empty URL
  - U2: compose with existing params (direct UAT Test 9 repro)
  - U3: set + delete mix preserves unrelated params
  - U4: composition with custom range
  - U5: overwrite same key, no duplicates
  - U6: empty updates returns current URL unchanged

### `tests/unit/dashboardStore.test.ts` (+61 lines)

- Extended imports to include `getWindow`
- New `describe('getWindow', ...)` block appended after the existing `reactive filters state` block:
  - W1: returns seeded window after `initStore`
  - W2: reflects `setRange()` output (live state, not stale snapshot)
  - W3: returns a fresh object on every call — identity-change invariant that `$derived(getWindow())` depends on

## Sanity-Grep Results (Post-Edit)

```
grep -nE "new URL\(page\.url\)" src/routes/+page.svelte src/lib/components/
  → ZERO matches (plan invariant met)

grep -rn "mergeSearchParams" src/
  → 5 callsites (handleSalesType, handleCashFilter, GrainToggle.select,
     DatePickerPopover.applyPreset, DatePickerPopover.applyCustom)
    + 1 definition (src/lib/urlState.ts)
    + docblock references — total 6 logical usages

grep -nE "from '\$app/state'" src/routes/+page.svelte
  → ZERO matches (dead page import removed)

grep -n "window=\{storeWindow\}" src/routes/+page.svelte
  → 1 match (line 111)
```

## UAT Evidence

**PENDING — Human UAT gate open.**

The plan's Task 3 is a `checkpoint:human-verify` on DEV (or local if CF Pages deploy pipeline is still broken per the STATE.md blocker). The user must run the 14-step Chrome verification script from `09-05-PLAN.md` Task 3 `<how-to-verify>` and approve. After approval, `/gsd:verify-work 9` should be re-run to flip UAT Tests 7 and 9 from `result: issue` → `result: pass`.

Expected behaviors (per plan `<how-to-verify>`):

- **Bug A (Test 7):** DatePickerPopover's date subtitle flips on 30d → 90d → custom clicks, not just the range-id label
- **Bug B (Test 9):** URL composes across sequential filter clicks — `/` → `?sales_type=INHOUSE` → `?sales_type=INHOUSE&is_cash=cash` → `?sales_type=INHOUSE&is_cash=cash&grain=day` → `?sales_type=INHOUSE&is_cash=cash&grain=day&range=30d`
- **Regression guards:** No full document reloads on rapid preset clicks; 09-04 aria-checked behavior preserved

## Zero-Child-Component-Behavior-Change Confirmation

`DatePickerPopover.svelte`'s `dateLine` derivation (lines 51-62) was NOT modified in this plan — verified by `git diff c369ae6..75b48fc -- src/lib/components/DatePickerPopover.svelte`. Every change is a URL-handler migration (applyPreset, applyCustom, imports). The subtitle reactivity fix comes entirely from the prop now being `$derived(getWindow())` at the page level. Same pattern as 09-04 (trust Svelte 5 prop reactivity to propagate once the prop is reactive at the root).

## Files Created/Modified

**Created:**
- `src/lib/urlState.ts` — 32-line helper
- `tests/unit/urlState.test.ts` — 55-line jsdom-env test suite (6 tests)
- `.planning/phases/09-filter-simplification-performance/09-05-SUMMARY.md` — this file

**Modified:**
- `src/lib/dashboardStore.svelte.ts` — getWindow() getter (+11 lines)
- `src/routes/+page.svelte` — getWindow import, storeWindow $derived, handleSalesType/handleCashFilter + handleRangeChange migration, FilterBar window prop swap, page import removed
- `src/lib/components/GrainToggle.svelte` — select() migration, page import dropped
- `src/lib/components/DatePickerPopover.svelte` — applyPreset/applyCustom migration, page import dropped; dateLine untouched
- `tests/unit/dashboardStore.test.ts` — getWindow import + 3 new tests (W1–W3)

## Decisions Made

1. **Same idiom as 09-04, second instance.** 09-04 rewired `data.filters` → `getFilters()` but missed `data.window` — different prop on the same FilterBar, same class of frozen-SSR drift. The fix is a drop-in: new `getWindow()` getter + `$derived(getWindow())` at page level + prop swap. Zero DatePickerPopover behavior change needed.
2. **One helper, five callsites.** The five filter click handlers all had the same `new URL(page.url) + searchParams.mutate + replaceState(url)` shape with a latent stale-snapshot bug. Centralizing to `mergeSearchParams` removes the per-callsite opportunity for regression when Phase 10 adds new filters. The helper reads `window.location.href` — the only live source after `replaceState`.
3. **Fresh object on every `getWindow()` call, documented and tested.** Memoizing the return would silently break `$derived(getWindow())` reactivity because Svelte's reactivity triggers on identity change. Test W3 locks this invariant explicitly.

## Deviations from Plan

None — plan executed exactly as written. No Rule-1 bugs, no Rule-2 missing functionality, no Rule-3 blockers surfaced during this plan's execution. The 10 pre-existing TypeScript errors surfaced again during Task 2 typecheck; all match deferred-items.md exactly, none in files this plan touched, scope-excluded unchanged.

## Issues Encountered

None in the code path. Human UAT has not run yet — if any of the 14 verification steps fail, the checkpoint will bounce back here for diagnosis.

## Authentication Gates

None.

## User Setup Required

None — no external service configuration needed. Once CF Pages deploy pipeline is unblocked (STATE.md blocker), these three commits will land on DEV automatically.

## Next Phase Readiness

- Phase 9 UAT Tests 7 and 9 ready to re-run on next `/gsd:verify-work 9` — both should flip to `result: pass` after human UAT approves.
- Phase 10 (Charts) — not blocked by this plan. Any new chart-layer filters should use `mergeSearchParams` from day 1 to avoid re-introducing the URL-composition class of bug.

---
*Phase: 09-filter-simplification-performance*
*Completed: 2026-04-17 (code); human UAT pending*

## Self-Check: PASSED

- [x] `09-05-SUMMARY.md` exists at `.planning/phases/09-filter-simplification-performance/09-05-SUMMARY.md`
- [x] Task commits present: `3ea3d11` (RED test), `c369ae6` (GREEN feat), `75b48fc` (fix rewire) — verified via `git log --oneline --all | grep`
- [x] Source files exist in repo: `src/lib/urlState.ts`, `src/lib/dashboardStore.svelte.ts`, `src/routes/+page.svelte`, `src/lib/components/GrainToggle.svelte`, `src/lib/components/DatePickerPopover.svelte`
- [x] Test files exist in repo: `tests/unit/urlState.test.ts`, `tests/unit/dashboardStore.test.ts`
- [x] Unit test count delta verified: 88 → 97 (+6 urlState U1–U6, +3 getWindow W1–W3); full `npx vitest run tests/unit/` → 97/97 pass
- [x] Typecheck errors unchanged: 10 pre-existing errors per deferred-items.md, zero new errors in files touched
- [x] Sanity greps met: 0× `new URL(page.url)` in `src/`; 5× `mergeSearchParams` callsites; 0× `$app/state` import in `+page.svelte`; 1× `window={storeWindow}`
- [x] Child-component behavior change: zero (DatePickerPopover `dateLine` derivation untouched — verified by `git diff c369ae6..75b48fc`)
