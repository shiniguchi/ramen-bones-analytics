---
task: 260418-bm3
title: Server + util + toggle + store plumbing for north-star curve
branch: feature/dashboard-chart-improvements-260418
status: complete
created: 2026-04-19
---

# bm3 — Plumbing

Third of 4 atomic tasks. Backend + util + store. No chart rendering yet (bm4).

## What shipped

- `filters.ts`: added `INTERP_VALUES` + `interp: 'linear' | 'log-linear'` field (default `log-linear`)
- `dashboardStore.svelte.ts`: `setInterp()` action
- `benchmarkInterp.ts` (NEW): pure interpolation util — linear + log-linear, weekly + monthly grain, implicit W0=100%, flat past last anchor
- `benchmarkInterp.test.ts` (NEW): 19 unit tests, all green (anchor parity, monotonic lower≤mid≤upper, order-independence, log-floor safety, W1-drop on monthly grain)
- `InterpolationToggle.svelte` (NEW): Lin/Log segmented toggle, amber accent, replaceState URL sync
- `+page.server.ts`: added `benchmark_curve_v` + `benchmark_sources_v` fetches to the Promise.all fan-out (10 queries now)

## Fixtures fixed

- `tests/unit/FilterBar.test.ts` — added `interp: 'log-linear'` to baseFilters
- `tests/unit/dashboardStore.test.ts` — added `interp: 'log-linear'` to 4 fixture locations (replace_all)

## Verification

- `npx vitest run tests/unit/benchmarkInterp.test.ts tests/unit/FilterBar.test.ts tests/unit/dashboardStore.test.ts` → 46/46 pass
- `npm run check` → only pre-existing errors remain (no new type errors from my changes)
