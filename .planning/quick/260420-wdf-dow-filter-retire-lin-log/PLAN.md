---
task: 260420-wdf
title: Day-of-week filter + retire Lin/Log toggle
branch: feature/dashboard-chart-improvements-260418
status: in-progress
created: 2026-04-20
---

# wdf — Day-of-week filter + retire Lin/Log toggle

Add a 7-checkbox "Days" filter (Mon=1..Sun=7) to FilterBar, applied client-side to KPI tiles + non-cohort charts. Hardcode benchmark interpolation to `log-linear` and delete the InterpolationToggle. Show an amber caveat on retention/repeater-cohort cards when day filter is active (cohorts intentionally use all days). Dim excluded-DOW cells in the daily heatmap. Pure client-side — no SQL.

## Files in scope

**Schema + state:**
- `src/lib/filters.ts` — add `days` field, remove `interp`
- `src/lib/dashboardStore.svelte.ts` — add `daysFilter`, extend `filterRows`, remove `setInterp`

**SSR + URL plumbing:**
- `src/routes/+page.server.ts` — pass `filters.days` through to client
- `src/routes/+page.svelte` — `handleDaysChange` + URL sync via `mergeSearchParams`

**UI:**
- `src/lib/components/FilterBar.svelte` — Days popover (7 checkboxes + 3 presets)
- `src/lib/components/DailyHeatmapCard.svelte` — dim excluded-day cells (opacity 0.2)
- `src/lib/components/CohortRetentionCard.svelte` — remove toggle, hardcode log-linear, add caveat
- `src/lib/components/RepeaterCohortCountCard.svelte` — add caveat
- `src/lib/components/InterpolationToggle.svelte` — DELETE

**Tests:**
- `tests/unit/FilterBar.test.ts` — fixtures + Days popover smoke test
- `tests/unit/dashboardStore.test.ts` — fixtures + 4 DOW filterRows tests
- `tests/unit/urlState.test.ts` — `days` param round-trip

## Constraints honored

- Mobile-first (44px tap targets in popover)
- `days` is client-side only — no SSR refetch (same pattern as sales_type / is_cash)
- `replaceState` via `mergeSearchParams` — no `goto()` needed, no invalidate trap
- Backward compat: zod silently strips unknown `interp` query param
- `getDay()` Sun=0..Sat=6 → Mon=1..Sun=7 transform reused from existing `mondayFirstRow` heatmap helper

---

## Task 1 — Filter schema + store + URL + FilterBar Days popover

**Files:**
- `src/lib/filters.ts`
- `src/lib/dashboardStore.svelte.ts`
- `src/routes/+page.server.ts`
- `src/routes/+page.svelte`
- `src/lib/components/FilterBar.svelte`
- `tests/unit/FilterBar.test.ts` (fixtures + smoke)
- `tests/unit/dashboardStore.test.ts` (fixtures + 4 DOW tests)
- `tests/unit/urlState.test.ts` (1 test)

**Action:**

1. **`filters.ts`:**
   - Add `DAY_VALUES = [1,2,3,4,5,6,7] as const` and `DAYS_DEFAULT = [1,2,3,4,5,6,7]`.
   - Replace `interp` field with `days` in `filtersSchema`:
     ```ts
     days: z.string()
       .transform(s => Array.from(new Set(s.split(',').map(Number).filter(n => n>=1 && n<=7))).sort((a,b)=>a-b))
       .pipe(z.array(z.number()))
       .catch(() => [...DAYS_DEFAULT])
     ```
     Provide a default branch so missing param yields `[1..7]` (use `.default('1,2,3,4,5,6,7')` before `.transform`).
   - Remove `INTERP_VALUES`, `interp` from `FILTER_DEFAULTS`. Add `days: [1,2,3,4,5,6,7]` to `FILTER_DEFAULTS`.
   - `parseFilters` — no signature change.

2. **`dashboardStore.svelte.ts`:**
   - Add `let daysFilter = $state<number[]>([1,2,3,4,5,6,7]);`
   - Extend `filterRows` signature: add `days: number[]` last parameter. Inside the predicate, after the existing date-window check, add:
     ```ts
     // Mon=1..Sun=7 (JS getDay: Sun=0..Sat=6 → +6 mod 7 + 1)
     if (days.length < 7) {
       const dow = ((parseISO(r.business_date).getDay() + 6) % 7) + 1;
       if (!days.includes(dow)) return false;
     }
     ```
     Skip the `parseISO` work when `days.length === 7` for perf.
   - Update `_filtered` and `_priorFiltered` `$derived.by` blocks to pass `daysFilter` into `filterRows`.
   - Add `setDaysFilter(v: number[])` action: `daysFilter = v; _filters = { ..._filters, days: v };`
   - Remove `setInterp` action.
   - Extend `initStore` `data` shape: add `daysFilter: number[]`. Inside, `daysFilter = data.daysFilter;`

3. **`+page.server.ts`:**
   - `parseFilters(url)` already returns `filters.days` via the schema change — no extra work, just confirm `filters` is forwarded to client (it is). No SQL filter — daily rows come back unfiltered for client-side rebucketing (same as existing pattern).

4. **`+page.svelte`:**
   - In `initStore` call, add `daysFilter: data.filters.days`.
   - Add handler:
     ```ts
     function handleDaysChange(v: number[]) {
       setDaysFilter(v);
       const allDays = v.length === 7;
       replaceState(mergeSearchParams({ days: allDays ? null : v.join(',') }), {});
     }
     ```
   - Pass `onDaysChange={handleDaysChange}` and `days={getFilters().days}` to `<FilterBar>`.

5. **`FilterBar.svelte`:**
   - Add props: `days: number[]`, `onDaysChange: (v: number[]) => void`.
   - Add 4th control to Row 2 (after Cash/Card): a `<Popover>` (use existing `src/lib/components/ui/popover.svelte`) with a trigger button.
   - Trigger label derivation:
     - `days.length === 7` → `"All days"`
     - `days.join(',') === '1,2,3,4,5'` → `"Mon–Fri"`
     - `days.join(',') === '6,7'` → `"Sat–Sun"`
     - `days.length === 1` → `"<DayName> only"` (e.g., `"Wed only"`)
     - else → `"<n> days"`
   - Popover content:
     - 7 rows with `<Checkbox>` (use `src/lib/components/ui/checkbox.svelte`) labeled Mon..Sun. Each row min-h 44px, `gap-2`, label clickable.
     - Divider, then 3 preset buttons: `All`, `Weekdays`, `Weekends` — each calls `onDaysChange([...])`.
     - Mobile: popover anchored below button, max-w 240px.
   - Toggling a checkbox: compute new sorted array and call `onDaysChange`.

6. **Tests — `tests/unit/FilterBar.test.ts`:**
   - Update `baseFilters` fixture: remove `interp`, add `days: [1,2,3,4,5,6,7]`.
   - Add smoke test: render FilterBar, click Days trigger, assert 7 checkboxes rendered with `Mon`..`Sun` labels, assert "Weekdays" preset button present.

7. **Tests — `tests/unit/dashboardStore.test.ts`:**
   - Replace_all `interp: 'log-linear'` → drop and add `days: [1,2,3,4,5,6,7]` in 4 fixture locations.
   - Add 4 `filterRows` DOW tests:
     - **excludeMon:** rows on 2026-04-13 (Mon), 2026-04-14 (Tue), 2026-04-15 (Wed); `days=[2,3,4,5,6,7]` → only Tue+Wed survive.
     - **weekendOnly:** rows on Sat 2026-04-18 + Sun 2026-04-19; `days=[6,7]` → both survive.
     - **emptyDays:** any rows; `days=[]` → empty output.
     - **allDays:** identical to legacy behavior; `days=[1..7]` → same as no day filter.

8. **Tests — `tests/unit/urlState.test.ts`:**
   - Add: `mergeSearchParams({ days: '1,2,3' })` produces a URL with `days=1,2,3`; `mergeSearchParams({ days: null })` deletes the param.

**Verify:**
```bash
npx vitest run tests/unit/filters.test.ts tests/unit/FilterBar.test.ts tests/unit/dashboardStore.test.ts tests/unit/urlState.test.ts
```
All green. `npm run check` shows no new type errors.

**Done:**
- `days` round-trips through URL → `parseFilters` → store → KPI math.
- FilterBar Days popover renders, toggling updates URL + KPI tiles within ~200ms (no SSR fetch).
- `setInterp` and `INTERP_VALUES` are gone from the codebase (`grep -r "setInterp\|INTERP_VALUES" src/` returns nothing).
- All 4 DOW filterRows tests pass.

**Commit:** `feat(quick-260420-wdf): day-of-week filter schema + store + FilterBar popover`

---

## Task 2 — Card-side adoption: heatmap dim, retire toggle, caveats, delete file

**Files:**
- `src/lib/components/DailyHeatmapCard.svelte`
- `src/lib/components/CohortRetentionCard.svelte`
- `src/lib/components/RepeaterCohortCountCard.svelte`
- `src/lib/components/InterpolationToggle.svelte` (DELETE)
- `tests/unit/benchmarkInterp.test.ts` (verify untouched)

**Action:**

1. **`DailyHeatmapCard.svelte`:**
   - Import `getFilters` from store.
   - `const days = $derived(getFilters().days);`
   - `const excluded = $derived(new Set([1,2,3,4,5,6,7].filter(d => !days.includes(d))));`
   - In the cell render loop, compute the cell's DOW the same way the store does:
     ```ts
     const dow = ((parseISO(cell.date).getDay() + 6) % 7) + 1;
     ```
     If `excluded.has(dow)`, set `opacity={0.2}` on the cell rect (this stacks over the existing blue-scale fill).
   - Note: the heatmap data source (`kpi_daily_v`) is unchanged — this is purely visual dimming on top of existing values, so excluded days still show their real revenue but at 20% opacity.

2. **`CohortRetentionCard.svelte`:**
   - Remove `import InterpolationToggle from './InterpolationToggle.svelte';`
   - Remove `const interp = $derived(getFilters().interp);`
   - Replace the call site with hardcoded `'log-linear'`:
     ```ts
     interpolateBenchmark(benchmarkAnchors, 'log-linear', 'month')
     ```
   - Delete the `{#if hasBenchmark}<InterpolationToggle .../>{/if}` block from the header.
   - In the disclaimer line, replace any `{interp}` interpolation with the literal `log-linear`.
   - Add a caveat banner directly below the existing clamp/sparse hint area:
     ```svelte
     {#if getFilters().days.length !== 7}
       <p class="mt-1 text-[11px] text-amber-600" data-testid="cohort-day-filter-caveat">
         Day filter does not apply to cohort retention — cohorts use all days.
       </p>
     {/if}
     ```

3. **`RepeaterCohortCountCard.svelte`:**
   - Same caveat banner pattern (testid `repeater-day-filter-caveat`), inserted in the same relative position (below header, above chart).

4. **Delete `src/lib/components/InterpolationToggle.svelte`:**
   - `git rm src/lib/components/InterpolationToggle.svelte`
   - Confirm no remaining imports: `grep -r "InterpolationToggle" src/ tests/` returns nothing.

5. **`tests/unit/benchmarkInterp.test.ts`:**
   - No code changes — interpolation util is independent of UI toggle. Just confirm tests still pass.

**Verify:**
```bash
npx vitest run tests/unit/
npm run check
npm run build
```
- All unit tests green.
- `grep -rn "InterpolationToggle\|setInterp\|INTERP_VALUES\|filters.interp" src/ tests/` → no matches.
- Build clean.

**Then DEV deploy + Chrome MCP QA** (per `feedback_chrome_mcp_ui_qa.md`):
1. Push branch, wait for CF Pages deploy.
2. Open DEV URL via `mcp__claude-in-chrome__navigate_to_url`.
3. Verify Days popover: open it, uncheck Mon+Tue, screenshot. Confirm KPI tiles drop, heatmap Mon+Tue columns dim.
4. Click "Weekdays" preset → URL has `days=1,2,3,4,5`, retention card shows amber caveat.
5. Click "All" preset → URL strips `days` param, caveat disappears.
6. Confirm Lin/Log toggle is gone from CohortRetentionCard header.
7. Capture before/after screenshots.

**Done:**
- Excluded days dim to 20% opacity in heatmap; included days at full opacity.
- CohortRetentionCard renders without InterpolationToggle; benchmark curve still draws (now hardcoded log-linear).
- Both retention/repeater-cohort cards show amber caveat when `days.length !== 7`, hide it when all 7 selected.
- `InterpolationToggle.svelte` file does not exist.
- Chrome MCP QA scenarios all pass on DEV.

**Commit:** `feat(quick-260420-wdf): day filter UI adoption + retire Lin/Log toggle`

---

## Out of scope (confirmed)

- No SQL migrations.
- No changes to retention/LTV SQL — filter intentionally does not apply (caveat surfaces this).
- No changes to heatmap data source — visual dim only.
- No grain/range coupling — `days` is orthogonal to existing filters.
