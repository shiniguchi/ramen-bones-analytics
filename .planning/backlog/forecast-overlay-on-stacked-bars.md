---
type: backlog
captured: 2026-05-04
source: Phase 16 wave 4 close — owner Chrome MCP localhost review feedback
target_phase: v1.4 polish phase OR Phase 16.1 decimal phase (before Phase 17 ship)
priority: high
status: captured
---

# Forecast-overlay line on visit-cohort stacked-bar charts

Owner feedback (verbatim, 2026-05-04 Chrome MCP localhost session):

> "why do you show the data until the data available date on '期間別取引件数 — 来店回数別' bar chart and immidiately today's forecast? where are the past forecast data between April 27 until May 4? we need them to be shown."

> "i don't have scraper, i upload manually. i am aware that the data is behind, and always will be. you must keep showing the forecast lines from the day data is missing."

## Context

- Manual Orderbird upload is by design. Data lag (currently ~7 days as of 2026-05-04) is **permanent**, not a freshness incident.
- The dashboard's stale-data badge ("最終更新 5 days前 — データが古い可能性があります") is correct but **alone is not enough** — the visual gap on the bar charts looks like the dashboard is broken.
- Owner expects: forecast lines continue rendering past the last-actuals date so the visual stays continuous regardless of upload cadence.

## What's missing today

`/api/forecast` already returns past-forecast rows (`backtestStart` window: last 7 days for day grain, 5 ISO weeks for week grain, 4 months for month grain) — the BACKEND is ready.

| Component | Past-forecast overlay state |
|---|---|
| RevenueForecastCard ("Revenue forecast" / 売上の予測) | ✓ Phase 15 v2 backtest overlay |
| InvoiceCountForecastCard (取引件数の予測) | ✓ Phase 15 v2 mirror |
| CalendarRevenueCard (期間別売上 — 来店回数別) | ✗ fetches `/api/forecast`, doesn't render past-forecast layer |
| CalendarCountsCard (期間別取引件数 — 来店回数別) | ✗ fetches `/api/forecast`, doesn't render past-forecast layer |

## Implementation sketch

The visit-cohort bars can't be decomposed by forecast (forecasts aren't broken down by 1st/2nd/3rd-time-visitor cohort). The right shape is a **single forecast-total line overlaid above the stacked bars** — analogous to Apple Health's dotted "expected" line over actual step bars.

- LayerChart `Spline` + `Area` (CI band) layer added on top of existing stacked-bar layer
- Past-forecast section visually distinguished from future-forecast (e.g., past = solid faded total line, future = dashed total line)
- Same forecast-model-toggle wiring as RevenueForecastCard (sarimax + naive_dow defaults)

## Acceptance

- Owner opens dashboard at any T+N days after last manual upload and sees CalendarRevenueCard + CalendarCountsCard rendering forecast lines from the last-actuals date forward — no visual gap between actuals and forecast
- Past-forecast section visually communicates "this is what the model predicted" not "this is actual data"
- Lag-tolerant: dashboard never shows a "broken-looking" gap regardless of upload cadence

## Out of scope

- Decomposing forecast by visit-cohort (statistically not viable)
- Backfilling actual data via scraper (the owner has confirmed this is by design)

## Open questions for plan-phase

- Should past-forecast totals also overlay the menu-item charts (Top 20 quantity / revenue)? Probably yes, same shape.
- Should `cohort_retention` chart get a similar treatment? Probably no — retention is computed at cohort-formation time, not forecastable as a single line.
- Phase numbering: decimal 16.1 (lands before Phase 17) vs net-new v1.4 polish phase (lands after v1.3 closes)?
