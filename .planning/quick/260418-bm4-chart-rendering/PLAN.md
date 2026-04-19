---
task: 260418-bm4
title: CohortRetentionCard north-star overlay + source popover + disclaimer
branch: feature/dashboard-chart-improvements-260418
status: complete
created: 2026-04-19
---

# bm4 — Chart rendering + popover + disclaimer

Fourth of 4 atomic tasks. Wires the data pipeline from bm1–bm3 into visible UI.

## What shipped

### `CohortRetentionCard.svelte` (modified)
- Imports `Area`, `Points`, `curveMonotoneX` from layerchart
- Accepts `benchmarkAnchors` + `benchmarkSources` props (optional, empty by default)
- `interpolateBenchmark(anchors, interp, grain)` produces dense series
- Render layers back→front: Area band (amber 18% opacity) → Spline mid (#d97706, dashed 6 3) → Points anchor dots (#d97706, r=6, click → popover) → existing axes + cohort splines + Highlight
- Tooltip extended: shows "North-star" row with mid% + P20–P80 range when hovering at any interpolated point
- Header: `InterpolationToggle` (Lin/Log) appears top-right only when benchmark data is present
- Disclaimer: small grey text below chart explaining P20/P80 / member-adj / interpolation caveat

### `NorthStarSourcePopover.svelte` (NEW)
- Bottom sheet (`ui/sheet.svelte` primitive)
- Headline: mid% + range + "curated for your restaurant using N sources"
- Per-source rows: label, country badge, credibility badge (HIGH=emerald / MED=amber / LOW=zinc), year, raw → normalized values, metric type, cuisine match, conversion note, sample size, source URL
- Footer: weighting-rule explainer

### `+page.svelte` (modified)
- Passes `benchmarkAnchors` + `benchmarkSources` from SSR into `CohortRetentionCard`

## Verification

- `npm run build` → clean (11.98s, 544kB page bundle, gzip 113kB)
- `npm run check` → no new type errors (16 pre-existing unrelated)
- `npx vitest run tests/unit/CohortRetentionCard.test.ts tests/unit/benchmarkInterp.test.ts` → 26/27 pass (1 pre-existing failure on "Cohort view shows weekly" string — copy changed to "Grouping view" in earlier quick task, test not updated)

## Open items

- bm5: Chrome MCP QA on DEV (deploy + triple-check band render, popover, toggle, disclaimer)
