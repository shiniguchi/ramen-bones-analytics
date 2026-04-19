---
task: 260419-dhm-labels-colorbar
title: DailyHeatmapCard — Mon-Sun row labels + blue-scale colorbar legend
branch: feature/dashboard-chart-improvements-260418
status: complete
created: 2026-04-19
commit: e98f074
---

# dhm-labels-colorbar — Summary

User feedback: heatmap lacked day-of-week context and a color legend.

## What shipped

### `src/lib/components/DailyHeatmapCard.svelte` (modified)

- Fixed Mon-Sun label column sits OUTSIDE the horizontal scroll wrapper so labels stay visible when history exceeds viewport width
- Labels: 7 stacked spans, `text-[10px] text-zinc-500`, each 14px tall (matches `CELL_PX`), `padding-top: 24px` matches Chart `padding.top` so row 0 aligns
- Blue-scale colorbar below chart: horizontal gradient bar (h-2, rounded) with `€0` left and `formatEUR(maxRev)` right, matching the `VisitSeqLegend.svelte` pattern
- Gradient CSS sampled from `interpolateBlues` at 10 stops via `linear-gradient(to right, …)`
- New testids: `daily-heatmap-daylabels`, `daily-heatmap-gradient`
- Only renders labels + colorbar when `dated.length > 0` (empty state unchanged)

## Verification

- `npm run build` clean (11.83s; bundle size unchanged from prior commit)
- `npm run check` — 16 pre-existing errors (same baseline as bm4), 0 new
- Chrome MCP QA on `http://localhost:5174/?__e2e=charts` with `E2E_FIXTURES=1`:
  - Desktop 1512×776: labels visible, colorbar spans chart width, shows `€0 … 73 €`
  - Mobile 390×844: no layout break, labels readable, colorbar full-width
  - Alignment verified programmatically: cell at `y=14` (Tuesday row in Monday-first order) screen-top = 352px = label "Tue" screen-top. Fixture starts Tuesday, so "Mon" label correctly sits in the empty row above.
  - No console errors

## Open items

None. User feedback items (1) day labels and (2) colorbar both delivered.

## Notes

- Couldn't QA on CF Pages DEV — `.github/workflows/deploy.yml` is hardcoded to only deploy on pushes to `main` with `--branch=main`. Feature branches get no auto-deploy. Used `E2E_FIXTURES=1` local dev path as the QA surface instead. This is acceptable for a pure-visual change with no data-path or auth changes; the existing memory note about E2E fixtures hiding data bugs applies to logic work, not layout.
