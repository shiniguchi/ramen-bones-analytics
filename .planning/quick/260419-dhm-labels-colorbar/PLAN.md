---
task: 260419-dhm-labels-colorbar
title: DailyHeatmapCard — Mon-Sun row labels + blue-scale colorbar legend
branch: feature/dashboard-chart-improvements-260418
status: in-progress
created: 2026-04-19
---

# dhm-labels-colorbar — Row labels + colorbar legend

User feedback on the GitHub-style daily revenue heatmap:
1. No day-of-week context — user can't tell which row is Monday vs Sunday.
2. No color legend — user doesn't know what darker blue means or the max value.

## What ships

### `src/lib/components/DailyHeatmapCard.svelte` (modified)

**Fixed day-label column (left of scroll area):**
- New flex row wrapper around the scrollable chart: `<div class="mt-4 flex gap-2">`
- Left column: 7 stacked `<span>` labels (`Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`, `Sun`)
- Each label: 14px height (matches `CELL_PX`), `text-[10px]`, `text-zinc-500`, vertically centered via `flex items-center`
- Column `padding-top: 24px` matches the Chart's `padding.top` so row 0 of labels aligns with row 0 of cells
- Outside the `overflow-x-auto` wrapper so labels stay visible on horizontal scroll

**Blue-scale colorbar (below chart):**
- Pattern copied from `VisitSeqLegend.svelte`: horizontal gradient bar with end labels
- `€0` left, `formatEUR(maxRev)` right, h-2 gradient in between
- Gradient sampled from `interpolateBlues` at 10 stops via CSS `linear-gradient(to right, ...)`
- Only rendered when `dated.length > 0` (hidden on empty state)

**Testids added:**
- `daily-heatmap-daylabels` — label column
- `daily-heatmap-gradient` — colorbar track

## Verification

- `npm run build` clean
- `npm run check` no new type errors
- Chrome MCP screenshot of DEV URL shows labels + colorbar
