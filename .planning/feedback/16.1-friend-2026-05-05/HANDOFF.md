# Phase 16.1 Friend-Persona QA — Owner Feedback Handoff (2026-05-05)

**Context for next session:** Phase 16.1 implementation is 100% complete and pushed to `feature/phase-16-its-uplift-attribution`. SC3 + SC8 closed via Chrome MCP localhost QA on 2026-05-05. **The friend-owner ran SC9 persona test and surfaced 7 issues** — listed below with my initial triage. Resume with `/gsd-debug` per item or batch into a `/gsd-discuss-phase 16.2` (gap-closure phase).

## Resume entry point

```
Read .planning/feedback/16.1-friend-2026-05-05/HANDOFF.md
Read .planning/phases/16.1-friend-persona-ux-polish/16.1-HUMAN-UAT.md
Read .planning/phases/16.1-friend-persona-ux-polish/16.1-VERIFICATION.md
Branch: feature/phase-16-its-uplift-attribution (49+ commits ahead of origin already pushed; HEAD = d49f6ef)
```

## Current state at session-end (2026-05-05 09:43 CET)

- All 5 plans complete (16.1-01..05); 16.1-04 Task 5 manual GHA dispatch done; SC3 SQL row-counts verified
- HUMAN-UAT.md: SC3 ✅ + SC8 ✅ + SC9 ⏳ (this feedback IS the SC9 attempt)
- 1 inline Spline strokeOpacity/strokeWidth fix landed during SC8 QA (`ec6cf65`)
- 2 cosmetic leftovers deferred: `stroke-width={2}` on actuals overlay (Forecast cards line 274) — same camelCase fix
- Code review + secure phase deferred (user's call)

## 7 Feedback Items (verbatim from owner @ 2026-05-05)

### 1. Date range freeze
> "when i change the date ranges, e.g. i wanted to see the data daily from April, the app does not response and freeze"

**Triage:** Performance bug. Likely caused by 16.1-04's expanded forecast row count (~385 dates × 5 models × 2 KPIs = ~3850 rows in /api/forecast response) combined with 16.1-01/05's `chartXDomain` widening + `scroll-to-today` RAF + `computeChartWidth` all firing on filter change. May also be a SvelteKit `replaceState + invalidate` re-fetch loop (memory: `feedback_sveltekit_replacestate_invalidate_gotcha.md`).

**Investigation start:** `/gsd-debug "date range filter freezes app, especially April daily — added in Phase 16.1"`. Files: `src/routes/+page.svelte`, `src/lib/dashboardStore.svelte.ts`, `src/lib/components/CalendarRevenueCard.svelte` chart effects.

### 2. Tooltip — Spline-card models not aggregated, dots misaligned
> "when i hover over the cursor on the line graphs, we do not have the dots right on the lines, and also i do not get to see several datapoints that available on that day, i can somehow only see individually theta and ets popup bubbles but not sarimax and naive even those they are the ones selected and ets and theta are not selected. you need to only show the datapoints which the forecast methods are selected, and you must show all the available datapoints if they are shown."

**Screenshot:** `01-tooltip-only-shows-theta-not-all-selected.png` — Revenue forecast card. Tooltip shows ONLY "theta" (804 €, 95% CI 388–1.368) when sarimax + naive_dow are selected (theta is NOT). Black dot is positioned but appears off-line.

**Triage:** Two distinct bugs:
- (a) Tooltip respects model selection: should show rows ONLY for selected models, ALL of them when multiple selected.
- (b) Highlight dots should land on the Spline path (currently visually drifting). Likely caused by `bisect-x` returning the closest data point regardless of which model's data it is, and the per-Spline `Highlight` component iterating wrongly.

**Files:** `src/lib/components/RevenueForecastCard.svelte` + `InvoiceCountForecastCard.svelte` (Tooltip.Root + Highlight blocks). Cross-check `src/lib/components/CalendarRevenueCard.svelte` since D-16 tooltip there might suffer too.

### 3. Visit-number Calendar tooltip — model rows layout broken
> "the popup should show the name of the variable on the left side aligned, and value on the right side, somehow the forecast values are opposite, and also the 1 row slided up on the right side. clear bug."

**Screenshot:** `02-tooltip-layout-model-rows-misaligned.png` — "Revenue per period — by visit number" card (visit-cohort variant). Tooltip cohort rows (1st 944€ / 2nd 117€ / ... / Total 1.405€) align label-LEFT value-RIGHT correctly. But the 16.1-01 D-16 model section BELOW shows: "○ Naive (DoW avg)" (no value visible right-side), then "1.214 € ○ SARIMAX" (value on LEFT, label on RIGHT — flipped) and "1.038 €" floating below. Layout regression.

**File:** Likely the Calendar* visit-number variant — could be `RepeaterCohortRevenueCard.svelte` or `CalendarItemsCard.svelte` (visit-cohort versions). 16.1-01 only modified `CalendarRevenueCard.svelte` + `CalendarCountsCard.svelte` directly; if visit-number cards also have D-16 model rows, those tooltips need the same flex layout fix. Check the tooltip Snippet's `<div class="flex justify-between">` pattern — model row may have a wrapping bug (text wraps, value pushes to next line).

### 4. Forecast lines render BEHIND bars
> "sometimes the forecast lines go behind the bar graphs, do you know why? you should keep the lines always front."

**Triage:** SVG z-order is render order (later children render on top). 16.1-01 placed `<Spline past>` + `<Spline future>` blocks BEFORE the `<Bars>` block in source order → bars on top. Should reorder so Splines render AFTER bars. Or add `pointer-events: none` and z-index via CSS-stacked SVG groups.

**Files:** `src/lib/components/CalendarRevenueCard.svelte` lines ~395-430 (Spline + Bars order). Mirror in `CalendarCountsCard.svelte`.

### 5. Visit-number cards (week/month) — only Prophet + Naive_DoW available
> "do you know why i only have prophet and naive dow on Transactions per period — by visit number and Revenue per period — by visit number charts if i aggregate to week and month? if you are aware and it's planned to other forecasts later don't worry about this feedback."

**Triage:** Likely planned scope. Phase 14 / 15 may have intentionally limited week/month forecasts to a subset (sarimax/ets/theta may not have week/month variants in the pipeline). **Verify by querying:**
```sql
SELECT DISTINCT model_name, granularity FROM forecast_with_actual_v
WHERE granularity IN ('week', 'month') AND kpi_name = 'revenue_eur';
```
If sarimax/ets/theta are MISSING for week/month, this is planned (out of scope for 16.1). If present in DB but missing in UI, it's a UI bug.

### 6. Prophet — weird upward curve past Dec-Mar, no future line
> "i only see weird upward trend curve of prophet forecast line from dec to march but not for the future"

**Screenshot:** `03-prophet-weird-upward-curve-past-not-future.png` — Transactions visit-number card at week/month grain. Orange (Prophet) line climbs steeply upward Oct→Apr THEN STOPS at Apr — no future Prophet line visible. Naive_DoW dashed gray continues into future.

**Triage:** **This is the Risk 2 manifestation we feared.** Phase 16.1-04 Task 4b chose Path A (wired window_start + train_end into prophet_fit.py). The local pytest passed because it only tests the helper math. But in production: Prophet's `predict()` on past dates with a custom DataFrame appears to project the model's stationary trend BACKWARD onto past dates — producing exponentially-growing past values that are NOT backtest-equivalent. The future portion may be missing because the chart's future-Spline can't find values, or because Prophet's future return is filtered by a sanity check elsewhere.

**Two fix paths:**
- **Path B revert:** drop window_start kwarg from prophet_fit.py + document "Prophet past-forecast: skipped (Risk 2 fallback path)" — past line just doesn't render for Prophet.
- **Sanity clamp:** add a post-predict filter that drops Prophet rows where `yhat > 2x max(actuals)` or `yhat < 0` — keeps Path A but neutralizes the math artifact.

Owner reaction confirms Path A is broken in practice. Recommend Path B revert in `/gsd-debug`.

### 7. CampaignUpliftCard — no baseline visible, no axis measures
> "Did the Apr 14, 2026 campaign work?, i do not see any no campaign baseline, nor x and y axis measures"

**Triage:** Two gaps in the CampaignUpliftCard sparkline:
- **(a) Baseline LINE missing on chart:** The legend chip says "Dashed line = no campaign baseline" but the actual dashed horizontal line at y=0 (the counterfactual baseline) may not be drawn. Need a `<Rule y={0} stroke-dasharray="4 4">` or similar in the sparkline.
- **(b) Axis tick labels missing:** Sparkline likely has no `<Axis>` primitive for numeric tick marks. Owner sees the LABEL text ("Cumulative revenue impact (€)" / "Days since campaign launch") but no numbers (€0, €200, ... and 1, 4, 7, ... days).

**Files:** `src/lib/components/CampaignUpliftCard.svelte` — sparkline `<Chart>` block. Add `<Axis placement="left|bottom">` and `<Rule y={0}>` if missing. Original W4 LOCKED decision was Y label as `<p>` ABOVE Chart (NOT in-Svg axis label rotation) due to 375px clipping risk — but that decision didn't preclude Y-axis tick MARKS, just the label TEXT.

## Recommended next actions (post-/clear)

**Option A — Phase 16.2 gap-closure (recommended):**
```
/gsd-discuss-phase 16.2
```
Treat all 7 items as a coherent gap-closure phase. Items 1+6 are urgent (perf + Path A revert); items 2+3+7 are UX correctness; item 4 is a quick z-order fix; item 5 is verification only.

**Option B — Targeted /gsd-debug per item:**
```
/gsd-debug "16.1 owner feedback item N: <copy verbatim>"
```
Surgical for items 4 (z-order), 5 (verification), 7 (axis additions). Heavier for items 1, 2, 6.

**Option C — Inline fixes in this branch:**
Keep 16.1 open, apply fixes in same branch, re-verify with friend before phase complete. Risks scope creep; the strokeOpacity fix already showed how mid-QA fixes can compound.

## Files to NOT lose

- Screenshots: `.planning/feedback/16.1-friend-2026-05-05/{01,02,03}-*.png` (copies of temp /var/folders captures — those will be GC'd)
- This handoff: `.planning/feedback/16.1-friend-2026-05-05/HANDOFF.md`
- HUMAN-UAT current state: `.planning/phases/16.1-friend-persona-ux-polish/16.1-HUMAN-UAT.md`

## Memory worth saving (after resume)

Two concrete lessons surfaced this session that belong in `.claude/memory/`:

1. **Layerchart Spline kebab-vs-camel prop pitfall** — `stroke-opacity` and `stroke-width` are silently overridden by Path's explicit camelCase re-render. Use `strokeOpacity` / `strokeWidth`. Use `stroke-dasharray` (works as kebab — Path doesn't override that one).
2. **Prophet Path A is a math artifact when called with past DataFrame** — the planning doc's Risk 2 Path A/B contingency was real; Path A passed local pytest but visual verification on real data showed exponential projection of trend onto past dates. Default future executions to Path B unless a CV harness validates past values.
