---
status: complete
slug: calendar-chart-refactor
date: 2026-04-22
---

# Quick Task: calendar-chart-refactor

## Goal

Commit in-flight Calendar chart refactor (LayerChart API migration + zero-fill empty periods) that had been sitting on main as 6 uncommitted files through Phase 11. The refactor itself was complete and working in production (verified live via Chrome MCP); only the regex-based source-artifact tests had stale assertions grepping for the old `BarChart` import and `orientation="vertical"` attribute.

## What Changed

### Production code (in-flight work by user, unchanged by this task)
- `src/lib/dashboardStore.svelte.ts` — adds `bucketRange(from, to, grain)` helper that emits every expected bucket key for a window, and extends `shapeForChart` with optional `expectedBuckets` param to zero-fill missing periods (so filtered-out days render as visible 0 bars instead of silently disappearing).
- `src/lib/components/CalendarRevenueCard.svelte`, `CalendarCountsCard.svelte`, `CalendarItemsCard.svelte`, `CalendarItemRevenueCard.svelte` — switched from LayerChart's high-level `BarChart` primitive to low-level `Chart + Svg + Axis + Bars + Spline + Text + Tooltip`. Stacking expressed by iterating `{#each series as s}` emitting one `<Bars seriesKey={s.key}>` per visit-count bucket. Vertical orientation is the implicit default inside `<Svg>`, so the explicit `orientation` prop is gone. Cards now pass `bucketRange(w.from, w.to, grain)` to `shapeForChart` and check `getFiltered().length` for empty-state instead of `chartData.length`.

### Test updates (this task's actual work)
- `tests/unit/CalendarCards.test.ts` — 4 assertions updated to match the low-level primitive API:
  - `imports BarChart from 'layerchart'` → `imports Chart + Svg + Bars primitives from 'layerchart'` (×2, one per card)
  - `uses seriesLayout="stack" + orientation="vertical"` → `stacks bars via {#each series} emitting one <Bars seriesKey=...> per visit bucket` (×2, one per card)

## Verification

- `npm test -- tests/unit/CalendarCards.test.ts --run` → **18/18 passed**
- `npm run build` → `✓ built` via `@sveltejs/adapter-cloudflare`
- Production live at https://ramen-bones-analytics.pages.dev — "All" chip reads `Jun 11 2025 – Apr 22 2026`, 6 chart cards render correctly on mobile 390×844 viewport (confirmed via Chrome MCP before commit — the refactor has been running live since Phase 11 landed).

## Deviations

None. The scope stayed strictly on the test assertions. No .svelte or dashboardStore files touched.
