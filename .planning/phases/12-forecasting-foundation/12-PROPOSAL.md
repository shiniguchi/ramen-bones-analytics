# Milestone 12 — External Data & Forecasting Foundation
**Status:** PROPOSAL
**Driver:** Add weather + holidays + events ingestion, build forecast engine, render multi-method prediction lines on revenue chart, attribute uplift.
**Codename:** `12-forecasting-foundation`
**Suggested folder:** `.planning/phases/12-forecasting-foundation/`

---

## How to drive this with your existing slash commands

Run in this order. Each step's input prompt is provided verbatim below.

| Step | Command | Input | Produces |
|---|---|---|---|
| 1 | `/gsd:new-milestone` | § "Milestone input" below | `.planning/STATE.md` update + new milestone entry |
| 2 | `/gsd:discuss-phase 12.0` | § "Decisions to lock" | `12-CONTEXT.md` with D-01..D-12 |
| 3 | `/gsd:research-phase 12.0` | references this file | `12-RESEARCH.md` (you can paste in §6, §7, §8) |
| 4 | `/gstack:office-hours` | § "Office hours topics" | Logged design decisions |
| 5 | `/gsd:discuss-phase 12.1` ... `12.5` | per sub-phase | One CONTEXT per sub-phase |
| 6 | `/gsd:execute-phase 12.1-01` | first plan | Runs |

Repeat 5-6 for each sub-phase.

---

## §1 Milestone input (paste into `/gsd:new-milestone`)

```
Milestone: v1.3 — External Data & Forecasting Foundation

Why now:
- v1.2 shipped revenue + cohort + retention dashboards (Phase 11 done).
- The friend-owner started a marketing campaign on 2026-04-14; she wants a "did it work?" answer.
- Current MDE analysis says we cannot detect <20% lifts in <6 weeks at current σ.
- Identification: the pre-campaign era (2025-06-11 to 2026-04-13, 10 months) is the natural control period. Track-B counterfactual fit on pre-period only → causal uplift via Interrupted Time Series.
- The chart needs a forecast line so deviations are visible at a glance.

Goal of this milestone:
1. Ingest free external signals (weather, German + Berlin holidays, school holidays,
   Berlin transit-strike alerts, recurring city events) into Supabase, with backfill
   from 2025-06-11 and 7-day forward forecast where available.
2. Build a multi-horizon forecasting engine producing revenue + transaction
   predictions for **+7d, +35d (5 weeks), +120d (4 months), +365d (1 year)** with
   calibrated 95% intervals, refreshed daily and exposed as a Supabase view.
3. Render the forecast as overlay lines on the existing revenue chart (1 chart shows
   actual + 2-3 forecast methods + uncertainty band + event annotations + horizon toggle).
4. **Primary chart purpose: incremental-uplift attribution.** actual − forecast over
   each campaign window (Thu→Wed) = lift estimate; cumulative since campaign #1 = total
   incrementality. Hover any forecast line for per-horizon RMSE/MAPE + last-refit date.
5. Establish a backtest gate: any new model must beat naive same-DoW baseline by
   ≥10% RMSE on rolling-origin out-of-sample, computed PER HORIZON (7/35/120/365).
6. **Causal attribution via Interrupted Time Series**: pre-campaign era
   (2025-06-11 to 2026-04-13, 10 months) is the natural control period. Train
   the Track-B counterfactual on pre-period data ONLY; project forward;
   actual − projection = causal uplift attributable to the campaign era.
   No customer holdout needed (Instagram channel = no per-follower exclusion).

Out of scope (defer to v1.4+):
- Full Marketing Mix Modeling (PyMC-Marketing, Meridian) — wait until 3+ channels.
- Multi-shop scaling — keep 1 shop until friend wants to fork.
- Real-time / hourly forecast — daily granularity is enough.
- Demand forecasting at item level — only revenue + transaction count.

Sub-phases (5):
12.0 — Foundation: schema + identification design (decisions only, no code)
12.1 — External data ingestion (weather, holidays, events tables + Python cron)
12.2 — Forecasting engine (model fits + view + backtest harness)
12.3 — Forecast chart UI (LayerChart overlay + event markers + granularity toggle)
12.4 — Uplift attribution via Interrupted Time Series (Track-B counterfactual on pre-campaign era)
12.5 — Backtest gate, alerting, and quality monitoring

Constraints:
- $0/month budget. Open-Meteo + python-holidays + ferien-api.de + BVG RSS = $0.
- Multi-tenant-ready schema even though v1 has one tenant.
- Mobile-first (forecast chart must be readable on iPhone Safari).
- RLS on every new table.
- pg_cron + GitHub Actions for scheduling (existing pattern).
- Forkable (no proprietary SaaS).

Success criteria (top-level):
- New tables `weather_daily`, `holidays`, `school_holidays`, `transit_alerts`,
  `recurring_events`, `forecast_daily` exist with RLS + unique indexes.
- Nightly Python cron in `.github/workflows/external-data-refresh.yml` populates them.
- `forecast_daily_v` joins actual + forecast and is consumed by a SvelteKit page.
- The dashboard's revenue card shows ≥2 forecast lines + uncertainty band.
- Backtest report file under `tests/forecast/` shows model RMSE vs naive on 12 weeks rolling.
- ITS-based causal uplift live: Track-B counterfactual fit on pre-campaign era; `campaign_uplift_v` returns rows for every campaign.

Estimated calendar: 8-12 weeks for one analyst.
- 12.0: 1 week (decisions only)
- 12.1: 2 weeks (data ingestion + Python cron + GH Actions)
- 12.2: 2-3 weeks (5 models, multi-horizon, BAU+counterfactual tracks, backtest harness)
- 12.3: 2 weeks (chart UI + mobile QA + hover popups)
- 12.4: 2 weeks (single-track ITS — counterfactual fit on pre-campaign era, no holdout infrastructure needed)
- 12.5: 1 week (gate + alerting)
Total: 10-12 weeks. Cut 12.4-Layer-B to v1.4 if pressed.
```

---

## §2 Phase 12 sub-phase breakdown

### Phase 12.0 — Foundation (decisions, no code)

**Purpose:** Lock high-level design before any Python or SQL gets written.
**Artifact:** `.planning/phases/12-forecasting-foundation/12-0-CONTEXT.md`
**Suggested duration:** 1-2 days.

**One artifact to commit during 12.0:**
- Move `tools/its_validity_audit.py` (currently in workspace) into the repo at `tools/its_validity_audit.py`. This script is the recurring health check — run it weekly (or every time a campaign starts) to catch hidden concurrent changes (price hikes, hour shifts, new staff, etc.) before they bias the ITS estimate.
- The 2026-04-27 audit already verified: prices stable, customer behavior fundamentals stable, 3 new menu items launched coincidentally (handled via `baseline_items_v`), Pop up menu is stochastic noise (don't model). These findings drive the schema decisions in §7.

**Decisions to lock (paste into `/gsd:discuss-phase 12.0`):**

| ID | Question | Recommended |
|---|---|---|
| D-01 | Weather source | **Open-Meteo** (dev/MVP), **Bright Sky** (commercial-safe fallback). Both free, both verified. |
| D-02 | Federal+state holidays source | **`python-holidays` PyPI package** (offline, MIT, no API call) |
| D-03 | School holidays source | **`ferien-api.de`** REST JSON, MIT, `BE` for Berlin |
| D-04 | Transit-strike alerts source | **BVG RSS** at `https://www.bvg.de/de/aktuelles?format=rss` (verify URL during research-phase) |
| D-05 | Recurring city events source | **Hand-curated YAML/CSV** (15-20 events/year), refreshed Oct each year from Wikipedia annual events list |
| D-06 | Forecast model #1 (production primary) | **SARIMAX** with exog regressors (already in statsmodels, in current deps) |
| D-07 | Forecast model #2 (overlay/comparison) | **Prophet** with regressors (for stakeholder-friendly `plot_components`) |
| D-08 | Forecast model #3 (zero-shot wildcard) | **Chronos-Bolt-Tiny** (Amazon foundation model, no training) — optional; behind feature flag |
| D-09 | Forecast horizon | **+7 days forward**, refit nightly |
| D-10 | Backtest harness | Rolling-origin CV, 12 weeks, 7-day-ahead horizons, RMSE + MAPE; gate at ≥10% improvement vs naive same-DoW-mean baseline |
| D-11 | Identification strategy | **Pre-campaign-era ITS** (2025-06-11 to 2026-04-13 as natural control). Customer holdout impossible (Instagram channel, no email list). |
| D-12 | Forecast table grain | One row per (tenant_id, kpi_name, target_date, model_name, run_date) — wide table → MV → tenant wrapper view |

**Why these defaults:** every choice prioritizes minimal new dependencies, free-tier longevity, and an off-ramp if the source dies.

---

### Phase 12.1 — External data ingestion

**Files added:**
```
scripts/external/
  weather_fetch.py            # Open-Meteo: backfill + daily refresh + 7d forecast
  holidays_seed.py            # python-holidays + ferien-api.de → tables
  transit_alerts_fetch.py     # BVG RSS parser, German keyword matching
  recurring_events_seed.py    # YAML → table loader
  recurring_events.yaml       # hand-curated list, source-controlled
  __init__.py
.github/workflows/
  external-data-refresh.yml   # nightly 02:30 UTC cron
supabase/migrations/
  00XX_weather_daily.sql
  00XX_holidays.sql
  00XX_school_holidays.sql
  00XX_transit_alerts.sql
  00XX_recurring_events.sql
  00XX_external_data_views.sql   # tenant wrapper views
```

**Plans (3):**
- `12-1-01-PLAN.md` — Schema migrations + RLS policies + indexes
- `12-1-02-PLAN.md` — Python fetchers + workflow + secrets wiring (Supabase service role key in GH secrets)
- `12-1-03-PLAN.md` — Backfill historical weather/holidays from 2025-06-11 + verify row counts

**Verification (per CLAUDE.md QA gate):**
- `select count(*) from weather_daily where date >= '2025-06-11'` returns ≥320
- `select count(*) from holidays where year(date) = 2026` returns 9 federal + 1 Berlin (Frauentag)
- `select count(*) from school_holidays where year_start = 2026` returns 5-6 blocks
- GH workflow run completes in <5 min
- DB MCP query: every new table has RLS enabled

---

### Phase 12.2 — Forecasting engine (multi-horizon, daily refit)

**Files added:**
```
scripts/forecast/
  sarimax_fit.py              # primary model — predicts 365d in one call
  prophet_fit.py              # secondary
  ets_fit.py                  # classical reference
  theta_fit.py                # M3 baseline
  naive_dow_baseline.py       # backtest floor
  chronos_zero_shot.py        # tertiary, behind feature flag (foundation model)
  neuralprophet_fit.py        # tier-B, behind feature flag (PyTorch dep)
  last_7_eval.py              # nightly: refits each model 7× to score last 7 actual days (§17)
  backtest.py                 # weekly: rolling-origin CV @ 7/35/120/365d horizons (§16, gate)
  fit_all.py                  # nightly orchestrator (refits + writes 365d forecast)
.github/workflows/
  forecast-refresh.yml        # nightly 03:00 Berlin (after external-data 02:30)
  forecast-backtest.yml       # weekly Tuesday 23:00 Berlin (heavy CV)
supabase/migrations/
  00XX_forecast_daily.sql            # long format: tenant, kpi, target_date, model, horizon_days, run_date
  00XX_forecast_daily_mv.sql         # latest run per (tenant,kpi,target,model)
  00XX_forecast_quality.sql          # backtest results table
  00XX_forecast_quality_v.sql        # tenant view, joined to fold runs
  00XX_forecast_with_actual_v.sql    # joins actual + forecast for chart
tests/forecast/
  test_smoke_per_model.py
  backtest_report.md          # auto-committed weekly
```

**Plans (6):**
- `12-2-01-PLAN.md` — Schema (forecast_daily long format with horizon_days col) + MV + wrapper view
- `12-2-02-PLAN.md` — SARIMAX + ETS + Theta + Naive fits, all writing 365d forecast each night
- `12-2-03-PLAN.md` — Prophet (yearly seasonality OFF) — manual changepoints, regressors wired
- `12-2-04-PLAN.md` — Chronos zero-shot + NeuralProphet behind feature flags
- `12-2-05-PLAN.md` — Last-7-actual-days nightly evaluator (§17) — populates `forecast_quality` with `evaluation_window='last_7_days'` for each model; reads from existing forecast_daily where possible, refits otherwise
- `12-2-06-PLAN.md` — Weekly rolling-origin CV harness (§16 gate) with 4 horizons, populates `forecast_quality` with `evaluation_window='rolling_origin_cv'`

**Cadence rules (D-09b):**
- **Daily refit + daily reforecast** of all models, 03:00 Berlin time
- One fit produces 365d-forward predictions; UI slices to whichever horizon is selected
- Backtest is **weekly** (Tuesday 23:00) — too expensive for nightly
- Each model writes one row per (target_date, horizon_days from run_date)

**Decisions for `/gstack:office-hours`:**
- "Conformal-prediction wrapper for calibrated CIs at long horizons?" → recommend yes for ≥35d; use StatsForecast's `ConformalIntervals`
- "365d horizon: how to handle weather (Open-Meteo only forecasts 16d)?" → fall back to climatological norms (DoW × month historical mean) for >16d ahead
- "Prophet yearly seasonality on long horizon: add at month 14+ when data crosses 2 years?" → yes, automated via data-volume check in `prophet_fit.py`

---

### Phase 12.3 — Forecast chart UI (multi-horizon + uplift attribution)

**Files added/modified:**
```
src/lib/components/
  RevenueForecastCard.svelte         # primary card: actual + forecasts + horizon toggle
  ForecastLegend.svelte              # toggle methods on/off, color key
  ForecastHoverPopup.svelte          # detailed accuracy + cum-uplift on hover
  HorizonToggle.svelte               # 7d / 5w / 4mo / 1yr chips
  CampaignUpliftCard.svelte          # per-campaign-window actual − forecast lift
  EventMarker.svelte                 # vertical line + tooltip for events/strikes
src/lib/api/
  forecast.ts                        # typed client; endpoints below
src/routes/api/
  forecast/+server.ts                # SSR-safe endpoint, deferred load
  forecast-quality/+server.ts        # serves backtest RMSE/MAPE per (model, horizon)
  campaign-uplift/+server.ts         # serves Σ(actual − forecast) per campaign window
src/routes/(app)/dashboard/
  +page.svelte                       # add forecast card + uplift card
```

**Chart spec (1 chart, multi-horizon, KISS):**

```
                                     today    +7d   +5w  +4mo            +1yr
   ┌────────────── past ──────────────┤    ┤    ┤    ┤    ┤    forecast    ┤
   actual: ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬│
   SARIMAX: ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
   Prophet: · · · · · · · · · · · · · │· · · · · · · · · · · · · · · ·
   Naive:   ░░░░░░░░░░░░░░░░░░░░░░░░░│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
                                     ▼
                                   today
   95% CI band (SARIMAX): widens with horizon, semi-transparent
```

- **Always rendered:** actual (solid black), SARIMAX (solid blue + CI shade), naive (gray dotted).
- **Toggle on:** Prophet (orange dashed), Chronos (teal thin dotted), NeuralProphet (purple dot-dash, behind flag), ensemble median (green when 2+ active).
- **Horizon toggle (top-right chips):** `7d` | `5w` | `4mo` | `1yr`. Default 7d. X-axis re-zooms; same forecast data, different slice.
- **Vertical markers:** campaign start (solid red ▌), federal holidays (dashed green |), school-holiday blocks (teal background shading), recurring events (yellow |), BVG strike days (red bar).
- **Uplift band:** during campaign-active days, actual − sarimax_forecast is shaded green (positive lift) or red (negative); the cumulative integral is shown as a running label on the chart.

**Hover popup spec (D-09c — full spec in §17):**
On hover over any forecast line at any date, show a card with:
- Forecast value and 95% CI for that date
- Horizon (days from today)
- **Last-7-actual-days accuracy:** RMSE, MAPE, bias, direction hit-rate (see §17 — this is the friend-facing accuracy number, recomputed nightly, freshness ≤24h)
- Cumulative deviation since campaign launch (actual − Track-B counterfactual)
- Last-refit timestamp

For 365d horizon while data <2 years: show "BACKTEST PENDING — uncalibrated. ≥2 years data needed for reliable annual forecast" badge.

**Granularity toggle (separate from horizon):** day / week / month — resamples actual + forecast samples (1000 paths per model) over the time bucket, takes percentiles for proper CI aggregation.

**Plans (4):**
- `12-3-01-PLAN.md` — RevenueForecastCard skeleton + LayerChart overlay layer + line styles
- `12-3-02-PLAN.md` — Horizon toggle + X-axis re-zoom + sample-path resampling for week/month CI
- `12-3-03-PLAN.md` — Hover popup (per-line accuracy + cumulative uplift) + event markers
- `12-3-04-PLAN.md` — Mobile QA (iPhone Safari, tap-to-pin tooltip, max 2 lines visible by default to avoid spaghetti)

---

### Phase 12.4 — Uplift attribution via Interrupted Time Series

**Purpose:** Causal lift estimate from day 1 using the pre-campaign era as the natural control period.

**The ITS contract:**
- Track B (counterfactual) is fit on `[2025-06-11 .. 2026-04-13]` only (pre-campaign era)
- Projects forward through today + 365d
- For any campaign window, uplift = Σ(actual − Track-B) over the window
- 95% CI via Monte Carlo: sample 1000 paths from Track B's posterior, sum, compute percentiles
- Stored in `campaign_uplift_v`, filtered by chosen model (default SARIMAX)

**Why this is causal (and not just deviation):**
- Pre-campaign data is genuinely intervention-free (the friend confirmed: no marketing during that period)
- Track B is trained without seeing any campaign-era data → its projection is a true counterfactual
- The estimate inherits the ITS validity assumptions: trend stationarity, no concurrent intervention, regressor sufficiency
- Unlike "fit on all data and zero out is_campaign," there's no leakage of campaign effect into the model parameters

**Decisions for `/gstack:office-hours`:**
- "Counterfactual baseline model — SARIMAX, Prophet, BSTS, or ensemble?" → recommend SARIMAX as primary, BSTS/CausalImpact as secondary deep-dive once-monthly retro
- "How to handle the trend extrapolation risk?" — pre-period revenue is declining; counterfactual will project continued decline; if actual is flat, that's a positive lift signal even without growth
- "When to introduce quarterly off-weeks (D-11b) to re-anchor the counterfactual?" — recommend month 6 post-launch (~October 2026)
- "Walk-in (non-Instagram) attribution: ITS captures aggregate effect including walk-ins by construction (no per-customer tracking needed)"

**Files added:**
```
scripts/forecast/
  counterfactual_fit.py       # fits each model on pre-campaign data only
                              # writes Track-B forecasts to forecast_daily
scripts/uplift/
  cumulative_uplift.py        # nightly: Σ(actual − Track-B) per campaign per model
supabase/migrations/
  00XX_campaign_calendar.sql  # source of truth: campaign on/off windows
  00XX_campaign_uplift_v.sql  # actual − Track-B counterfactual, per window per model
  00XX_campaign_active_v.sql  # helper: is a campaign running today?
```

**Plans (3):**
- `12-4-00-PLAN.md` — Campaign admin entry: `CampaignAdminForm.svelte` (or initial seed via Supabase Studio SQL editor for V1)
- `12-4-01-PLAN.md` — Track-B counterfactual fit on pre-campaign era only + `campaign_uplift_v`
- `12-4-02-PLAN.md` — UI: `CampaignUpliftCard.svelte` + per-campaign drill-down + cumulative since launch

---

### Phase 12.5 — Backtest gate + alerting

**Purpose:** Wire the backtest harness into CI. Block model deployment if RMSE regresses.

**Files added:**
```
.github/workflows/
  forecast-quality-gate.yml   # weekly; blocks merge if backtest fails
tests/forecast/
  test_backtest_gate.py
docs/forecast/
  ACCURACY-LOG.md             # weekly RMSE history, manually committed by gate
```

**Plans (2):**
- `12-5-01-PLAN.md` — Quality gate workflow + alert rules (Slack webhook?)
- `12-5-02-PLAN.md` — Accuracy log + dashboard surface ("model trust score")

---

## §3 Decision matrix to lock during `/gsd:discuss-phase 12.0`

For each row, run office-hours if you want to debate, otherwise default to "recommended."

```yaml
# Paste into 12-0-CONTEXT.md decisions section
decisions:
  D-01:
    question: Which weather source?
    options: [open-meteo, brightsky, meteostat]
    recommended: open-meteo
    rationale: |
      Verified free, no API key, 80yr history, 7d forecast, CC-BY 4.0 data license.
      API ToS says "non-commercial" but data itself permits commercial use.
      Brightsky is the commercial-safe fallback (DWD public domain).

  D-02:
    question: Federal + Berlin holidays source?
    options: [python-holidays, feiertage-api, openholidaysapi]
    recommended: python-holidays
    rationale: |
      MIT, offline, zero API calls, includes Berlin Frauentag (since 2019).
      Feiertage-api is the network-call alternative if we want freshness.

  D-03:
    question: School holidays (Schulferien) source?
    options: [ferien-api, mehr-schulferien, manual]
    recommended: ferien-api.de
    rationale: |
      MIT, REST JSON, BE state code, <10ms latency. Mehr-schulferien is single-endpoint
      alternative if we want a hybrid that also does federal holidays.

  D-04:
    question: Transit-strike feed?
    options: [bvg-rss, vbb-html-scrape, verdi-news, manual]
    recommended: bvg-rss
    rationale: |
      BVG covers ~95% of relevant Berlin transit. RSS keyword match on "Streik" /
      "Ausfälle" / "Betriebsstörung". Verify URL during research-phase.
    todo: verify https://www.bvg.de/de/aktuelles?format=rss returns valid RSS

  D-05:
    question: Recurring city events?
    options: [wikipedia-scrape, hand-curated-yaml, visitberlin-html-scrape]
    recommended: hand-curated-yaml
    rationale: |
      ~15-20 events/year matter for foot traffic (Marathon, CSD, Berlinale, Karneval,
      Lange Nacht der Museen, Christmas markets, NYE). One human hour per October to
      maintain. Source-controlled. Wikipedia scraping adds parser fragility for
      marginal benefit.

  D-06:
    question: Primary forecast model?
    options: [sarimax, prophet, ets, theta, lightgbm-mlforecast, chronos-zeroshot]
    recommended: sarimax
    rationale: |
      Already in statsmodels deps. Minimal install. Native exog regressor support.
      With 10 months of data, beats Prophet on seasonal-only series. Fast to fit.

  D-07:
    question: Secondary model for chart overlay?
    options: [prophet, lightgbm-mlforecast, chronos]
    recommended: prophet
    rationale: |
      plot_components is uniquely good for stakeholder communication.
      Forces yearly_seasonality=False (only 10mo data).
      Explicit changepoints at [2026-02-03, 2026-03-02] for Mon/Tue regime shifts.

  D-08:
    question: Tertiary model (zero-shot wildcard)?
    options: [chronos-bolt-tiny, timesfm-200m, none]
    recommended: chronos-bolt-tiny
    rationale: |
      No training. Tiny model fits in Cloudflare Workers if needed (probably not).
      Shows "what would a 2026 foundation model say?" — pure benchmark line.
      Strong on multi-horizon (good at long forecasts where SARIMAX degrades).
    behind_feature_flag: true

  D-08b:
    question: Should NeuralProphet be added back as Tier B optional?
    options: [add-feature-flagged, skip]
    recommended: add-feature-flagged
    rationale: |
      NeuralProphet (Triebe et al. 2021) adds an autoregressive neural component to
      Prophet's decomposition — captures yesterday-informs-today dynamics that pure
      Prophet misses. Often beats Prophet on short series (<2 years). Same `add_regressor`
      API.
      Cost: PyTorch dependency (~500MB on GHA runner — fine, cached).
      Verdict: NOT primary (Prophet+SARIMAX already cover the additive-decomposition
      space), but worth a feature-flagged backtest run. If it beats SARIMAX by ≥5% on
      35d/120d horizons, promote to Tier A. If not, drop the dependency.

  D-09:
    question: Forecast horizons?
    options:
      - single-7d
      - multi-horizon-7-35-120-365
    recommended: multi-horizon-7-35-120-365
    rationale: |
      User explicitly wants 4 horizons:
        - 7d   → tactical (next week, very high precision expected)
        - 35d  → 5 weeks, aligns with ~5 campaign cycles ahead
        - 120d → 4 months, seasonal planning
        - 365d → annual, headline narrative
      Implementation: ONE fit per model per night, predict 365 days forward, slice in
      view layer. UI toggle re-zooms X-axis; same prediction data drives all 4 views.
      Caveat: 365d forecast accuracy is uncalibrated until ≥2 years of data accumulates
      (currently 10 months). UI must show "n/a" or "low confidence" badge on 365d
      backtest column for the next 14 months.
      Weather forecast only available 7-16d from Open-Meteo; beyond that,
      regressors fall back to climatological norms (multi-year average for that DoW+month).

  D-09b:
    question: Refit + reforecast cadence?
    options:
      - daily-refit-daily-reforecast
      - weekly-refit-daily-reforecast
      - daily-reforecast-only-fixed-fit
    recommended: daily-refit-daily-reforecast
    rationale: |
      All chosen models (SARIMAX, Prophet, ETS, Theta) fit in <60s combined per night.
      Foundation models (Chronos) are zero-shot — no fit, instant.
      Daily refit means params absorb the latest day; daily reforecast means the user
      always opens the dashboard to a fresh 365-day projection.
      Schedule: 03:00 Berlin time (after external-data-refresh at 02:30, before insights
      job at 04:00). Existing pg_cron + GHA cron pattern.
      Backtest separately: rolling-origin CV runs WEEKLY on Tuesday night (cheaper,
      heavier compute), produces per-horizon RMSE/MAPE, writes to `forecast_quality_v`
      consumed by the UI hover popups.

  D-09c:
    question: What does the hover popup show on each forecast line?
    options:
      - minimal (just yhat + CI)
      - full (yhat + CI + horizon + last_7d_accuracy + last_refit + cum_deviation)
    recommended: full
    rationale: |
      User explicitly asked for accuracy on hover. Make it count.
      The accuracy row uses **last 7 actual data-available days** (not the
      production-gate 12-fold rolling CV). See §17 for full spec.
      Layout:
        Method:           SARIMAX
        Forecast value:   €842 (95% CI €712 – €972)
        Horizon:          14 days ahead
        ACCURACY OVER LAST 7 ACTUAL DAYS (2026-04-16..04-22):
          RMSE €148  MAPE 18%  Bias +€42  Direction hit 6/7
        Last refit:       2026-04-26 03:01 UTC
        Cum. deviation since campaign: +€420 (95% CI -€180 to +€1020)
          (label: "uplift" since Track B is fit on pre-campaign era only — see §11)
      Last-7-days accuracy is recomputed nightly and read from
      `forecast_quality WHERE evaluation_window='last_7_days'`.

  D-10:
    question: Backtest baseline?
    options: [naive-dow-mean, theta, ets, last-value]
    recommended: naive-dow-mean
    rationale: |
      Mean of last 4 same-DoW pre-days. Cheap, intuitive, hard to beat.
      Gate: production model must beat by ≥10% RMSE on 12-week rolling CV.

  D-11:
    question: Identification strategy?
    options: [pre-campaign-era-ITS, off-week-rotation, spend-variation, none]
    recommended: pre-campaign-era-ITS
    rationale: |
      Channel reality: marketing is Instagram-only (~4K followers). Per-follower
      holdout is impossible — Instagram does not support audience exclusion at this
      account size. Email/SMS holdout is also off the table (no email list).
      Therefore: use the **pre-campaign era (2025-06-11 to 2026-04-13, 10 months)
      as the natural control period**. This is classical Interrupted Time Series:
        - Train Track B (counterfactual) on pre-campaign data ONLY
        - Project forward for the post-campaign period
        - actual − Track B = causal uplift attributable to the campaign era
      This makes Track B the rigorous causal estimate from day 1 — no holdout
      infrastructure to build, no GDPR review needed.
      Validity assumes:
        a) trend in pre-period extrapolates (it's been declining; model that)
        b) no other major intervention coincided with 2026-04-14 (verify with friend)
        c) the campaign is the dominant change (not weather/seasonality, which the
           regressors absorb)
      Trade-off vs holdout: ITS estimate degrades over time as the projection
      becomes more speculative. Beyond ~6 months post-launch, recalibrate by
      adding off-weeks (D-11b) or accept widening CI.
    blockers: none — can ship Layer A as causal from day 1
  D-11b:
    question: Long-term identification refresh?
    options: [add-quarterly-off-weeks, accept-widening-ITS-ci, do-nothing]
    recommended: add-quarterly-off-weeks
    rationale: |
      Pre-campaign-ITS validity decays. Once per quarter, schedule a 1-week
      off-period (no Instagram posts, no offers). That week's revenue gives a
      fresh point for the counterfactual to re-anchor.
      Cost: ~1 week of campaign reach per quarter. Worth it for unbiased lift
      measurement.
      Decision deferred to v1.4. For v1.3 (this milestone), pre-period ITS only.

  D-12:
    question: Forecast table grain?
    options:
      - long: one row per (tenant, kpi, date, model, run_date, forecast_track)
      - wide: one row per (tenant, date, run_date) with model columns
    recommended: long
    rationale: |
      Long is universal across model count. Pivot to wide in the view layer.
      Adding a model later = one new row, no schema change.
      KPIs forecast: `revenue_eur` (chart headline, raw),
                     `invoice_count`,
                     `revenue_comparable_eur` (baseline items only, ITS-clean).
      The campaign uplift readout joins on `revenue_comparable_eur`'s
      Track-B counterfactual — that's the unbiased causal estimate.
      `revenue_eur` is shown in the chart for the friend's intuition but is
      NOT used for uplift attribution.
```

---

## §4 Office-hours topics for `/gstack:office-hours`

These are too thorny for `/gsd:discuss-phase` — they need real consultation:

1. **ITS validity assumptions for pre-campaign-era counterfactual.**
   Was there any other change at the shop on or near 2026-04-14 that would confound the campaign signal? (New menu? Price change? Staff turnover? Construction nearby? Seasonal tourism shift?) If yes, the ITS estimate is biased. If no, ship it. Verify with friend.

2. **ITS validity decay window.**
   Pre-period ITS counterfactual gets less credible as projection horizon grows. After ~6 months post-launch, the counterfactual is mostly speculation. Decision: when to introduce quarterly off-weeks (D-11b) to re-anchor? Bake into product roadmap for v1.4 or accept widening CI.

3. **Forecast model selection rule.**
   When SARIMAX, Prophet, and Chronos disagree, which one shows on the chart by default? Median? Weighted by backtest RMSE? User toggle? Pick a defensible auto-selection rule.

4. **CI calibration.**
   SARIMAX, Prophet, and Chronos all give CIs that may not be calibrated (real coverage ≠ nominal 95%). Conformal-prediction wrapper around the chosen model? When?

5. **Multi-tenant timezone correctness.**
   Berlin shop = Europe/Berlin. Forecast date boundaries vs UTC boundaries. Nightly refresh job runs in UTC. How to keep dates aligned across all queries?

6. **Forecast table refresh ordering.**
   pg_cron runs nightly: weather → holidays → events → forecast → insights. What happens if upstream fails? Idempotency? Retry policy?

7. **Closed-day handling.**
   Mon/Tue closed before regime shift (Feb 3 / Mar 2, 2026). SARIMAX/Prophet expect continuous time series. Drop closed days? Mark as missing? Encode "is_open" as binary regressor and predict 0?

8. **Foundation models on Cloudflare.**
   Chronos-Bolt-Tiny (~9MB) — does it fit in CF Workers' 128MB compute budget? Or always run server-side via Supabase Edge Functions / GHA cron and write predictions to a table?

9. **Cost / quota ceilings.**
   Open-Meteo free is 10k req/day. Probably fine for 1 tenant × 1 location × 2 calls/day. What's the runway when this scales to 50 shops? At what tenant count does the cost become non-zero?

10. **Feature-flag mechanism.**
    Where do the Chronos / NeuralProphet feature flags live? Recommended: env var `FORECAST_ENABLED_MODELS=sarimax,prophet,naive_dow` on the GHA workflow + a `feature_flags` table for SvelteKit SSR reads (one row per (tenant, flag_key) for tenant-scoped overrides). Confirm or pick alternative.

---

## §5 Prediction lines catalog (for one chart, prioritized)

The user asked: "draw all prediction lines you think possible in 1 chart." Here's the prioritized list.

### Tier A — must build (Phase 12.2, 12.3)

| # | Line | Model | Effort | Lib | Notes |
|---|---|---|---|---|---|
| 1 | Naive same-DoW mean of last 4 wks | (rolling mean) | trivial | none | The backtest floor; always shown |
| 2 | SARIMAX(1,0,1)(1,1,1,7) + weather + holidays + is_campaign | SARIMAX | low | statsmodels (already in stack) | Production primary |
| 3 | Prophet (yearly off, weekly on, manual changepoints) + same regressors | Prophet | medium | prophet (new dep) | Shown for `plot_components` audit |

### Tier B — fast-follow (Phase 12.2 if time, else 12.X.1)

| # | Line | Model | Effort | Lib | Notes | Best horizon |
|---|---|---|---|---|---|---|
| 4 | Chronos-Bolt-Tiny zero-shot | foundation | low (no fit) | `chronos-forecasting` (HF) | "What does a 2026 foundation model say?" | strong 7-365d |
| 5 | Theta method (M3 winner) | classical | trivial | statsforecast | Optional baseline | 7-35d |
| 6 | ETS / Holt-Winters | classical | trivial | statsmodels | Compare to SARIMAX | 7-35d |
| 7 | LightGBM with lag features | tree | medium | mlforecast (new dep) | Likely best at scale | 7-35d |
| 8 | **NeuralProphet** | neural-additive | medium | neuralprophet (PyTorch) | Behind feature flag. AR component captures yesterday→today; sometimes beats Prophet on <2yr data. Drop if backtest shows no gain over SARIMAX+Prophet. | 7-120d |

### Tier C — Tier 3 advanced (defer to v1.4)

| # | Line | Model | Effort | Lib | Notes | Best horizon |
|---|---|---|---|---|---|---|
| 9 | Conformal-prediction-wrapped SARIMAX | wrapper | medium | statsforecast | Calibrated CIs especially at long horizons | 35-365d |
| 10 | CausalImpact / BSTS counterfactual | bayesian | medium | tfcausalimpact | Per-campaign retro deep-dive (monthly), not on daily chart | event-window |
| 11 | Ensemble median of (SARIMAX, Prophet, LightGBM) | meta | trivial | numpy | Robust default once 3+ models in production | 7-120d |
| 12 | DeepAR / TFT / N-BEATS / PatchTST | deep | high | gluonts/darts | Skip; need ≥2 years multi-series | n/a yet |
| 13 | PyMC-Marketing / Meridian / Robyn (full MMM) | bayesian | very high | pymc-marketing | Wait for ≥3 marketing channels | n/a |

### Final default chart configuration (1 chart, KISS)

**Always rendered:**
- actual (solid black)
- naive same-DoW baseline (dotted gray, low contrast)
- SARIMAX forecast + 95% CI band (solid blue + light blue shade)

**Toggle visible (legend chips):**
- Prophet (dashed orange)
- LightGBM/MLForecast (dot-dash purple)
- Chronos zero-shot (thin dotted teal)
- Ensemble median (thicker green when ≥2 toggled)

**Annotations:**
- Vertical solid red: campaign start days
- Vertical dashed green: federal holidays
- Vertical dashed teal + transparent shade: school-holiday blocks
- Vertical dashed yellow: recurring events
- Vertical solid red bar: BVG strike days

---

## §6 Verified data sources (paste into `12-RESEARCH.md`)

### Weather
- **Primary:** Open-Meteo. Endpoint: `https://archive-api.open-meteo.com/v1/archive` (historical), `https://api.open-meteo.com/v1/forecast` (7-day). No API key. Variables: `temperature_2m_max`, `temperature_2m_min`, `precipitation_sum`, `wind_speed_10m_max`, `weather_code`, `sunshine_duration`. License: CC-BY 4.0 data; API ToS says non-commercial — flag for production launch.
- **Fallback:** Bright Sky (https://api.brightsky.dev/weather). Public domain DWD data. No daily aggregation native — sum hourly to daily in Python.

### Holidays
- **Federal + Berlin:** `python-holidays` PyPI. `holidays.Germany(state="BE", years=2026)` — returns 9 federal + Frauentag (March 8).
- **School (Schulferien):** `ferien-api.de`. `GET https://ferien-api.de/api/v1/holidays/BE/2026.json` returns 5-6 blocks for the year.

### Transit strikes
- **BVG official:** RSS at `https://www.bvg.de/de/aktuelles?format=rss` (URL needs verification in research-phase). German keyword filter: `Streik`, `Ausfälle`, `Betriebsstörung`.
- **Fallback:** monitor r/berlin RSS + manual owner flag.

### Recurring events (hand-curated YAML)
Initial seed list for 2026:
```yaml
- name: Berlinale
  category: festival
  date: 2026-02-12
  duration_days: 11
  impact_estimate: medium  # Mitte only
- name: Frauentag
  category: holiday
  date: 2026-03-08
  duration_days: 1
  impact_estimate: medium
- name: Karneval der Kulturen
  category: festival
  date: 2026-05-23  # Pfingsten weekend
  duration_days: 3
  impact_estimate: high   # adjacent to Friedrichshain
- name: CSD Berlin (Christopher Street Day)
  category: festival
  date: 2026-07-25
  duration_days: 1
  impact_estimate: high
- name: Lange Nacht der Museen
  category: festival
  date: 2026-08-29
  duration_days: 1
  impact_estimate: medium
- name: Berlin Marathon
  category: sports
  date: 2026-09-27
  duration_days: 1
  impact_estimate: high
- name: Christmas markets
  category: market
  date: 2026-11-23
  duration_days: 33
  impact_estimate: medium  # multi-week, low daily
- name: Silvester (NYE Brandenburger Tor)
  category: festival
  date: 2026-12-31
  duration_days: 1
  impact_estimate: high
```

---

## §7 Schema sketches (paste into `/gsd:research-phase 12.1`)

```sql
-- 00XX_weather_daily.sql
create table weather_daily (
  date date not null,
  location text not null default 'berlin',
  temp_max_c numeric,
  temp_min_c numeric,
  temp_mean_c numeric,
  precip_mm numeric,
  wind_max_kmh numeric,
  sunshine_hours numeric,
  weather_code int,
  is_forecast boolean not null default false,
  fetched_at timestamptz not null default now(),
  primary key (date, location)
);
alter table weather_daily enable row level security;
create policy weather_daily_read on weather_daily for select using (true);
create unique index weather_daily_pk on weather_daily(date, location);
-- Mark as MV-eligible later if needed.

-- 00XX_holidays.sql
create table holidays (
  date date primary key,
  name text not null,
  country_code text not null default 'DE',
  state_code text,                       -- 'BE' for Berlin-only (Frauentag)
  is_public boolean not null default true,
  source text not null
);
alter table holidays enable row level security;
create policy holidays_read on holidays for select using (true);

-- 00XX_school_holidays.sql
create table school_holidays (
  state_code text not null default 'BE',
  block_name text not null,              -- 'Sommerferien', etc.
  start_date date not null,
  end_date date not null,
  source text not null,
  primary key (state_code, block_name, start_date)
);
alter table school_holidays enable row level security;
create policy school_holidays_read on school_holidays for select using (true);

-- 00XX_transit_alerts.sql
create table transit_alerts (
  alert_id text primary key,             -- hash of title+date
  affected_date date not null,           -- inferred from text
  title text not null,
  body text,
  category text,                         -- 'strike', 'disruption', 'maintenance'
  severity text,                         -- 'high', 'medium', 'low'
  source text not null,                  -- 'bvg-rss'
  fetched_at timestamptz not null default now()
);
alter table transit_alerts enable row level security;
create policy transit_alerts_read on transit_alerts for select using (true);
create index transit_alerts_date_idx on transit_alerts(affected_date);

-- 00XX_recurring_events.sql
create table recurring_events (
  event_id text primary key,             -- slug
  name text not null,
  category text,                         -- 'festival', 'sports', 'market', 'holiday'
  start_date date not null,
  end_date date not null,
  impact_estimate text,                  -- 'high'|'medium'|'low'
  notes text,
  source text not null
);
alter table recurring_events enable row level security;
create policy recurring_events_read on recurring_events for select using (true);

-- 00XX_baseline_items_v.sql
-- Items first seen ≥7 days BEFORE the tenant's campaign start.
-- Used to derive `revenue_comparable_eur` for clean ITS attribution
-- (excludes new items launched at or after campaign start, which would
--  inflate post-period revenue without representing a campaign effect).
create or replace view baseline_items_v as
select
  st.tenant_id,
  st.item_name,
  min(st.occurred_at::date) as first_seen_date
from stg_orderbird_order_items st
group by st.tenant_id, st.item_name
having min(st.occurred_at::date) <
       coalesce(
         (select min(start_date) - interval '7 days' from campaign_calendar c
          where c.tenant_id = st.tenant_id),
         current_date
       );

-- 00XX_kpi_daily_with_comparable_v.sql
-- Adds revenue_comparable_eur alongside revenue_eur:
--   revenue_eur            = total daily revenue (chart headline)
--   revenue_comparable_eur = revenue from items in baseline_items_v only
-- ITS counterfactual fits on revenue_comparable_eur for unbiased uplift.
create or replace view kpi_daily_with_comparable_v as
select
  k.tenant_id,
  k.date,
  k.revenue_eur,
  k.invoice_count,
  coalesce(sum(case when bi.item_name is not null
                    then o.item_gross_amount_eur
                    else 0 end), 0) as revenue_comparable_eur
from kpi_daily_mv k
left join stg_orderbird_order_items o
  on o.tenant_id = k.tenant_id and o.occurred_at::date = k.date
left join baseline_items_v bi
  on bi.tenant_id = o.tenant_id and bi.item_name = o.item_name
group by k.tenant_id, k.date, k.revenue_eur, k.invoice_count;

-- 00XX_forecast_daily.sql (long format, multi-horizon)
create table forecast_daily (
  tenant_id uuid not null references restaurants(id),
  kpi_name text not null,                -- 'revenue_eur', 'invoice_count'
  target_date date not null,
  model_name text not null,              -- 'sarimax', 'prophet', 'chronos', 'naive_dow', 'neuralprophet'
  yhat numeric not null,
  yhat_lower numeric,
  yhat_upper numeric,
  yhat_samples jsonb,                    -- 1000 sample paths for week/month CI aggregation (optional)
  ci_level numeric not null default 0.95,
  run_date date not null,
  horizon_days int generated always as ((target_date - run_date)::int) stored,
  exog_signature jsonb,                  -- which regressors were used
  fitted_at timestamptz not null default now(),
  primary key (tenant_id, kpi_name, target_date, model_name, run_date)
);
alter table forecast_daily enable row level security;
create policy forecast_daily_tenant_read on forecast_daily
  for select using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
create index forecast_daily_horizon_idx on forecast_daily(tenant_id, model_name, horizon_days);

-- 00XX_forecast_quality.sql — backtest results for hover popup
create table forecast_quality (
  tenant_id uuid not null references restaurants(id),
  kpi_name text not null,
  model_name text not null,
  horizon_days int not null,             -- 7, 35, 120, 365
  fold_count int not null,
  rmse numeric not null,
  mape numeric not null,
  smape numeric,
  evaluated_at timestamptz not null default now(),
  is_uncalibrated boolean not null default false,
  primary key (tenant_id, kpi_name, model_name, horizon_days, evaluated_at)
);
alter table forecast_quality enable row level security;
create policy forecast_quality_tenant_read on forecast_quality
  for select using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- 00XX_campaign_calendar.sql — source of truth for campaign on/off windows
create table campaign_calendar (
  campaign_id text primary key,
  tenant_id uuid not null references restaurants(id),
  start_date date not null,              -- typically Thursday
  end_date date not null,                -- typically next Wednesday
  campaign_type text,                    -- 'standard', 'off-week', 'high-spend', etc.
  spend_eur numeric,
  channel text,                          -- 'email', 'instagram', 'flyer', etc.
  notes text
);
alter table campaign_calendar enable row level security;
create policy campaign_calendar_tenant on campaign_calendar
  for select using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- 00XX_campaign_uplift_v.sql — cumulative actual vs forecast per campaign per model
create or replace view campaign_uplift_v as
select
  c.tenant_id,
  c.campaign_id,
  c.start_date,
  c.end_date,
  f.model_name,
  sum(k.rev) as actual_eur,
  sum(f.yhat) as forecast_eur,
  sum(k.rev) - sum(f.yhat) as uplift_eur,
  case when sum(f.yhat) > 0 then (sum(k.rev) - sum(f.yhat)) / sum(f.yhat) else null end as uplift_pct
from campaign_calendar c
left join kpi_daily_mv k on k.tenant_id = c.tenant_id
  and k.date between c.start_date and c.end_date
left join forecast_daily f on f.tenant_id = c.tenant_id
  and f.kpi_name = 'revenue_eur'
  and f.target_date between c.start_date and c.end_date
  and f.run_date = c.start_date - interval '1 day'   -- forecast made the night before
group by c.tenant_id, c.campaign_id, c.start_date, c.end_date, f.model_name;
```

---

## §8 GitHub Actions cron pattern (paste into `12-1-02-PLAN.md`)

```yaml
# .github/workflows/external-data-refresh.yml
name: External data refresh
on:
  schedule:
    - cron: '30 2 * * *'   # 02:30 UTC = 03:30/04:30 Berlin (CET/CEST)
  workflow_dispatch:
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -r requirements-extract.txt
      - run: python scripts/external/weather_fetch.py
        env: { SUPABASE_URL: ${{ secrets.SUPABASE_URL }}, SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }} }
      - run: python scripts/external/holidays_seed.py
        env: { ... }
      - run: python scripts/external/transit_alerts_fetch.py
        env: { ... }
      - run: python scripts/external/recurring_events_seed.py
        env: { ... }
```

---

## §9 Verification (Definition of Done — per CLAUDE.md)

Per CLAUDE.md `Final QA & Definition of Done`, every phase ends with **DEV-environment verification**:

| Sub-phase | Verification path |
|---|---|
| 12.1 | DB MCP: `select count(*) from weather_daily where date >= '2025-06-11'` ≥ 320; `select * from holidays where date = '2026-03-08'` returns Frauentag; GH workflow run logs show no `❌` |
| 12.2 | Backtest report committed; CI gate passes; `select * from forecast_daily where target_date = current_date + 1 and model_name='sarimax'` returns row with non-null yhat + CI |
| 12.3 | Chrome MCP: navigate to DEV `/dashboard`, screenshot revenue card with forecast overlay, verify all 3 line styles render, toggle Prophet on/off works, mobile viewport (iPhone SE width 375) renders without overflow |
| 12.4 | DB: `select count(*) from forecast_daily where forecast_track='cf' and run_date = current_date` returns ≥1 row per enabled model; `select * from campaign_uplift_v` returns one row per campaign × model with non-null `uplift_eur` and CI |
| 12.5 | Backtest gate workflow runs weekly; failure mode tested by intentionally regressing model |

---

## §10 Repo placement

This file is at `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` (already in place).

Run `/gsd:new-milestone` with §1 as input. The command will register the milestone in `.planning/STATE.md`, create the rest of the phase scaffolding (`12-CONTEXT.md`, `12-RESEARCH.md`, `12-VALIDATION.md`), and update `.planning/ROADMAP.md`. From there, walk through `/gsd:discuss-phase` for each sub-phase (12.0 → 12.1 → … → 12.5).

---

## §11 What you should explicitly NOT do (the discipline of KISS)

**🚨 Honest framing rule:**
The label "uplift" or "lift" is justified IF AND ONLY IF the Track-B counterfactual is fit on **pre-campaign era data only** (per D-11). With that ITS construction, actual − Track B is a valid causal estimate, with the standard ITS caveats (trend stationarity, no concurrent intervention, regressor sufficiency).

If anyone — Claude Code, the friend, a future maintainer — fits Track B on data that includes any campaign-era day, the resulting metric is **not causal**, and the UI must label it "deviation from forecast" instead. The schema enforces this: `forecast_daily.forecast_track = 'cf'` rows must come exclusively from `counterfactual_fit.py` whose training cutoff is the campaign start date. Document the cutoff in `pipeline_runs.error_msg` (or a dedicated audit column) for every CF refit.

Beyond ~6 months post-launch, the ITS estimate's CI naturally widens; introduce quarterly off-weeks (D-11b) to re-anchor.



- Do **not** add deep-learning forecasters (DeepAR, TFT, N-BEATS, PatchTST) or full MMM in this milestone.
- Do **not** scrape Berlin events live; hand-curated YAML is fine for 1 shop.
- Do **not** build per-customer feature engineering yet.
- Do **not** add yearly seasonality to Prophet (you only have 10 months — it'll fit ghosts).
- Do **not** trust the 365d forecast accuracy until ≥2 years of data — show "uncalibrated" badge in hover popup.
- Do **not** sum Prophet's `yhat_lower`/`yhat_upper` for weekly/monthly CIs. Use sample paths + percentile.
- Do **not** add NeuralProphet to the chart UI by default — feature-flagged backtest only. Promote only if backtest shows it beats SARIMAX+Prophet by ≥5% on the 35d/120d horizons.
- Do **not** ever fit Track B on data that includes a campaign-active day. The honest causal interpretation depends on the pre-campaign cutoff being respected.
- Do **not** model the "Pop up menu" item as a regressor or structural break. Per the friend, popups happen ad-hoc; treat them as noise the model absorbs.
- Do **not** include post-launch new menu items in the ITS uplift estimand. The auto-derived `baseline_items_v` view + `revenue_comparable_eur` KPI handle this — Track B fits on `revenue_comparable_eur`, not raw `revenue_eur`. If anyone shortcuts and uses raw revenue for uplift, the estimate is biased low (post period has menu breadth pre period didn't).
- Do **not** show all 5+ forecast lines on mobile by default — start with 2 (actual + SARIMAX), let user opt in to more.

---

## §12 Open risks

1. **BVG RSS URL not yet verified.** Research-phase task: open the URL, confirm valid RSS, capture sample feed, document if URL pattern differs.
2. **Open-Meteo "non-commercial" clause.** If Ramen BONES is incorporated, switch to Bright Sky pre-prod or buy Open-Meteo's commercial tier (~€10/mo).
3. **ITS validity window.** The pre-campaign-era counterfactual gets less credible as projection horizon grows. Past ~6 months post-launch (~October 2026), the CI on cumulative uplift will widen substantially; introduce quarterly off-weeks (D-11b) or accept the widening.
4. **Hidden concurrent intervention at campaign start.** If anything else changed at the shop on or near 2026-04-14 (menu, pricing, hours, staffing, neighborhood event), the ITS estimate is biased. Office Hours #1 must verify with friend before claiming causality.
5. **Layer A only measures campaigns AFTER 12.2 ships.** The model needs forecasts written with `run_date < campaign_start` to compute deviation. Pre-launch campaigns are not retroactively recoverable without re-running the model with frozen as-of-then parameters.
6. **Closed-day handling in Prophet.** `y=NaN` vs `y=0` — wrong choice biases the seasonal fit. Recommended: `y=NaN` for closed days; the `shop_calendar.is_open` regressor encodes the binary signal.
7. **Mobile chart overflow.** 5+ overlay lines on a 375px iPhone screen will look like spaghetti. Default for mobile = 1 line (actual) + 1 forecast (SARIMAX BAU) + CI band only.
8. **Track-B counterfactual is structurally unverifiable past the cutoff.** No actual exists for "what would revenue have been without the campaign." The pre-campaign cutoff anchors validity; once we leave that anchor, the uncertainty is irreducible. Use `last_7_days` accuracy on Track-A only — Track-B accuracy column should display "unverifiable by construction" in the popup.

---

---

## §13 Two-track forecast architecture (BAU vs Counterfactual)

**Two KPIs per tenant:** `revenue_eur` (raw) and `revenue_comparable_eur` (raw minus revenue from items launched after the campaign start). Both are forecast independently with all the same machinery; the chart's headline KPI is `revenue_eur` (what the friend cares about), the **causal-uplift attribution uses `revenue_comparable_eur`** (apples-to-apples vs pre-period).

Why: the source-data audit (committed at `tools/its_validity_audit.py`) confirmed the friend added 3 new menu items (`Onsen EGG`, `Tantan`, `Hell beer`) coincidentally with the campaign — they are permanent additions, not part of the marketing intervention. Their revenue is genuine but biases the ITS estimate downward (post period has menu breadth pre period didn't). The "Pop up menu" specials, by contrast, are stochastic recurring features (the friend confirmed they appear ad-hoc) — treat as noise, not a regressor.

Auto-derivation rule: any item with `first_seen_date >= campaign_start_date - 7 days` is a "post-launch item" and excluded from `revenue_comparable_eur`. The 7-day buffer absorbs the case where an item's first sale happened in the days right before launch announcement.

Every model produces **two predictions per (target_date, model, horizon)**:

**Track A — Business-As-Usual forecast (`forecast_track = 'bau'`):**
- Fit on ALL historical data, including campaign-active days
- `is_campaign` regressor = actual value (1 if that day had a campaign, 0 otherwise)
- At predict time: future `is_campaign` = 1 if a campaign is scheduled per `campaign_calendar`, else 0
- **Use case:** the chart's headline forecast line. Tells the friend "based on what we know, here's what next week looks like." Shows the campaign effect baked in (because the model learned it).
- **Validation:** §17 last-7-actual-days backtest applies — Track-A accuracy is observable and tracked in the hover popup.

**Track B — Counterfactual forecast (`forecast_track = 'cf'`):**
- Per D-11 (ITS identification): fit on **pre-campaign era data only** (`date < campaign_start_date`, currently 2026-04-14)
- `is_campaign` regressor is NOT used in this fit (all training rows have `is_campaign = 0` by construction)
- Projects forward beyond the cutoff to compute "what would have happened without any campaigns"
- **Use case:** the causal-uplift baseline. actual − Track-B = causal uplift attributable to the campaign era (with ITS validity caveats).
- **Validation:** Track-B accuracy is **structurally unverifiable** past the campaign-start cutoff — there's no actual for "no-campaign world" once campaigns started. The hover popup must display "unverifiable by construction" in the accuracy slot for Track-B lines, NOT a fake RMSE. Track-B uncertainty grows with projection horizon — show CI bands but don't promise calibration.
- **Pre-cutoff sanity check:** in-sample fit RMSE on the pre-campaign data is OK to display as a model-fit-quality indicator (not a forecast accuracy claim).

**Both tracks live in the same `forecast_daily` table** distinguished by `forecast_track` column. They have different training cutoffs (`fit_train_end` audit column on `pipeline_runs`).

**Per-model regressor wiring:**

| Model | Holidays | Weather | is_campaign | School holiday block | Strike day | Recurring event |
|---|---|---|---|---|---|---|
| SARIMAX | exog matrix | exog matrix | exog matrix | exog matrix | exog matrix | exog matrix |
| Prophet | native `holidays` arg | `add_regressor` | `add_regressor` | native `holidays` (custom) | `add_regressor` | native `holidays` (custom) |
| ETS | n/a (no exog support) | n/a | n/a | n/a | n/a | n/a |
| Theta | n/a | n/a | n/a | n/a | n/a | n/a |
| Naive DoW | n/a | n/a | n/a | n/a | n/a | n/a |
| Chronos-2 (covariate variant) | covariate | covariate | covariate | covariate | covariate | covariate |
| NeuralProphet | `add_country_holidays('DE')` | `add_lagged_regressor` or `add_future_regressor` | `add_future_regressor` | `add_country_holidays` custom | `add_future_regressor` | custom |

ETS, Theta, Naive don't support exogenous regressors — they ride along as no-regressor baselines. That's fine; their job is to be the floor.

**Storage:**
```sql
-- forecast_daily becomes:
alter table forecast_daily add column forecast_track text not null default 'bau';
-- primary key now: (tenant, kpi, target_date, model_name, run_date, forecast_track)
```

UI default surfaces `bau` track. Hover popup's "cumulative deviation since campaign launch" uses `cf` track.

---

## §14 Failure modes, freshness SLO, fallback policy

**Pipeline = data → forecast → MV refresh → chart.** Each step can fail. Document and handle.

| Step | Fail mode | Detection | Mitigation | UI signal |
|---|---|---|---|---|
| `weather_fetch.py` | Open-Meteo 5xx, network out | non-zero exit, no rows for `today` | retry 3× with backoff; on final fail, fill from climatological norm (multi-year DoW × month avg); log to `pipeline_runs` | "weather data: stale (last fetched [date])" badge if >36h old |
| `holidays_seed.py` | ferien-api.de down | ditto | python-holidays lib still works offline; fall back to it for federal even though it can't do school holidays | n/a (federal still loads) |
| `transit_alerts_fetch.py` | BVG RSS schema change | XML parse fail | retry; on persistent fail, alert maintainer; absence-of-news ≠ no-strike (assume no strike) | "transit alerts: paused" if 3+ days no fetch |
| `recurring_events_seed.py` | YAML parse error | exception | fail loud, block pipeline | "events: pipeline broken — see CI" |
| `forecast_fit.py:sarimax` | Convergence fail | exception, NaN params | fall back to last successful fit's params + 1 day shift | "SARIMAX forecast: stale (params from [date])" |
| `forecast_fit.py:prophet` | cmdstan compile fail | non-zero exit | drop Prophet from chart for that day; SARIMAX still serves | "Prophet line: unavailable today" |
| MV refresh | refresh times out / locks | pg_cron logs | retry once, alert | "data refresh delayed" |
| API endpoint `/api/forecast` | DB query times out (1s SLO) | response time | serve `last_good_forecast_v` (24h cached) | "forecast snapshot from [time]" |

**Freshness SLO:**
- Data freshness: ≤24 hours stale (last cron run)
- Forecast freshness: ≤24 hours stale (last successful refit)
- UI must show "last refreshed [time]" badge always; turn red after 36h

**`pipeline_runs` audit table:**
```sql
create table pipeline_runs (
  run_id bigserial primary key,
  step_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text,                           -- 'success', 'failed', 'fallback'
  rows_written int,
  commit_sha text,                       -- $GITHUB_SHA from runner
  error_msg text,
  duration_ms int generated always as (extract(epoch from finished_at - started_at)*1000)::int stored
);
```

Every cron script writes one row. Forecast quality dashboard reads it.

---

## §15 Supporting tables (closed-day awareness, audit trail, reminders)

```sql
-- 00XX_shop_calendar.sql — which days the shop is/will be open
-- Required for 365d future forecasts; without it, model predicts revenue for closed days
create table shop_calendar (
  tenant_id uuid not null references restaurants(id),
  date date not null,
  is_open boolean not null,
  hours_open numeric,                    -- typical operating hours that day, optional
  notes text,                            -- 'public holiday closed', 'private event', etc.
  source text not null default 'manual', -- 'manual' | 'derived_from_history'
  primary key (tenant_id, date)
);
alter table shop_calendar enable row level security;
create policy shop_calendar_tenant on shop_calendar
  for select using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Backfill from history: every Wed-Sun before today is_open=true; Mon-Tue depends on regime
-- Future seed: assume same pattern as last 8 weeks (Mon/Tue=open, Wed-Sun=open, public holidays=closed)
-- The friend can manually flip days via admin SQL when she knows she'll be away

-- 00XX_pipeline_runs.sql — see §14
create table pipeline_runs (...);

-- 00XX_recurring_events_reminder_cron.sql — pg_cron job to nag
select cron.schedule(
  'recurring-events-yearly-reminder',
  '0 9 15 9 *',                          -- 09:00 on Sept 15 each year
  $$insert into pipeline_runs(step_name, status, error_msg)
    values ('recurring_events_yaml_reminder', 'reminder',
    'Time to update recurring_events.yaml with next year''s dates')$$
);

-- 00XX_feature_flags.sql — controls Chronos / NeuralProphet / etc
-- Two-layer mechanism:
--   1. Env var on GHA workflow: FORECAST_ENABLED_MODELS=sarimax,prophet,naive_dow
--      (default; gates which scripts run nightly)
--   2. Per-tenant overrides in this table
--      (e.g., enable Chronos for a power-user tenant only)
create table feature_flags (
  tenant_id uuid not null references restaurants(id),
  flag_key text not null,                -- 'forecast.chronos.enabled', 'forecast.neuralprophet.enabled'
  flag_value text not null,              -- 'true' | 'false' | numeric | json string
  updated_at timestamptz not null default now(),
  primary key (tenant_id, flag_key)
);
alter table feature_flags enable row level security;
create policy feature_flags_tenant on feature_flags
  for select using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Default for v1.3: env var only (no per-tenant overrides yet)
-- Add row to feature_flags only when a tenant requests an override

-- 00XX_campaign_active_v.sql — helper view: is a campaign running today?
-- Used by the dashboard "campaign banner" + by the Track-A predict step
create or replace view campaign_active_v as
select
  c.tenant_id,
  d::date as date,
  bool_or(c.start_date <= d::date and c.end_date >= d::date) as is_campaign_active,
  array_agg(c.campaign_id) filter (where c.start_date <= d::date and c.end_date >= d::date) as active_campaign_ids
from generate_series(
  current_date - interval '365 days',
  current_date + interval '365 days',
  interval '1 day'
) d
left join campaign_calendar c on c.tenant_id is not null
group by c.tenant_id, d::date;
```

---

## §16 Backtest gate — fair comparison rules

A naive same-DoW-mean is hard to beat without regressors, so the gate must compare like-with-like:

**Gate timing:** Phase 12.5 only. Phases 12.2 ship models WITHOUT a gate (exploratory). The gate goes live AFTER Phase 12.1 ships regressors.

**Gate definition:**
```
For each model M and horizon H ∈ {7d, 35d}:
  fair_rmse(M, H) = rolling-origin CV RMSE
                    with M fit on [train data including all available regressors]
  fair_rmse(naive, H) = rolling-origin CV RMSE of naive same-DoW-mean
                    (which has no regressors, that's the floor)
  gate_passes(M, H) = fair_rmse(M, H) <= 0.90 * fair_rmse(naive, H)

Production deployment requires gate_passes for at least one of:
  - revenue_eur @ 7d horizon
  - invoice_count @ 7d horizon

Long horizons (120d, 365d) are NOT gated — they ship in "exploratory" status with
"BACKTEST PENDING" or "UNCALIBRATED" badges in the UI.
```

**CV protocol:** rolling origin, 7-day-ahead refits, 12 folds (12 weeks of out-of-sample evaluation).

**Why 7d and 35d only:** at 120d and 365d, you don't have enough out-of-sample folds to compute a stable RMSE. Until ≥2 years of data, those horizons are exploratory by necessity.

**Implementation:**
```python
# scripts/forecast/backtest.py
HORIZONS = [7, 35]                  # gated
EXPLORATORY = [120, 365]            # ungated, badged in UI
FOLDS = 12
TRAIN_MIN_DAYS = 90                 # don't backtest with <3 months data
```

---

## §17 Hover-popup accuracy — last 7 actual days, every night

This is THE accuracy number the friend sees when she hovers a forecast line. It is **NOT** the 12-fold rolling-origin RMSE from §16 (that's for the production gate). The hover popup answers "**how did each model do over the last 7 days that have actuals?**" — a much more concrete, recent, scrollable signal.

**Mechanic (per model M, KPI K, every night):**

1. Let `T = max(date) from kpi_daily_mv` (the latest day we have actuals for — usually yesterday or today depending on extractor timing).
2. The 7 evaluation days are `T-6, T-5, T-4, T-3, T-2, T-1, T`.
3. For each evaluation day `d` in that window:
   - Refit M on data through `d - 1` only (no leakage)
   - Predict day `d` with that fit
   - Store the prediction in `forecast_daily` with `run_date = d - 1`, `target_date = d`, `model_name = M`, `forecast_track = 'bau'`
4. Compute per-model error metrics over those 7 (model-prediction, actual) pairs:
   - `RMSE_7 = sqrt(mean((yhat - actual)^2))`
   - `MAPE_7 = mean(abs((yhat - actual) / actual)) * 100`
   - `bias_7 = mean(yhat - actual)` (so we can label "model tends to over/under-forecast €X")
   - `direction_hit_rate_7 = fraction of days yhat moved same direction as actual day-over-day`
5. Persist into a small per-model row in `forecast_quality`:
   - `(tenant_id, kpi_name, model_name, evaluation_window='last_7_days', evaluated_at=now(), n_days=7, rmse=RMSE_7, mape=MAPE_7, bias=bias_7, direction_hit_rate=direction_hit_rate_7)`

**The hover popup reads this row directly.** Display:

```
┌─ SARIMAX ────────────────────────────────────┐
│ Forecast for Tue 2026-05-12: €842            │
│   95% CI: €712 — €972                        │
│   Horizon: +14 days from today               │
│ ─────────────────────────────────────────    │
│ ACCURACY OVER LAST 7 ACTUAL DAYS             │
│   2026-04-16..04-22 (the freshest evidence)  │
│   RMSE   €148                                │
│   MAPE   18%                                 │
│   Bias   +€42 (slightly over-forecasts)      │
│   Direction hit-rate  6/7 days same as actual│
│ ─────────────────────────────────────────    │
│ Cum. deviation since campaign launch         │
│   actual − counterfactual (Track B)          │
│   = +€420 (95% CI -€180 to +€1,020)          │
│ ─────────────────────────────────────────    │
│ Last refit: 2026-04-26 03:01 UTC             │
└──────────────────────────────────────────────┘
```

**Why last 7 actual days, not last 7 calendar days:**
- Some calendar days have no actual (shop closed) → can't compute error
- "Actual days" auto-restricts to operating days, no special-case logic in UI

**Why this is in addition to §16's 12-fold gate:**
- §16's gate is for go/no-go production deployment (statistical robustness)
- §17's last-7 metric is for the friend's daily intuition (recency, freshness)
- They will sometimes disagree (e.g., gate says SARIMAX passes long-run, last-7 shows SARIMAX badly missed last week's anomaly) — that disagreement is itself informative; show both

**Cost:**
- 7 extra fits per model per night
- For SARIMAX/ETS/Theta/Naive: ~5s × 7 × 5 models = 3 minutes total compute
- For Prophet (no MCMC): ~3s × 7 = 20s
- For Prophet (mcmc=300): ~30s × 7 = 4 minutes — only run last-7 with mcmc disabled, accept Gaussian CIs for the per-day predictions
- For Chronos zero-shot: ~1s × 7 = 7s
- For NeuralProphet: ~10s × 7 = 70s
- Total nightly extra: under 10 minutes, well within free GHA tier

**Bootstrap on day 1 (cold start):**
- Pipeline must populate the last 7 evaluation rows immediately on first deploy, or the UI shows "BACKTEST PENDING — gathering 7 days of evidence" for up to a week
- Acceptable cold-start UX; no change needed

**Subsequent days, "rolling-7":**
- Each night the window slides forward by 1: drop the oldest day, add yesterday
- The trailing-7 metric is always "freshness ≤ 24h"
- Users intuitively understand "how did this model do this past week?" — that's the contract

**Implementation skeleton:**
```python
# scripts/forecast/last_7_eval.py — runs after fit_all.py each night
EVAL_DAYS = 7
T = get_max_actual_date(supabase)  # T = current_date OR current_date - 1
for d in (T - timedelta(days=k) for k in range(EVAL_DAYS - 1, -1, -1)):
    history = get_history(supabase, end_date=d - timedelta(days=1))
    actual = get_actual(supabase, date=d)
    for model_name, model_fn in MODELS.items():
        yhat, yhat_lo, yhat_hi = model_fn(history, target_date=d)
        upsert_forecast(
            tenant_id, kpi_name, target_date=d, run_date=d - timedelta(days=1),
            model_name=model_name, forecast_track="bau",
            yhat=yhat, yhat_lower=yhat_lo, yhat_upper=yhat_hi,
        )
# Then compute window-level metrics:
for model_name in MODELS:
    yhats, actuals = fetch_window(model_name, window=EVAL_DAYS)
    rmse = math.sqrt(((yhats - actuals) ** 2).mean())
    mape = (abs((yhats - actuals) / actuals) * 100).mean()
    bias = (yhats - actuals).mean()
    upsert_forecast_quality(
        model_name=model_name, evaluation_window="last_7_days",
        n_days=EVAL_DAYS, rmse=rmse, mape=mape, bias=bias,
    )
```

**Schema delta:** add a column `evaluation_window text` to `forecast_quality`:
```sql
alter table forecast_quality add column evaluation_window text not null default 'rolling_origin_cv';
-- values: 'rolling_origin_cv' (12-fold from §16) | 'last_7_days' (this section)
-- primary key now includes evaluation_window
```

**The hover popup's accuracy row queries:**
```sql
select rmse, mape, bias, direction_hit_rate, n_days
from forecast_quality
where tenant_id = $1
  and kpi_name = $2
  and model_name = $3
  and evaluation_window = 'last_7_days'
order by evaluated_at desc
limit 1;
```

That's the contract. One row per model per KPI per tenant, refreshed nightly, read by the chart.

---

## §18 Per-model uplift CI sampling spec

The "Monte Carlo 1000 sample paths" claim needs concrete implementation per model.

| Model | Sampling mechanism | Notes |
|---|---|---|
| SARIMAX | `results.simulate(nsimulations=H, repetitions=1000)` | Native; samples from posterior of state distribution. Run once per night, store sample matrix to `forecast_daily.yhat_samples` (jsonb). |
| Prophet | `Prophet(mcmc_samples=300).predictive_samples(future)` | Slow (~30s on 10mo data) but gives true posterior. If too slow, fall back to `interval_width` Gaussian approx and document the loss of calibration. |
| ETS | `ETSResults.simulate(nsimulations=H, repetitions=1000)` | Same as SARIMAX. |
| Theta | Bootstrap residuals from training fit | Theta has no native sampler. Bootstrap method: resample training residuals, add to point forecast, repeat 1000×. |
| Naive DoW | Bootstrap from same-DoW pre-history | Sample with replacement from last 8 same-DoW residuals; add to DoW mean; repeat 1000×. |
| Chronos-Bolt | Native quantile output (5-95% quantiles) | Different mechanism — direct quantile prediction, not samples. Use the 1000 quantile interpolations as "samples" for aggregation purposes. |
| NeuralProphet | `m.predict(quantiles=[0.025, 0.5, 0.975])` | Quantile output; same handling as Chronos. Native sampling requires `n_lags > 0`. |

**Aggregation for week/month windows:**
```python
# For each model, sum 1000 daily samples over the window:
weekly_uplift_samples = (actual_sum - sample_paths.sum(axis=0))  # shape (1000,)
ci_low, ci_high = np.percentile(weekly_uplift_samples, [2.5, 97.5])
```

Storage: `forecast_daily.yhat_samples` is jsonb with the 1000 samples. JSON column adds ~50KB per row × 365 days × 7 models = ~125MB total. OK for V1; revisit at scale (move to Parquet column or Supabase storage).

---

## §19 Per-phase literal acceptance tests

Each sub-phase ships only when these queries return the expected result. Paste into `12-X-VALIDATION.md`.

### Phase 12.0 — Foundation
```bash
test -f .planning/phases/12-forecasting-foundation/12-0-CONTEXT.md
grep -c "D-01" .planning/phases/12-forecasting-foundation/12-0-CONTEXT.md  # expect ≥1
```

### Phase 12.1 — Ingestion
```sql
-- Weather backfill present
select count(*) from weather_daily where date between '2025-06-11' and current_date - 1;
-- expect: ≥320 (≥day count between June 2025 and now)

-- Forecasts present for next 7 days
select count(*) from weather_daily where is_forecast = true and date > current_date;
-- expect: ≥7

-- Holidays for 2026 loaded
select count(*) from holidays where extract(year from date) = 2026;
-- expect: 10 (9 federal + Frauentag for Berlin)

-- School holidays loaded
select count(*) from school_holidays where state_code = 'BE' and start_date >= '2026-01-01';
-- expect: 5-6 (Winter, Oster, Pfingst, Sommer, Herbst, Weihnachts)

-- pipeline_runs has yesterday's runs
select count(*) from pipeline_runs where started_at >= current_date - 1 and status = 'success';
-- expect: ≥4 (one per script)
```

### Phase 12.2 — Forecasting engine
```sql
-- Each enabled model wrote BAU + CF forecasts for tomorrow
select model_name, forecast_track, count(*)
from forecast_daily
where target_date = current_date + 1 and run_date = current_date
group by model_name, forecast_track;
-- expect: each (model, 'bau') and (model, 'cf') has 1 row

-- 365d horizon present
select model_name, max(target_date - run_date) as max_horizon
from forecast_daily
where run_date = current_date
group by model_name;
-- expect: max_horizon = 365 for sarimax, prophet at minimum

-- Backtest results populated
select model_name, horizon_days, rmse from forecast_quality
where evaluated_at >= current_date - 7;
-- expect: rows for (sarimax, 7), (sarimax, 35) with rmse > 0
```

### Phase 12.3 — Chart UI
```
# Chrome MCP DEV check
1. navigate https://dev.ramenbones.app/dashboard
2. screenshot — RevenueForecastCard renders with 2 lines (actual + sarimax_bau) by default
3. click ForecastLegend Prophet toggle — Prophet dashed line appears
4. click HorizonToggle "5w" — X-axis re-zooms to today + 35 days
5. hover any forecast point — popup appears with 6 fields including "cum deviation since campaign launch"
6. mobile (iPhone SE 375w): only 1 line shown by default + CI band; legend collapses to bottom-sheet on tap
```

### Phase 12.4 — Uplift attribution (ITS counterfactual)
```sql
-- Campaign calendar populated
select count(*) from campaign_calendar where tenant_id = '<friend-tenant-id>';
-- expect: ≥1

-- Deviation computed for first campaign
select campaign_id, model_name, actual_eur, forecast_eur, uplift_eur
from campaign_uplift_v
where campaign_id = (select campaign_id from campaign_calendar order by start_date limit 1);
-- expect: row per (campaign_id, model_name); actual_eur and forecast_eur both non-null
```

### Phase 12.5 — Backtest gate
```bash
# Gate workflow runs and reports
gh run list --workflow=forecast-quality-gate.yml --limit 1 --json conclusion --jq '.[0].conclusion'
# expect: "success" (or "failure" with a clear blocking reason)
```

---

## §20 Timezone, dates, money — the discipline rules

These get one place in the proposal because they bite everywhere:

1. **All dates stored as `DATE` (not TIMESTAMPTZ).** Timestamps go in `*_at` columns with `timestamptz`.
2. **All "what day was this" logic uses Europe/Berlin civil date.** Conversion happens once at the data boundary (extractor / fetcher), never in queries.
3. **Cron runs UTC. `02:30 UTC` = `04:30 CEST` = `03:30 CET`.** Berlin is always 1-2 hours ahead of UTC; never do "shop opens at 18:00" logic in UTC.
4. **All EUR amounts in `numeric(12, 2)`.** Never `float`. Never store as cents-as-int unless aligning with an external API.
5. **One source of truth for "today":** the existing `kpi_daily_mv` defines the latest available date. Forecast pipeline's `run_date` should always equal `(select max(date) from kpi_daily_mv) + 1` or fail.

---

## §21 Operating discipline

**Annual-events YAML reminder:**
- pg_cron fires Sept 15 each year, inserts a "reminder" row into `pipeline_runs`
- Dashboard surface displays the reminder for the analyst (Shinno) to act on
- Editing the YAML + re-running `recurring_events_seed.py` is the maintenance task

**Campaign calendar entry:**
- For V1: friend tells Shinno about each upcoming campaign; Shinno inserts a row via Supabase Studio SQL editor
- Phase 12.4-00 plan: scaffold a 1-page Svelte form `CampaignAdminForm.svelte` for admin role to insert/edit campaigns directly — can defer to v1.4 if time-pressed
- Without campaign_calendar populated, the BAU forecast track defaults `is_campaign = 0` for all future days (graceful degrade)

**Cost ceiling watch:**
- At 1 tenant: $0/month, no concerns
- At 50 tenants: ~50 fits/night × ~10s each = 8 minutes GHA compute, well within free tier
- At 100+ tenants: re-evaluate; Open-Meteo free tier may need commercial; Supabase MV refresh may need optimization
- Decision tripwire: when GHA monthly minutes pass 1500/month, escalate to office hours

---

## §22 Default UI defaults — KISS at the chart level

For the friend on her phone opening the dashboard:
- **Default chart:** actual revenue line + SARIMAX BAU forecast + 95% CI band. Nothing else.
- **Default horizon:** 7d.
- **Default KPI:** revenue.
- **Hover:** popup with the 6 fields from §2 12.3.
- **Default markers:** campaign start days only. Holidays, school breaks, events, strikes are off by default — toggleable in legend.
- **Mobile (≤640px):** even tighter — actual + sarimax_bau combined into one CI-shaded curve, legend collapsed into bottom-sheet, tap-to-pin.
- **Power user toggles:**
  - Add second/third forecast model (Prophet, Chronos, etc.)
  - Switch horizon (5w/4mo/1yr)
  - Show counterfactual track (Track B) overlaid as dashed
  - Show event markers (any subset)
  - Switch KPI (revenue → invoices)

This list is the spec — Phase 12.3 plans must adhere to it.

---

**End of proposal.**
