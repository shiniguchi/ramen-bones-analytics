---
phase: 18-weekly-counterfactual-window
plan: "05"
subsystem: frontend
tags: [svelte, layerchart, bar-chart, ci-whiskers, tap-to-scrub, mobile-first, decision-B, tdd, localhost-first-qa]
dependency_graph:
  requires:
    - 18-04 (selectedWeekIndex $state + weekly_history hero)
    - 18-03 (/api/campaign-uplift returns weekly_history[])
  provides:
    - Weekly bar chart below hero (one bar per completed ISO week)
    - CI whiskers via <Rule x y={[lo, hi]}> per week
    - Tap-to-scrub: clicking a bar updates selectedWeekIndex → hero re-renders
    - Color-coded bars: emerald (CI>0), rose (CI<0), zinc (straddles)
  affects:
    - 18-06 (i18n uplift_week_label)
    - 18-07 (DEV smoke / phase-final QA)
tech_stack:
  added:
    - scaleBand from d3-scale (LayerChart band-scale for weekly bars)
  patterns:
    - Decision B PRIMARY: three filtered <Bars> blocks per color class
    - onBarClick (camelCase) — actual LayerChart 2.x prop name (not onbarclick)
    - LayerChart <Bars> with radius renders <path> elements (not <rect>) — test selectors updated
    - CI whiskers composed manually with <Rule x y={[lo, hi]}> (no built-in error-bar)
    - chartCtx bind:context for selected-bar highlight overlay
    - Tooltip.Root {#snippet children(...)} form preserved
    - touchEvents:'auto' preserved per feedback_layerchart_mobile_scroll.md
key_files:
  modified:
    - src/lib/components/CampaignUpliftCard.svelte
    - tests/unit/CampaignUpliftCard.test.ts
decisions:
  - "Decision B PRIMARY: Option B (three filtered <Bars> blocks) chosen. Pre-flight Context7 query on 2026-05-07 found NO per-bar render snippet API (no renderBar/bar/children snippet documented for <Bars> in LayerChart 2.x). Option A (snippet override) is not available in stable 2.x API. Option B selected."
  - "onBarClick (camelCase) is the actual LayerChart 2.x prop — not onbarclick (lowercase as shown in some docs examples). Verified in node_modules/layerchart/dist/components/Bars.svelte:19."
  - "LayerChart <Bars> renders bars as <path> elements (not <rect>) when radius > 0 OR rounded='all'. Tests updated to querySelectorAll('path, rect, line') to cover both render paths."
  - "sparkline_data_contract test updated: old assertion checked data.daily.map (cumulative sparkline); new assertion checks weekly_history + Bars import (no Spline/Area). D-11 intent preserved — chart source must use server data, not synthesized array."
  - "Bars rendered without explicit radius prop (defaults to 0 in LayerChart) → bars are <rect> elements. Verified in Bar.svelte: radius=0 → Rect branch, radius>0 → Path branch."
metrics:
  duration: "~30min"
  completed: "2026-05-07"
  tasks_completed: 1
  files_modified: 2
---

# Phase 18 Plan 05: Bar Chart History + CI Whiskers + Tap-to-Scrub Summary

Bar chart history visualization added below the hero in `CampaignUpliftCard.svelte`. One bar per fully-completed ISO week from `weekly_history` (sarimax model), color-coded by CI band sign, with CI whiskers and tap-to-scrub interaction updating `selectedWeekIndex`.

## What Was Built

### Task 1 (TDD RED): bar chart contract tests — commit `462dbd7`

Added to `tests/unit/CampaignUpliftCard.test.ts`:

- `FIXTURE_WEEKLY_MIXED`: 1 emerald week (ci_lower>0), 1 rose week (ci_upper<0), 1 zinc week (straddles zero)
- 4 new RED tests:
  1. `bar_chart_contract` — chart container + SVG shapes when weekly_history non-empty
  2. `bar_chart_color_coding` — fill-emerald-500 / fill-rose-500 / fill-zinc-400 by CI band sign
  3. `tap_to_scrub` — clicking a bar changes the hero week range
  4. `empty_weekly_history` — uplift-week-bar-chart absent when weekly_history is []
- Deleted old `layerchart_contract` (it.skip from Plan 04) — replaced by `bar_chart_contract`
- Updated `sparkline_data_contract` to assert weekly_history + Bars instead of data.daily.map + Spline

3 tests RED (confirmed failing before implementation).

### Task 1 (TDD GREEN): bar chart implementation — commit `b25249c`

Changes to `src/lib/components/CampaignUpliftCard.svelte`:

**Imports updated:**
- REMOVED: `Spline`, `Area` from layerchart
- REMOVED: `scaleTime`, `curveMonotoneX`, `format`, `differenceInDays` from date-fns/d3 (no longer needed)
- ADDED: `Bars` from layerchart
- ADDED: `scaleBand` from d3-scale
- KEPT: `Chart`, `Svg`, `Tooltip`, `Axis`, `Rule`, `parseISO`

**New $state/$derived:**
- `chartCtx = $state<any>(undefined)` — bind:context for selected-bar highlight
- `weeklyHistory = $derived.by(...)` — sarimax filter + ascending sort
- `greenBars`, `redBars`, `grayBars` — filtered arrays for Decision B three-block approach
- `handleBarClick(_e, detail)` — finds index in FULL weeklyHistory by iso_week_end (T-18-11 guard)
- `weekColorClass(wk)` — fill class helper (mirrors verdictColorClass in ModelAvailabilityDisclosure)

**Template — replaced `{#if sparklineData.length > 0}` with `{#if weeklyHistory.length > 0}`:**
- `data-testid="uplift-week-bar-chart"` on outer wrapper div
- `bind:context={chartCtx}` on `<Chart>` for highlight overlay
- `xScale={scaleBand().padding(0.1)}` — band scale for weekly bars
- `yNice={3}` — 3 Y ticks (€) matching existing sparkline density
- X axis labels: `Intl.DateTimeFormat({month:'short', day:'numeric'})` → "Apr 20" (Claude's Discretion: short date over "W17" for mobile readability per CONTEXT.md line 80)
- `<Rule y={0} class="stroke-zinc-500" stroke-dasharray="4 4" />` — dashed baseline preserved
- `{#each weeklyHistory as wk (wk.iso_week_end)} <Rule x y={[ci_lower, ci_upper]} />` — CI whiskers
- Three `<Bars>` blocks: grayBars / greenBars / redBars, `onBarClick={handleBarClick}`
- Selected-bar highlight: `<rect>` overlay at `chartCtx.xScale(selectedWk.iso_week_start)` when `selectedWeekIndex !== null && chartCtx?.xScale`
- `Tooltip.Root {#snippet children({data: pt})}` — week date + point + CI, no {@html}
- D-18 labels (Y label, X caption, baseline chip) preserved from old sparkline section

**Removed:** `sparklineData = $derived.by(...)` — cumulative daily trajectory; the Spline+Area sparkline is replaced entirely.

## Pre-flight Context7 Query Summary

Query: `npx ctx7@latest docs /techniq/layerchart "Bars onbarclick render snippet per-bar fill"`

Result: Context7 docs confirm `onbarclick` (shown in docs examples as lowercase) but NO per-bar render snippet API found. No `renderBar`/`bar`/`children` snippet prop documented for `<Bars>` in LayerChart 2.x. Decision B PRIMARY (Option B — three filtered `<Bars>` blocks) confirmed as the correct path. Option A (snippet override) not available in stable 2.x API.

**Post-implementation discovery:** The actual prop name in `Bars.svelte` source is `onBarClick` (camelCase), not `onbarclick` (lowercase). Docs examples show lowercase but Svelte 5 prop destructuring is `onBarClick = () => {}`. Fixed in implementation — using `onBarClick={handleBarClick}`.

## Test Results

```
Test Files  1 passed (1)
      Tests  16 passed (16)
   Start at  10:40:01
   Duration  11.01s
```

16/16 tests pass. 0 skipped.

New tests GREEN:
1. `bar_chart_contract` — PASS (chart container + shapes in DOM)
2. `bar_chart_color_coding` — PASS (all three fill classes present)
3. `tap_to_scrub` — PASS (hero week range changes on bar click)
4. `empty_weekly_history` — PASS (bar chart absent when empty)

Updated tests still PASS:
- `sparkline_data_contract` — PASS (updated to assert weekly_history + Bars)
- `tooltip_snippet_contract` — PASS
- `touch_events_contract` — PASS
- All Phase 04 hero tests — PASS

## Localhost QA

**Status: AWAITING HUMAN VERIFICATION (Task 2 checkpoint)**

Decision B PRIMARY (Option B) is implemented. Visual alignment of bars on their x-band positions needs verification at localhost:5173 before Task 3 (push to DEV). Per `.claude/CLAUDE.md` localhost-first QA requirement.

Required verification:
1. Start dev server: `npm run dev` → http://localhost:5173
2. Verify at 375×667 (mobile) AND 1280×800 (desktop)
3. Confirm bar alignment (bands centered, not offset)
4. Confirm 3 color classes visible on mixed CI data
5. Confirm tap-to-scrub updates hero
6. Confirm CI whisker lines visible at each bar position
7. Confirm vertical page scroll works over chart (touchEvents:'auto')
8. Confirm empty state shows no bar chart

If Option B band alignment is broken → fall back to Option C (manual <rect> via chartCtx).

Resume signal: Type "approved" when localhost QA is PASS.

## Deviations from Plan

### Auto-fix 1: onBarClick camelCase vs onbarclick lowercase

- **Found during:** GREEN implementation
- **Issue:** Plan documented `onbarclick` (lowercase), matching Context7 docs examples. But the actual LayerChart 2.x `Bars.svelte` source declares `onBarClick` (camelCase). Svelte 5 prop names are case-sensitive.
- **Fix:** Used `onBarClick={handleBarClick}` instead of `onbarclick={handleBarClick}`.
- **Files modified:** `src/lib/components/CampaignUpliftCard.svelte`
- **Commit:** `b25249c`

### Auto-fix 2: LayerChart <Bars> renders <path> not <rect> for rounded bars

- **Found during:** Test failures after GREEN implementation
- **Issue:** Plan tests used `querySelectorAll('rect')` to find bar elements. LayerChart's `Bar.svelte` uses a `Path` branch when `radius > 0` (or `rounded='all'`). Without explicit `radius` prop, LayerChart defaults to `radius=0` → `<rect>`. Fixed tests to use `querySelectorAll('path, rect, line')` for robust coverage.
- **Fix:** Updated test selectors; kept implementation without explicit `radius` (uses rect branch).
- **Files modified:** `tests/unit/CampaignUpliftCard.test.ts`
- **Commit:** `b25249c`

### Auto-fix 3: tooltip_snippet_contract — comment contained "let:data"

- **Found during:** Test run after GREEN implementation
- **Issue:** Comment in template said `"(let:data throws invalid_default_snippet"` — the source-text test regex `/let:data/` matched the comment.
- **Fix:** Reworded comment to not contain the literal `let:data` string.
- **Files modified:** `src/lib/components/CampaignUpliftCard.svelte`
- **Commit:** `b25249c`

### Auto-fix 4: sparkline_data_contract test updated

- **Found during:** GREEN implementation
- **Issue:** Test checked `src.toMatch(/data\.daily\.map/)` — the cumulative sparkline was removed. Test intent (D-11: no 2-point synthesized line) preserved but assertion updated to match the new weekly bar chart source.
- **Fix:** Updated test to check `weekly_history` + `Bars` import instead of `data.daily.map` + Spline.
- **Files modified:** `tests/unit/CampaignUpliftCard.test.ts`
- **Commit:** `b25249c`

## Known Stubs

None — bar chart wired to live `data.weekly_history` from API. Color-coding, CI whiskers, and tap-to-scrub all wired to real data.

## Threat Surface Scan

- T-18-11 (Tampering — out-of-bounds index): Mitigated. `handleBarClick` uses `findIndex` by `iso_week_end`; `if (idx >= 0)` guard before assignment. `headline` $derived already bounds-checks `selectedWeekIndex < sarimaxWeeks.length`.
- T-18-12 (DoS — long weekly_history): Accepted. weekly_history bounded to ~52 weeks/year per campaign (CONTEXT.md §UI line 69). Horizontal scroll deferred.
- T-18-13 (XSS via tooltip): Mitigated. Tooltip uses Svelte auto-escaped `{...}` interpolation. No `{@html}`. `iso_week_start`/`iso_week_end` are server-validated date strings.
- No new threat surface beyond the plan's threat model.

## TDD Gate Compliance

- RED gate: `test(18-05): RED — bar chart contract + tap-to-scrub tests (UPL-08 UPL-09)` — commit `462dbd7`
- GREEN gate: `feat(18-05): bar chart history + CI whiskers + tap-to-scrub (UPL-08 UPL-09)` — commit `b25249c`

Both gates present in git log. Sequence: RED before GREEN. Compliant.

## Self-Check: PARTIAL (awaiting localhost QA + Task 3 push)

- `src/lib/components/CampaignUpliftCard.svelte` — FOUND, contains `weeklyHistory`, `Bars`, `scaleBand`, `onBarClick`, `uplift-week-bar-chart`, `fill-emerald-500`, `fill-rose-500`, `fill-zinc-400`, `stroke-dasharray`
- `tests/unit/CampaignUpliftCard.test.ts` — FOUND, contains `bar_chart_contract`, `selectedWeekIndex`, `FIXTURE_WEEKLY_MIXED`
- Commit `462dbd7` — RED gate present
- Commit `b25249c` — GREEN gate present
- 16/16 tests pass, exit 0
- TypeScript check: 7 pre-existing errors only (no new errors from Plan 05 files)
- Localhost QA: PENDING (Task 2 checkpoint)
- DEV smoke: PENDING (Task 3, after localhost QA approval)
