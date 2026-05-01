# Phase 15 v2: Forecast Backtest Overlay — Context

**Gathered:** 2026-05-01
**Status:** Ready for planning
**Predecessor:** Phase 15 v1 (closed PR #25) — branch `feature/phase-15-forecast-chart-ui` archived. v1 helpers/endpoints/components/test fixtures all squash-ported in commit `07b6f1f`; subsequent plans incrementally evolve the shape.

## Why v2

Phase 15 v1 shipped a forecast-only forward chart (a dedicated `RevenueForecastCard` with a HorizonToggle), but the real product the owner wants is **backtested forecast lines overlaid on the existing actuals bar charts** so model accuracy can be eyeballed against ground truth. v1 was wrong-product, not wrong-code.

<domain>
## Phase Boundary

Phase 15 v2 ships forecast LINE + CI BAND overlays on `CalendarRevenueCard` and `CalendarCountsCard` (the existing actuals bar charts), driven by Phase 14 forecast model rows that now train at THREE grain-specific TRAIN_ENDs and store with a `granularity` discriminator. Refresh cadence moves from nightly to weekly Monday morning. Two dedicated forecast cards (`RevenueForecastCard` rewrite + new `InvoiceCountForecastCard`) stay alongside as cross-check surfaces; a deferred 15-17 retires them once the overlays are visually validated.

**In scope:**

1. Schema: add `granularity text` to `forecast_daily` PK; rebuild `forecast_daily_mv` + `forecast_with_actual_v` to include it.
2. Backend: `scripts/forecast/run_all.py` runs each model 3× per refresh (daily/weekly/monthly). Cron switches from nightly to `0 7 * * 1` (Monday 07:00 UTC = 09:00 Berlin).
3. `/api/forecast` refactor: drop `forecastResampling.ts`, query by native granularity, add `?kpi=revenue_eur|invoice_count` param, return `actuals` array extending into the back-test window.
4. Calendar overlays: extend `CalendarRevenueCard` + `CalendarCountsCard` with forecast-line splines + low-opacity CI areas (option B per user feedback) + inline ForecastLegend chip row + horizontal-scroll X-axis to last_actual+365d.
5. Dedicated cards (cross-check scaffolding): `RevenueForecastCard` rewrite (drops HorizonToggle), new `InvoiceCountForecastCard` sibling.
6. **15-17 deferred** — retire dedicated cards after cross-check passes.

**Explicitly out of scope:**

- New filter surfaces. Granularity is driven by the existing global `GrainToggle` in `FilterBar`.
- Sample-path resampling on the client (forecasts now stored at native grain).
- Track-B counterfactual + `campaign_calendar` (Phase 16).
- Rolling-origin CV backtest, ≥10% RMSE promotion gate (Phase 17).
- Hourly/menu-item forecasts.

</domain>

<decisions>
## Implementation Decisions (v2)

### Carry-forward from v1 (locked, re-stated)

- **C-01..C-07** — see `feature/phase-15-forecast-chart-ui:.planning/phases/15-forecast-chart-ui/15-CONTEXT.md` (deferred-API + LazyMount, wrapper view only, localhost-first, Tooltip.Root snippet contract, touchEvents 'auto', etc.)
- **D-01** — RevenueForecastCard placement at scroll position 6 (after InsightCard, before KPI tiles). Calendar overlays don't change existing card order; they extend existing cards in place.
- **D-02** — LayerChart `<Area>` for CI band rendering (`y0`/`y1` props).
- **D-04** — chip row UX for model toggles. Now embedded INSIDE both calendar cards and the dedicated forecast cards.
- **D-05** — Tooltip.Root + `{#snippet children({ data })}` snippet contract.
- **D-06** — long-format `/api/forecast` payload (rows + actuals + events + last_run).
- **D-07** — `/api/forecast-quality` filtered to `evaluation_window='last_7_days'`.
- **D-08** — `/api/campaign-uplift` hard-coded `CAMPAIGN_START`. Phase 16 generalizes via `campaign_calendar`.
- **D-09** — events folded into `/api/forecast` response.
- **D-10** — categorical 5-color `schemeTableau10` palette. `naive_dow` dashed gray.
- **D-12** — Chrome MCP `localhost:5173` verification gate, mandatory before DEV deploy.
- **D-13** — `touchEvents: 'auto'` default on `<Chart>` wrapper.

### NEW v2 decisions

- **D-14 — Three grain-specific TRAIN_ENDs (REPLACES v1's D-11 horizon clamp matrix).**

  Reference date: assume `last_actual = 2026-04-26` (a Sunday — weekly refresh ingests through previous Sunday).

  | Grain | TRAIN_END | Forecast first target_date | Forecast last target_date | Total horizon |
  |---|---|---|---|---|
  | Daily | 2026-04-19 (last_actual − 7d) | 2026-04-20 | 2027-04-26 | 372 days |
  | Weekly | 2026-03-22 (last_actual − 35d) | 2026-03-23 (Mon ISO week start) | 2027-04-26 | 57 weeks |
  | Monthly | 2025-11-30 (end-of-month, 5 calendar months back) | 2025-12-01 | 2027-04-30 | 17 months |

  **Why these specific look-backs:** the back-test window (7d / 5w / 4mo) gives the owner a recent ground-truth comparison — eyeball which model's line tracked actuals best, that's the model to trust forward.

  **Why monthly excludes April 2026:** April is a partial month at refresh time (data through Apr 26 only); training on a partial month would corrupt the model's monthly seasonality. Forecast still draws lines THROUGH April 2026 alongside the partial actual bar.

- **D-15 — Calendar-overlay rendering (REPLACES v1's standalone-card approach).**

  Forecast lines + CI bands overlaid on the existing `CalendarRevenueCard` (revenue_eur, gross-cents bars) and `CalendarCountsCard` (invoice_count, transaction-count bars). The actuals stay as bars; forecasts render as Spline lines and Area CI bands ABOVE the bars but BELOW the hover guide. X-axis domain extends to `last_actual + 365d` with horizontal scroll on the existing chart wrapper (already supports `overflow-x-auto`).

  The dedicated `RevenueForecastCard` (rewrite) and new `InvoiceCountForecastCard` stay as cross-check surfaces. Deferred 15-17 retires both once overlays visually match.

- **D-16 — Weekly refresh cadence (REPLACES v1's nightly assumption).**

  `forecast-refresh.yml` cron switches from `0 1 * * *` (nightly 01:00 UTC) → `0 7 * * 1` (Monday 07:00 UTC = 09:00 Berlin). Triggers AFTER Monday's data ingest. Data ingest cron stays as-is. Acceptable lag: forecasts up to ~6 days stale by following Sunday; matches the user's stated weekly review cadence.

- **D-17 — CI rendering: Option B (all visible-model bands stacked at low opacity).**

  Each visible model renders BOTH its Spline line AND its low-opacity (`fill-opacity={0.06}`) Area CI band. Deselecting a model from the legend removes BOTH the line and its band entirely from the chart. Visual mush risk on 5+ stacked bands acknowledged; user explicitly chose this for cross-comparison clarity.

- **D-18 — Dual-KPI parity.**

  Both `revenue_eur` and `invoice_count` get full overlay treatment on their respective calendar cards AND a dedicated forecast card. The `/api/forecast` endpoint takes `?kpi=revenue_eur|invoice_count` to switch. Phase 14 already produces forecasts for both KPIs (per migration `0050_forecast_daily.sql`).

- **D-19 — Partial-month rendering (no badge).**

  When a month is in progress at refresh time (April 2026 in the canonical example), the partial bar renders without a badge. Forecast lines ALSO draw through that partial month. User explicitly: "no badge. users will understand that April is not finished when he reads the chart."

### Decisions retired from v1

- **D-03** ("Today" Rule reference marker) — RETIRED. With back-test + forward chart, the "where actuals end / forecast begins" boundary is implicit in the bar/line transition. Adding a vertical Rule clutters at 375px without adding info.
- **D-11** (horizon × granularity clamp matrix) — REPLACED by D-14. Each grain now has its own pre-computed forecast set; no clamping needed.

### Dropped surfaces

- `HorizonToggle.svelte` + test → DELETED in 15-14. Global `GrainToggle` (existing in FilterBar) drives chart granularity.
- `forecastResampling.ts` + test → DELETED in 15-11. Forecasts stored at native grain make resampling unnecessary.

</decisions>

<specifics>
## Specific implementation pointers

- **Phase 14 model_name contract** — `'sarimax'`, `'prophet'`, `'ets'`, `'theta'`, `'naive_dow'` (the v1 `sarimax_bau` mistake is already fixed in the squash; carry-forward).
- **CalendarRevenueCard chart wrapper** — already uses `overflow-x-auto` + `computeChartWidth(chartData.length, cardW)` for variable-bar-count rendering. Reuse for the extended X-domain.
- **CalendarCountsCard** — sister card, same shape with `tx_count` instead of `revenue_cents`.
- **Forecast row size at refresh** — 5 BAU models × 3 grains × 2 KPIs × ~400 forecast points (max for daily-grain × 372 days) = ~12,000 rows per restaurant per refresh. Well under any quota.
- **Schema migration backfill safety** — adding NOT NULL `granularity` column with `DEFAULT 'day'`, then dropping default, then bumping NOT NULL. Existing nightly-cron rows backfill cleanly to `'day'`.
- **Cron dependency** — `forecast-refresh.yml` weekly run depends on Monday data ingest having completed. Add a freshness check at the start of `run_all.py`: if `last_actual_date < (today - 8 days)`, abort with status='waiting_for_data'.
- **CalendarCard band scale challenge** — current cards use a band scale (one slot per period). Extending the X domain to last_actual+365d would compress existing bars by 13× at daily grain. Solution: switch to a **time scale** for the overlay region while keeping the band scale's bandwidth for bar widths. Tested approach in v1 RevenueForecastCard. Pattern: `xScale={scaleTime()}`, bars width-locked to a computed `bandwidth = xScale(addDays(d, 1)) - xScale(d)`.

</specifics>

<canonical_refs>
## Canonical References

**Driving artifacts**:
- `.planning/ROADMAP.md` "Phase 15: Forecast Chart UI" — 6 success criteria, 9 requirements (FUI-01..FUI-09)
- `.planning/REQUIREMENTS.md` FUI-01..FUI-09

**Locked decisions from prior phases (still valid)**:
- `.planning/phases/14-forecasting-engine-bau-track/14-CONTEXT.md` — D-04 (200 sample paths), D-13 (4 metrics), D-14 (evaluation_window discriminator), D-09 (env-var feature flag for model availability)
- `.planning/phases/11-ssr-perf-recovery/11-CONTEXT.md` — D-03 (deferred /api/* + LazyMount + clientFetch)
- `.planning/phases/10-charts/10-CONTEXT.md` — D-11 (LazyMount), D-15 (categorical palette), D-17 (grain clamp)
- `.planning/phases/04-mobile-reader-ui/04-CONTEXT.md` — D-11..D-15 (LayerChart Spline/Axis/Tooltip; touch tooltips)

**v1 archive (read for reference, NOT for cargo-cult)**:
- `feature/phase-15-forecast-chart-ui:.planning/phases/15-forecast-chart-ui/15-CONTEXT.md` — original CONTEXT
- `feature/phase-15-forecast-chart-ui:.planning/phases/15-forecast-chart-ui/15-0[1-8]-PLAN.md` — original plans

**Existing patterns to copy**:
- `src/lib/components/CalendarRevenueCard.svelte` — current bar-only chart; will be EXTENDED in 15-12
- `src/lib/components/CalendarCountsCard.svelte` — sister; EXTENDED in 15-13
- `src/routes/api/customer-ltv/+server.ts` — canonical deferred endpoint shape
- `src/lib/components/HorizonToggle.svelte` — DELETED in 15-14 (use as reference for the segmented-control pattern only)

**Memory pointers**:
- `.claude/memory/feedback_svelte5_tooltip_snippet.md` — Tooltip.Root + snippet
- `.claude/memory/feedback_layerchart_mobile_scroll.md` — touchEvents 'auto'
- `.claude/memory/feedback_localhost_first_ui_verify.md` — Chrome MCP localhost gate

**CI guards (still apply)**:
- `scripts/ci-guards.sh` Guard 1 — no raw `_mv` references in `src/`
- `scripts/ci-guards.sh` Guard 2 — no raw `getSession()` server bypass
- `.claude/hooks/localhost-qa-gate.js` — Stop hook on frontend edits

</canonical_refs>

<deferred>
## Deferred Items

- **15-17** — retire dedicated forecast cards once cross-check passes (intra-phase deferral)
- **Phase 16 — ITS Uplift Attribution** (campaign_calendar + Track-B counterfactual)
- **Phase 17 — Backtest Gate & Quality Monitoring** (rolling-origin CV + ConformalIntervals + ≥10% RMSE promotion gate)

</deferred>

---

*Phase: 15-forecast-backtest-overlay*
*Context updated: 2026-05-01*
*v1 archive: PR #25 closed, branch feature/phase-15-forecast-chart-ui*
