# Phase 15: Forecast Chart UI - Context

**Gathered:** 2026-04-30
**Status:** Ready for planning
**Auto-decided:** User directed "follow your recs first" — every gray area below is Claude's recommended option with rationale logged inline. User may revise before planning.

<domain>
## Phase Boundary

Phase 15 ships the **forecast chart on the dashboard** at 375px: a `RevenueForecastCard.svelte` rendering actual revenue + SARIMAX BAU forecast line + 95% CI band, with horizon chips (`7d`/`5w`/`4mo`/`1yr`), legend chips to opt-in additional models, a tap-to-pin hover popup showing per-horizon RMSE/MAPE/bias/direction-hit-rate + cumulative-deviation-since-campaign-launch + last-refit timestamp, and event markers overlaying campaign-start / federal+Berlin holidays / school-holiday-block backgrounds / recurring events / BVG strike days. Three new deferred `/api/*` endpoints (`/api/forecast`, `/api/forecast-quality`, `/api/campaign-uplift`) feed the card via the Phase 11 `LazyMount` + `clientFetch` pattern.

**In scope:**

1. `RevenueForecastCard.svelte` — composed card; default state shows 1 forecast line (SARIMAX BAU) + naive baseline + CI band only.
2. `HorizonToggle.svelte` — 4-chip horizon selector; client-side X-axis re-zoom.
3. `ForecastLegend.svelte` — chip row to toggle additional models (Prophet, ETS, Theta, Chronos, NeuralProphet) on/off; default OFF on mobile per FUI-02.
4. `ForecastHoverPopup.svelte` — tap-to-pin tooltip with 6 fields: forecast value + 95% CI for date, horizon (days from today), last-7-actual-days RMSE/MAPE/bias/direction-hit-rate, cumulative deviation since campaign launch, last-refit timestamp.
5. `EventMarker.svelte` — vertical lines/backgrounds for: campaign-start (red `▌`), federal+Berlin holidays (dashed green `|`), school-holiday-block boundaries (teal background shading), recurring events (yellow `|`), BVG strike days (red bar). ≤50 markers visible at default zoom; progressive disclosure.
6. Three new SvelteKit API endpoints: `/api/forecast`, `/api/forecast-quality`, `/api/campaign-uplift`. All use `locals.safeGetSession()` + `Cache-Control: private, no-store` per Phase 11 pattern.
7. Server-side sample-path resampling — `/api/forecast?granularity=` re-buckets `forecast_daily.yhat_samples` into mean+95% CI for the requested grain (day/week/month). Client never receives raw 1000-path arrays (per Phase 14 D-04: 200 paths).
8. Empty-state ("Forecast generating, check back tomorrow") + stale-data badge (`pipeline_runs.upstream_freshness_h > 24` for any cascade stage) + uncalibrated-CI badge for the 365d horizon while history < 2 years.
9. Localhost:5173 Chrome MCP verification at 375px BEFORE any DEV deploy QA, per `.claude/CLAUDE.md` and memory `feedback_localhost_first_ui_verify`.

**Explicitly out of scope:**

- Track-B counterfactual fits and `campaign_calendar` table writes — Phase 16. Phase 15 hard-codes the 2026-04-14 campaign-start date in `src/lib/forecastConfig.ts` for the cumulative-deviation calc; Phase 16 generalizes via `campaign_calendar`.
- `revenue_comparable_eur` baseline-comparable KPI — Phase 16.
- Rolling-origin CV backtest, conformal calibration, ≥10% RMSE promotion gate — Phase 17.
- New filter surfaces, new chip windows, new grain modes (Phase 9 locked filters; Phase 10 D-17 locked grain clamp).
- Desktop-only visuals, alerting, export, drill-down — out per CLAUDE.md mobile-first rule.
- Forecasts for menu items / order_items grain — Phase 14 only forecasts `revenue_eur` + `invoice_count`.

</domain>

<decisions>
## Implementation Decisions

### Carry-forward from Phase 11/12/14 (re-stated for downstream agents)

- **C-01 — Deferred-API + LazyMount pattern (Phase 11 D-03):** Each `/api/*` endpoint uses `locals.safeGetSession()` (not `getClaims()` direct), sets `Cache-Control: private, no-store`, and is gated by `LazyMount` `onvisible` callback feeding `clientFetch<T>(url)`. Single trigger API. Reference: `src/routes/api/customer-ltv/+server.ts`.
- **C-02 — Sample-path resampling server-side (Phase 14 D-04 / STATE strategic):** Client receives only aggregated `mean` + `yhat_lower` + `yhat_upper` per requested grain. Never raw `yhat_samples` arrays. 200 paths × 365d, resampled at endpoint.
- **C-03 — Mobile chart defaults (STATE strategic):** Default = 1 forecast line + naive baseline + CI band. Additional models opt-in via legend, default OFF on 375px.
- **C-04 — Wrapper view only (Phase 1 D-06/07/08):** `forecast_with_actual_v` (Phase 14 SC#4) is the ONLY surface the SvelteKit app reads. CI Guard 1 fails build on raw `_mv` from `src/`.
- **C-05 — Localhost-first UI verification (CLAUDE.md):** Chrome MCP `localhost:5173` BEFORE DEV deploy. Stop hook `localhost-qa-gate.js` blocks turn-end if a frontend file was edited without a localhost navigate.
- **C-06 — Tooltip.Root snippet contract (memory `feedback_svelte5_tooltip_snippet`):** Svelte 5 LayerChart `Tooltip.Root` requires `{#snippet children}`; `let:data` throws `invalid_default_snippet` at runtime.
- **C-07 — Touch events default `'auto'` (memory `feedback_layerchart_mobile_scroll`):** Never set `touchEvents: 'pan-x'` on the chart wrapper — it blocks PC trackpad vertical scroll.

### Card Placement (G-01)

- **D-01 — RevenueForecastCard slots in scroll position 6, immediately AFTER `InsightCard` and BEFORE `CalendarRevenueCard`.** Owner mental model: "what's coming this week (forecast) → how's business this week (calendar) → cohorts (retrospective)". The forecast is the new look-ahead view; calendar revenue is the look-back view; placing forecast first matches the natural cognitive flow when opening the dashboard. New `+page.svelte` order: DashboardHeader → FilterBar → FreshnessLabel → KpiTile(Revenue) → KpiTile(Transactions) → InsightCard → **RevenueForecastCard (new)** → CalendarRevenueCard → CalendarCountsCard → CalendarItemsCard → CalendarItemRevenueCard → CohortRetentionCard → DailyHeatmapCard → MdeCurveCard → RepeaterCohortCountCard.

  **Why not above InsightCard:** InsightCard is the Claude Haiku narrative — the human-readable summary. Owner reads narrative → sees forecast. Reversing breaks the prose-then-numbers flow.

  **Why not at the bottom:** forecast is high-signal for a daily check-in; below-fold placement defeats the purpose.

### CI Band Rendering (G-02)

- **D-02 — LayerChart `<Area>` primitive with `y0={yhat_lower}`, `y1={yhat_upper}`, fill at 15% opacity, no stroke.** `<Spline>` for `yhat_mean` on top, solid stroke. Standard probabilistic-forecast rendering, single LayerChart 2.x primitive each. Alternative (two splines + manual `path.fill-between`) requires custom SVG path math — not worth the complexity.

### "Today" Reference Marker (G-03)

- **D-03 — Vertical `<Rule>` at `today` (date-fns `startOfDay(new Date())`), 1px stroke, neutral `gray-500`, no label.** Visually separates actual (left) from forecast (right). Label clutters at 375px. Phase 4 D-13 rejected horizon markers on KPI tiles; this is a different surface — the forecast chart explicitly needs the "where now ends" boundary or the line transitions are unreadable.

### Model Toggle UX Surface (G-04)

- **D-04 — `ForecastLegend.svelte` is a horizontal-scroll chip row directly below the chart (not above, not in a bottom sheet, not a modal).** Mirrors `HorizonToggle.svelte`'s visual style for consistency. Each chip = `<dot> + model_name`; tap toggles visibility. Single `$state visibleModels: Set<string>` in the card; default = `new Set(['sarimax_bau', 'naive_dow'])`. Disabled state for models with zero rows in `forecast_daily_mv` (e.g. Chronos when `FORECAST_ENABLED_MODELS` excludes it — Phase 14 D-09).

  **Why chip row not bottom-sheet:** mobile bottom-sheet adds modal navigation state; chip row is one tap away. Mirrors the HorizonToggle design owner has already learned.

### Hover Popup Positioning at 375px (G-05)

- **D-05 — Tap-to-pin floating popup using LayerChart `<Tooltip.Root>` with `{#snippet children}`** (per memory `feedback_svelte5_tooltip_snippet`). Popup auto-positions to opposite side of tap if it would overflow the right edge of the chart. Tap persists until: (a) tap elsewhere, (b) scroll, (c) chart filter/horizon change. Empty-state when no `forecast_quality` row exists for that model+kpi: "Accuracy data builds after first nightly run" (Phase 14 NOTE: forecast_quality populates after 2nd nightly run).

  **Why not fixed bottom-sheet:** eats ~30% of the card's vertical real estate at 375px; user loses the chart context they're hovering over. Floating-with-flip preserves visual locality.

### `/api/forecast` Payload Shape (G-06)

- **D-06 — Long-format JSON response from `/api/forecast?horizon={7|35|120|365}&granularity={day|week|month}`:**

  ```json
  {
    "rows": [
      { "target_date": "2026-05-01", "model_name": "sarimax_bau",
        "yhat_mean": 1234.56, "yhat_lower": 1100.00, "yhat_upper": 1380.00,
        "horizon_days": 1 }
    ],
    "events": [
      { "date": "2026-05-01", "type": "holiday", "label": "Tag der Arbeit" },
      { "date": "2026-04-14", "type": "campaign_start", "label": "Spring campaign" }
    ],
    "last_run": "2026-05-01T01:34:22Z"
  }
  ```

  Mirrors `forecast_daily_mv` schema (Phase 14 D-08). Client groups by `model_name` for rendering: `Map.groupBy(rows, r => r.model_name)`. Long format scales when models are added; wide format would require a schema rev per model.

  **Endpoint queries `forecast_with_actual_v`** (the wrapper view) joined with `pipeline_runs` for `last_run`.

### `/api/forecast-quality` Shape and Empty-State (G-07)

- **D-07 — Long-format response from `/api/forecast-quality`:**

  ```json
  [
    { "model_name": "sarimax_bau", "kpi_name": "revenue_eur",
      "horizon_days": 7, "rmse": 142.31, "mape": 0.084,
      "mean_bias": 12.5, "direction_hit_rate": 0.71,
      "evaluated_at": "2026-04-30T01:35:00Z" }
  ]
  ```

  Filters to `evaluation_window='last_7_days'` only — Phase 17 backtest rows (`evaluation_window='rolling_origin_cv'`) are excluded. Empty array when forecast_quality has no rows yet (first 24h after Phase 14 ships); hover popup shows "Accuracy data builds after first nightly run".

### `/api/campaign-uplift` Phase 15 Stub (G-08)

- **D-08 — Phase 15 ships `/api/campaign-uplift` returning a single `cumulative_deviation_eur` value** — sum of `(actual_revenue_eur − sarimax_bau_yhat_mean)` from `forecast_with_actual_v` since the hard-coded `2026-04-14` campaign-start in `src/lib/forecastConfig.ts`:

  ```ts
  // src/lib/forecastConfig.ts — Phase 15 stub. Phase 16 replaces with campaign_calendar.
  export const CAMPAIGN_START = new Date('2026-04-14');
  ```

  Endpoint payload:
  ```json
  { "campaign_start": "2026-04-14", "cumulative_deviation_eur": -432.10, "as_of": "2026-04-30" }
  ```

  Phase 16 swaps the constant for a `campaign_calendar` lookup, adds Track-B counterfactual fields, and extends to a per-campaign array. **Endpoint URL contract is stable across Phase 15 → 16; only the response payload extends.**

  **Why not defer the endpoint to Phase 16:** FUI-04 requires the hover popup to show "cumulative deviation since campaign launch" in Phase 15. The hover popup is a Phase 15 deliverable. Therefore Phase 15 must produce a meaningful number for that field, even before campaign_calendar lands.

### Event Marker Data Source (G-09)

- **D-09 — Event lookup folds into `/api/forecast` response as a sibling `events: [...]` array, NOT a separate endpoint.** Server-side query joins `holidays` (filter by `country_code='DE'` + Berlin state), `school_holidays`, `recurring_events`, `transit_alerts` (filter by Streik/Warnstreik match) over the requested `horizon` window. One round-trip per granularity change. Reduces client fan-out vs. 4 separate endpoints. Campaign-start comes from the Phase 15 hard-coded constant (D-08); Phase 16 will join `campaign_calendar` here.

  **Marker types and visual encoding** (locked by FUI-05, re-stated for the planner):
  - `campaign_start` → red `▌` vertical bar
  - `holiday` → dashed green vertical line `|`
  - `school_holiday` → teal background shading spanning the block
  - `recurring_event` → yellow `|`
  - `transit_strike` → red horizontal bar at the top of the chart for that date

  Progressive disclosure: ≤50 markers visible by default; if a horizon would render >50 markers (e.g. 1yr horizon), planner clamps to highest-priority types (campaign_start > transit_strike > school_holiday > holiday > recurring_event).

### Forecast Line Palette (G-10)

- **D-10 — Categorical 5-color palette from `d3-scale-chromatic`'s `schemeTableau10`, slice [0..4]:** sarimax=`#4e79a7`, prophet=`#f28e2c`, ets=`#e15759`, theta=`#76b7b2`, naive_dow=`gray-500` (overridden — naive is the de-emphasized baseline, dashed stroke). Sequential would imply ranking, which Phase 17 backtest gate establishes — not Phase 15. Categorical = "5 different methods, each its own identity".

  **Naive baseline visual treatment:** dashed line (LayerChart `Spline` with `class="stroke-gray-500 stroke-dasharray-[4_4]"`), 1px, no CI band rendered (the baseline doesn't have one in `forecast_daily`'s naive rows; Phase 14 D-16 uses bootstrap residuals but baselines are de-emphasized visually).

  **Chronos / NeuralProphet (feature-flagged off in Phase 14 D-09):** when those models have rows in `forecast_daily_mv`, they pick up colors `schemeTableau10[5..6]` — `chronos=#ff9da7`, `neuralprophet=#9c755f`. Until then their chips render disabled.

### Granularity Availability per Horizon (G-11)

- **D-11 — Auto-clamp granularity per horizon, mirroring Phase 10 D-17 cohort grain clamp:**

  | Horizon | Day | Week | Month | Default |
  |---|---|---|---|---|
  | 7d  | ✅ | —  | —  | day |
  | 5w  | ✅ | ✅ | —  | day |
  | 4mo | —  | ✅ | ✅ | week |
  | 1yr | —  | —  | ✅ | month |

  Inline hint when a granularity is unavailable: "Daily view available for ≤5w forecast horizons" (single line below GranularityToggle, gray-500 text). Server validates `granularity` against `horizon` in `/api/forecast` (rejects `?horizon=365&granularity=day` with HTTP 400). Client UI hides invalid options.

  **Why clamp not warn:** 365 daily bars at 375px = 1px each; legend becomes unreadable. The same UX pattern as Phase 10 D-17 (cohort charts clamp grain to weekly when global grain = day). Owner has already learned this clamp pattern.

### Localhost-First Verification Gate (G-12)

- **D-12 — Each UI plan in Phase 15 ends with a Chrome MCP `localhost:5173` verification step.** Required artifacts per plan:
  - 375px screenshot showing default state (1 forecast line + naive baseline + CI band).
  - 375px screenshot of `horizon=1yr` + `granularity=month` (zoom-out validation).
  - Console-log assertion: zero `invalid_default_snippet` warnings from `Tooltip.Root` (memory `feedback_svelte5_tooltip_snippet`).
  - Console-log assertion: zero "trackpad scroll blocked" warnings from chart wrapper (memory `feedback_layerchart_mobile_scroll`).
  - Tap-to-pin tooltip behavior verified (single tap pins; second tap dismisses).

  Stop hook `.claude/hooks/localhost-qa-gate.js` will block turn-end if a `.svelte` / `src/routes/**` / `src/lib/components/**` file was edited without a localhost navigate.

### Touch Events Default (G-13)

- **D-13 — `<Chart>` wrapper uses LayerChart's default `touchEvents: 'auto'`.** Do not pass `touchEvents: 'pan-x'` (memory `feedback_layerchart_mobile_scroll`: blocks PC trackpad vertical scroll). Tap-to-pin tooltip pattern handles mobile interaction without needing custom touch routing.

### Claude's Discretion (planner picks)

- Component file naming and test file structure — mirror `CohortRetentionCard.svelte` pattern.
- Exact color hex values for event markers — finalize at 375px during implementation.
- Decision on whether to introduce a shared chart abstraction across `RevenueForecastCard` and `CalendarRevenueCard` (both render time-series with overlays) — planner's call. Lean: keep them separate; calendar is bar+stack, forecast is line+area; overlap is mostly axis/tooltip wiring which LayerChart provides.
- Whether `/api/forecast` returns events inline (D-09 default) or splits to `/api/forecast-events` if event payload >50kB. Planner measures and decides.
- Empty-state copy strings for the three error/loading states (defaults locked by FUI-08; planner can refine wording).
- Whether to add a "today" date label centered above the Rule (D-03) — at 375px space-permitting only.

</decisions>

<specifics>
## Specific Ideas

- **Phase 14 NOTE (STATE.md):** `forecast_quality` populates only after the 2nd nightly run. Plan must handle the 24-hour empty-state for hover popup gracefully — copy: "Accuracy data builds after first nightly run".
- **Naive baseline is the always-on second line in default state** — provides the "is the forecast better than dumb same-DoW guessing?" sanity check at a glance. FUI-02 explicitly names it.
- **5 BAU model rows × 365 dates × 1 KPI for sarimax/prophet/ets/theta = ~7300 rows max payload at 1yr horizon, daily grain, no granularity collapse.** With granularity=month at 1yr, payload is ~60 rows. Plenty of headroom; no need for streaming/pagination.
- **`forecast_with_actual_v` (Phase 14 SC#4) is the wrapper view to read.** Reflects RLS via security_invoker. Joins forecast_daily_mv to actual KPI rows so a single query gets both.
- **Cumulative-deviation calculation runs server-side in `/api/campaign-uplift`** to avoid 1000s of `actual − yhat` rows traveling to the client. Single number returned.
- **The 2026-04-14 campaign-start hard-coded constant must be PHASE-15-OWNED** so Phase 16's planner cleanly identifies what to refactor. Constant location: `src/lib/forecastConfig.ts`. CI grep guard NOT added in Phase 15 (Phase 16 adds the guard against raw `2026-04-14` literals once `campaign_calendar` exists).
- **The `/api/forecast` response's `last_run` field feeds the "last refit timestamp" line in the hover popup (FUI-04).** Source: `pipeline_runs` row with `step_name='forecast_sarimax'` (or whichever model the user is hovering), most recent successful run.
- **Stale-data badge logic** (FUI-08): query `pipeline_runs` for max(`upstream_freshness_h`) across cascade stages (`weather_brightsky`, `holidays`, `school_holidays`, `transit_alerts`, `recurring_events`, `forecast_sarimax`, `forecast_prophet`, ...). If any > 24, render the "Data ≥24h stale" badge. Reuse FreshnessLabel pattern.
- **Uncalibrated-CI badge** (FUI-08): show on the 1yr horizon chip when `len(history) < 730 days`. Tracks the same condition as Phase 14 D-04 Prophet `yearly_seasonality=False` pin (which holds until 2027-06-11). After that date, the badge can drop. Plan should add a date-fns check, not a feature flag.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor) MUST read these before planning or implementing.**

### Driving artifacts
- `.planning/ROADMAP.md` "Phase 15: Forecast Chart UI" — 6 success criteria + 9 requirements (FUI-01..FUI-09)
- `.planning/REQUIREMENTS.md` FUI-01..FUI-09 — the nine requirements Phase 15 closes
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §15 — UI component decomposition (RevenueForecastCard, ForecastLegend, ForecastHoverPopup, HorizonToggle, EventMarker)

### Locked decisions from prior phases
- `.planning/phases/14-forecasting-engine-bau-track/14-CONTEXT.md` — D-04 (200 sample paths), D-05 (latest run only), D-13 (4 metrics in forecast_quality), D-14 (evaluation_window discriminator), D-09 (env-var feature flag for model availability), C-05 (server-side resampling)
- `.planning/phases/11-ssr-perf-recovery/11-CONTEXT.md` — D-03 (deferred /api/* + LazyMount + clientFetch), D-05 (fetchAll cap), D-06 (CF Pages 50 subrequest budget). Phase 15's 3 new endpoints all follow this pattern.
- `.planning/phases/10-charts/10-CONTEXT.md` — D-07 (cash 9th segment / neutral gray for de-emphasized series), D-11 (LazyMount), D-15 (categorical palette via schemeTableau10), D-17 (grain clamp pattern). Phase 15's D-10 / D-11 / D-12 mirror these.
- `.planning/phases/04-mobile-reader-ui/04-CONTEXT.md` — D-11..D-15 (LayerChart Spline + Axis + Tooltip; touch tooltips; sparse filter), D-22 (per-card error isolation in +page.server.ts)

### Project-level
- `.planning/STATE.md` "v1.3 Strategic Decisions (from research synthesis 2026-04-27)" — sample-path mandate, mobile chart defaults (1 forecast line + naive + CI), Open-Meteo non-commercial gating
- `CLAUDE.md` (project root) — non-negotiables: $0/mo budget, mobile-first 375px, Cloudflare free-tier limits, no raw `_mv` references, RLS on every new query
- `.claude/CLAUDE.md` — DEV-environment Final QA + LOCALHOST-FIRST exception for frontend changes (the order is non-negotiable)

### Existing patterns to copy / extend
- `src/routes/api/customer-ltv/+server.ts` — canonical deferred endpoint shape (locals.safeGetSession + Cache-Control + fetchAll). Phase 15's three new endpoints copy this.
- `src/lib/clientFetch.ts` — SWR-style in-memory cache for client-side fetches; gates duplicate trips per same-tab session.
- `src/lib/components/LazyMount.svelte` — IntersectionObserver-gated mount slot with the single `onvisible` trigger API. Wraps RevenueForecastCard.
- `src/lib/components/CohortRetentionCard.svelte` — closest existing chart-card shape: LayerChart Chart/Svg/Axis/Spline, props shape, empty-state fallback, `h-64` card sizing. RevenueForecastCard mirrors it.
- `src/lib/components/CalendarRevenueCard.svelte` — Tooltip.Root + `{#snippet children}` Svelte 5 pattern (avoids `invalid_default_snippet` runtime error).
- `src/lib/chartPalettes.ts` — VISIT_SEQ_COLORS / CASH_COLOR; extend with `FORECAST_MODEL_COLORS` constant for D-10.
- `src/lib/components/HorizonToggle.svelte` — `<not yet — Phase 15 creates>`; styling parity with `GrainToggle.svelte` (segmented control pattern).

### Migration / data layer
- `supabase/migrations/<phase-14-final>` — `forecast_with_actual_v` wrapper view (Phase 14 SC#4). The ONLY surface Phase 15 reads.
- `forecast_quality` table — Phase 14 D-13 schema (4 metrics × evaluation_window). Phase 15 reads via /api/forecast-quality.
- `pipeline_runs` table (Phase 13) — read for `last_refit` timestamp + stale-data badge cascade-freshness check.

### CI guards
- `scripts/ci-guards.sh` Guard 1 — fails on raw `_mv` references in `src/`. Phase 15 must read only via `forecast_with_actual_v` and never `forecast_daily_mv` directly.
- `.claude/hooks/localhost-qa-gate.js` (Stop hook) — blocks turn-end if a `.svelte` / `src/routes/**` / `src/lib/components/**` file was edited without a localhost navigate. Phase 15 plans MUST honor this.
- `.claude/hooks/verify-targets.json` — encodes the localhost-first rule literally.

### Memory pointers
- `.claude/memory/feedback_svelte5_tooltip_snippet.md` — Tooltip.Root + `{#snippet children}` pattern (RevenueForecastCard hover popup MUST follow).
- `.claude/memory/feedback_layerchart_mobile_scroll.md` — `touchEvents: 'auto'` default; never `'pan-x'` after 2026-04-18.
- `.claude/memory/feedback_localhost_first_ui_verify.md` — localhost:5173 BEFORE claiming UI work complete.
- `.claude/memory/feedback_chrome_mcp_ui_qa.md` — drive Chrome MCP QA myself, don't hand checklist to user.
- `.claude/memory/feedback_sql_cross_check_per_chart.md` — partition-sum checks miss cards with their own local filters; planner must grep components for independent `filter()` derivations during validation.
- `.claude/memory/feedback_sveltekit_replacestate_invalidate_gotcha.md` — use `goto({replaceState, invalidateAll})` not `$app/navigation.replaceState` if any Phase 15 chip persists URL state.

### External docs (researcher fetches fresh)
- LayerChart 2.x — `Area`, `Spline`, `Rule`, `Tooltip.Root` primitives. Verify `Area` y0/y1 props at https://layerchart.com/docs.
- d3-scale-chromatic `schemeTableau10` — color palette source.
- date-fns — `startOfDay`, `differenceInDays`, `addDays` for horizon calculations.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`LazyMount.svelte` + `clientFetch.ts`** (Phase 11) — wrap RevenueForecastCard for below-fold deferred fetch. Same pattern as customer-ltv / retention / kpi-daily / repeater-lifetime.
- **`CohortRetentionCard.svelte`** — shape template: props, `<Chart><Svg><Axis>` wrappers, `EmptyState` fallback, `h-64` sizing, sparse-filter handling.
- **`CalendarRevenueCard.svelte` Tooltip block** — Tooltip.Root + `{#snippet children}` correct pattern; copy verbatim.
- **`emptyStates.ts`** — extend with 4 new keys: `forecast-loading`, `forecast-quality-empty`, `forecast-stale`, `forecast-uncalibrated-ci`.
- **`chartPalettes.ts`** — extend with `FORECAST_MODEL_COLORS` constant per D-10.
- **`format.ts`** — reuse `formatEUR`, `formatEURShort`, `formatDateMobile` for popup labels and event marker hover.
- **`+page.server.ts`** — extend SSR fan-out by zero queries (all 3 forecast endpoints are deferred client fetches per Phase 11 D-03). The card mounts via LazyMount, fetches its data, renders.
- **`+page.svelte`** — insert RevenueForecastCard at scroll position 6 (between InsightCard and CalendarRevenueCard) per D-01.
- **`forecastConfig.ts`** (NEW) — single export: `CAMPAIGN_START = new Date('2026-04-14')`. Phase 16 replaces with `campaign_calendar` lookup.

### Established Patterns
- **Wrapper view + JWT tenant filter** (Phase 1 D-06/07/08, Phase 3 D-17) — `forecast_with_actual_v` already follows; endpoints just `select` from it.
- **Per-card error isolation** (Phase 4 D-22) — every new endpoint try/catch returns empty-state-friendly payload on error, never throws to the client.
- **Svelte 5 runes (`$props`, `$state`, `$derived`, `$effect`)** — established Phase 4+; planner stays consistent.
- **Tap-to-reveal tooltips** (Phase 4 D-15) — copy the calendar card pattern.
- **Lazy-mount below fold** (Phase 10 D-11) — RevenueForecastCard at scroll position 6 is below fold on most phone viewports; lazy-mount preserves first paint.
- **HorizonToggle styling parity** (Phase 9 D-14 GrainToggle, Phase 10 D-17) — segmented control pattern.

### Integration Points
- `src/routes/api/forecast/+server.ts` (NEW) — long-format rows + events + last_run; `?horizon=` + `?granularity=` params.
- `src/routes/api/forecast-quality/+server.ts` (NEW) — long-format quality metrics; filters to `evaluation_window='last_7_days'`.
- `src/routes/api/campaign-uplift/+server.ts` (NEW) — single cumulative_deviation_eur using hard-coded campaign-start.
- `src/lib/components/RevenueForecastCard.svelte` (NEW) — composed card with LazyMount wrapper.
- `src/lib/components/HorizonToggle.svelte` (NEW) — 4-chip horizon selector.
- `src/lib/components/ForecastLegend.svelte` (NEW) — model toggle chip row.
- `src/lib/components/ForecastHoverPopup.svelte` (NEW) — Tooltip.Root snippet content.
- `src/lib/components/EventMarker.svelte` (NEW) — vertical line / background marker primitive.
- `src/lib/forecastConfig.ts` (NEW) — `CAMPAIGN_START` constant.
- `src/lib/emptyStates.ts` — extend (no new file).
- `src/lib/chartPalettes.ts` — extend (no new file).
- `src/routes/+page.svelte` — insert `<LazyMount>...<RevenueForecastCard /></LazyMount>` at position 6.
- `tests/unit/RevenueForecastCard.test.ts` (NEW) + tests for the 3 endpoints.

### Counter-patterns to AVOID
- **Do not** read raw `forecast_daily_mv` from any `src/` file (CI Guard 1 fails build).
- **Do not** use `Tooltip.Root` with `let:data` — Svelte 5 throws `invalid_default_snippet` (memory).
- **Do not** set `touchEvents: 'pan-x'` on the `<Chart>` wrapper (memory).
- **Do not** ship raw `yhat_samples` arrays to the client (Phase 14 C-05 / D-04).
- **Do not** put any of the 3 new endpoints in the SSR `Promise.all` — they MUST be deferred client fetches per Phase 11 D-03 to stay under CF Pages 50-subrequest budget.
- **Do not** add raw `2026-04-14` date literals scattered through components — single source: `forecastConfig.ts`.
- **Do not** save plans to `docs/superpowers/plans/` — Phase 15 plans live in `.planning/phases/15-forecast-chart-ui/15-XX-PLAN.md` per `docs/workflow.md` save-path override.

</code_context>

<deferred>
## Deferred Ideas

- **Track-B counterfactual cumulative-uplift display** — Phase 16. Phase 15's `/api/campaign-uplift` returns BAU-deviation only.
- **`campaign_calendar` table + admin form** — Phase 16. Phase 15 hard-codes the 2026-04-14 campaign-start in `forecastConfig.ts`.
- **`CampaignUpliftCard.svelte`** dedicated card — Phase 16.
- **CI grep guard against raw `2026-04-14` literals** — Phase 16 adds once `campaign_calendar` exists.
- **Conformal-calibrated 95% CI for ≥35d horizons** — Phase 17 (BCK-02 / `ConformalIntervals(h=35, n_windows=4)`). Phase 15 ships the uncalibrated-CI badge for the 365d horizon; the badge stays until Phase 17 lands.
- **≥10% RMSE promotion gate to enable Chronos / NeuralProphet by default** — Phase 17 (BCK-04). Phase 15 keeps them feature-flag-off via Phase 14 D-09.
- **Forecast confidence-tier visual indicator** (e.g., dotted vs solid CI band based on backtest score) — Phase 17 follow-up.
- **Custom date-range picker for the forecast chart** — out of scope per REQUIREMENTS.md and CLAUDE.md mobile-first rule. Horizon chips are the primitive.
- **Hourly forecasts** — out of scope per CLAUDE.md daily-refresh constraint.
- **Forecasts for menu items / order_items grain** — Phase 14 only forecasts `revenue_eur` + `invoice_count`.
- **Push notifications when forecast deviates >X%** — out of scope per Phase 4 (daily refresh, no realtime).
- **Export forecast data as CSV** — rejected per REQUIREMENTS.md "Out of Scope".
- **Desktop-optimized chart layout** — out per CLAUDE.md mobile-first rule.

</deferred>

---

*Phase: 15-forecast-chart-ui*
*Context gathered: 2026-04-30*
*Decision mode: auto-recs (per `.claude/memory/feedback_follow_recs_first.md`)*
