# Phase 14: Forecasting Engine — BAU Track - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-29, updated 2026-04-30
**Phase:** 14-forecasting-engine-bau-track
**Areas discussed:** Closed-day handling, Sample-path storage + TTL, Weather regressor fallback, Feature flag mechanism, MV refresh trigger, forecast_quality schema, Sample-path generation, Exog assembly module

---

## Closed-Day Handling

### Q1: How should forecast models treat days the restaurant is closed?

| Option | Description | Selected |
|--------|-------------|----------|
| y=NaN + is_open regressor | Closed days = NaN in target series. is_open binary regressor on exog-capable models. yhat forced to 0 post-hoc for closed days. Cleanest seasonal fit. | ✓ |
| y=0 + is_open regressor | Closed days = 0 revenue. Simpler but zeros pull seasonal averages down for ETS/Theta/Naive. | |
| Drop closed days entirely | Remove closed-day rows. Breaks SARIMAX seasonal(7) weekday alignment. | |

**User's choice:** y=NaN + is_open regressor
**Notes:** None

### Q2: Regime shift (Mon/Tue closures → open) — structural break or natural regressor?

| Option | Description | Selected |
|--------|-------------|----------|
| is_open handles it | No special treatment. is_open regressor flips from false to true. Model adapts naturally. | ✓ |
| Explicit Prophet changepoints | Manual changepoints at [2026-02-03, 2026-03-02]. More explicit but hardcodes dates. | |

**User's choice:** is_open handles it
**Notes:** None

### Q3: No-exog models (ETS, Theta, Naive) — how to handle closed days?

| Option | Description | Selected |
|--------|-------------|----------|
| Filter to open days only | Train on open-day-only series. NaN rows dropped, contiguous index reset. Map predictions back to calendar dates via shop_calendar. | ✓ |
| y=0 for no-exog models only | Keep zero-revenue rows. Models learn "some days are zero" pattern. | |

**User's choice:** Filter to open days only
**Notes:** None

---

## Sample-Path Storage + TTL

### Q1: Retention policy for yhat_samples (~125 MB/year/tenant at 1000 paths)?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep latest run only | forecast_daily_mv has current samples. Historical rows keep yhat/CI but yhat_samples NULLed. Weekly pg_cron janitor. ~95% storage savings. | ✓ |
| Rolling 7-day retention | Keep 7 days of samples. ~875 MB steady state — exceeds 500 MB free tier. | |
| No samples — parametric CI only | Skip yhat_samples entirely. Violates PROPOSAL §11 "no summing daily CIs" rule. | |

**User's choice:** Keep latest run only
**Notes:** None

### Q2: How many sample paths per forecast row?

User asked for clarification: "what is path in this context?" — explained that a sample path is one simulated future revenue trajectory (365 daily values drawn from the model's probability distribution), used to compute correct multi-day CI aggregation via percentiles of summed paths.

| Option | Description | Selected |
|--------|-------------|----------|
| 200 paths | Statistically sufficient (±0.7% relative error on 95% CI). ~25 MB per run. Leaves 90%+ of free tier. | ✓ |
| 500 paths | Middle ground. ~62 MB per run. | |
| 1000 paths | Maximum precision. ~125 MB per run. Tight on free tier. | |

**User's choice:** 200 paths
**Notes:** User wanted to understand what "paths" meant before deciding. After explanation, chose 200.

---

## Weather Regressor Fallback

### Q1: What fills weather exog columns for days 17-365 (beyond forecast window)?

| Option | Description | Selected |
|--------|-------------|----------|
| Climatological norms | Multi-year per-day-of-year averages from DWD historical data via Bright Sky. Standard in forecasting literature. | ✓ |
| Last-known actuals repeated | Repeat most recent actual weather. Simple but wrong (January cold filling June predictions). | |
| Zeros / NULLs beyond horizon | Effectively disables weather signal for long horizons. | |

**User's choice:** Climatological norms
**Notes:** None

### Q2: Where should climatological norms come from?

| Option | Description | Selected |
|--------|-------------|----------|
| Backfill 3-5 years via Bright Sky | One-time backfill of Berlin weather from 2021-01-01. Compute per-DoY norms from 4-5 years. ~1,600 rows, trivial storage. | ✓ |
| Use the 10 months we have | Norms from only 2025-06-11 to present. Each DoY has only 1 data point. Noisy. | |
| Open-Meteo climate API | Dedicated normals endpoint but non-commercial tier gray zone. | |

**User's choice:** Backfill 3-5 years via Bright Sky
**Notes:** None

### Q3: 3-tier cascade or single source at predict time?

| Option | Description | Selected |
|--------|-------------|----------|
| 3-tier cascade | Actual → Bright Sky forecast → climatology. exog_signature logs source per row. Most accurate per-horizon. | ✓ |
| Always climatology for predict | Use norms for ALL 365 future days. Simpler but wastes short-range forecast signal. | |

**User's choice:** 3-tier cascade
**Notes:** None

---

## Feature Flag Mechanism

### Q1: Where should Chronos/NeuralProphet feature flags live?

| Option | Description | Selected |
|--------|-------------|----------|
| Env var only | FORECAST_ENABLED_MODELS on GHA workflow. Adding a model = one workflow file edit. No DB table. Simplest for 1 tenant. | ✓ |
| Env var + feature_flags table | GHA env var + DB table for SvelteKit reads + per-tenant overrides. More complex. | |
| DB table only | Single source. GHA reads via Supabase API. Adds network dependency to forecast cron. | |

**User's choice:** Env var only
**Notes:** None

### Q2: Should Phase 14 create a feature_flags skeleton table?

| Option | Description | Selected |
|--------|-------------|----------|
| Defer to Phase 17 | Phase 14 doesn't need DB table. Phase 17 creates it for the promotion gate. Matches Phase 12→13 pull-forward pattern. | ✓ |
| Create skeleton now | Ship minimal table for Phase 15 UI to read. | |
| You decide | Claude's discretion. | |

**User's choice:** Defer to Phase 17
**Notes:** None

---

---

## MV Refresh Trigger (2026-04-30)

### Q1: How should forecast_daily_mv be refreshed after nightly model fits?

| Option | Description | Selected |
|--------|-------------|----------|
| Separate RPC | New refresh_forecast_mvs() for forecast_daily_mv only. Called from forecast-refresh.yml via PostgREST RPC. Clean separation of cadences. | ✓ |
| Extend existing RPC | Add forecast_daily_mv to refresh_analytics_mvs(). Simpler but cross-triggers. | |
| Re-register pg_cron | Re-create daily cron at 03:00 UTC. Goes against 0040 pattern. | |

**User's choice:** Separate RPC
**Notes:** User first explained their data workflow — CSV data arrives weekly on Mondays. Forecasts need to be fresh right after Monday upload, not 11h later at nightly cron. This led to the dual-trigger decision below.

### Q2: Should forecasts also trigger immediately after CSV ingest on Mondays?

| Option | Description | Selected |
|--------|-------------|----------|
| Ingest-triggered too | After CSV upload, ingest triggers forecast-refresh via workflow_dispatch. Fresh forecasts within ~10 min. Nightly cron covers weather-driven updates. | ✓ |
| Nightly only | 01:00 UTC nightly cron. ~11h lag on the day that matters most. | |
| You decide | Claude picks based on constraints. | |

**User's choice:** Ingest-triggered too
**Notes:** Monday is when the owner acts on forecasts. 11h lag is unacceptable for the primary use case.

### Q3: Separate refresh_forecast_mvs() or extend existing refresh_analytics_mvs()?

| Option | Description | Selected |
|--------|-------------|----------|
| Separate RPC | Each workflow refreshes only what it wrote. Clean separation. | ✓ |
| Extend existing | Same function, simpler. But cross-triggers unnecessarily. | |

**User's choice:** Separate RPC
**Notes:** None

---

## forecast_quality Schema (2026-04-30)

### Q1: Which metrics should last_7_eval.py compute?

| Option | Description | Selected |
|--------|-------------|----------|
| Full set | RMSE, MAPE, mean_bias, direction_hit_rate. All 4 cheap to compute; Phase 15 hover popup needs them. | ✓ |
| RMSE + MAPE only | Simpler schema. Risk: Phase 15 would show fewer metrics. | |
| You decide | Claude picks the set satisfying Phase 15 contract. | |

**User's choice:** Full set
**Notes:** None

### Q2: Should PK include evaluation_window for Phase 17 future-proofing?

| Option | Description | Selected |
|--------|-------------|----------|
| Add evaluation_window | PK includes discriminator. Phase 14 writes 'last_7_days', Phase 17 adds 'rolling_origin_cv'. No ALTER. | ✓ |
| Separate tables later | Phase 14 without discriminator, Phase 17 creates a second table. | |

**User's choice:** Add evaluation_window
**Notes:** None

---

## Sample-Path Generation (2026-04-30)

### Q1: How should paths be generated for ETS/Theta/Naive (no native simulation)?

| Option | Description | Selected |
|--------|-------------|----------|
| Bootstrap residuals | Fit → compute residuals → sample with replacement → add to point forecast. Standard practice. | ✓ |
| Parametric from sigma | N(yhat, σ²). Assumes normality. Underestimates tail risk. | |
| You decide | Claude picks per-model. | |

**User's choice:** Bootstrap residuals
**Notes:** None

### Q2: SARIMAX/Prophet — use native simulation or bootstrap for consistency?

| Option | Description | Selected |
|--------|-------------|----------|
| Native where available | SARIMAX model.simulate(), Prophet uncertainty_samples. Captures model-specific uncertainty. Best quality. | ✓ |
| Bootstrap for all | Uniform method. Easier to test but throws away richer uncertainty info. | |
| You decide | Claude picks. | |

**User's choice:** Native where available
**Notes:** None

---

## Exog Assembly Module (2026-04-30)

### Q1: Shared exog module or per-model assembly?

| Option | Description | Selected |
|--------|-------------|----------|
| Shared module | scripts/forecast/exog.py with build_exog_matrix(). Single source of truth. | ✓ |
| Per-model assembly | Each model builds its own matrix. More flexible but duplicates DB queries. | |
| You decide | Claude picks. | |

**User's choice:** Shared module
**Notes:** None

### Q2: Weather cascade handled internally or by caller?

| Option | Description | Selected |
|--------|-------------|----------|
| Internal blending | build_exog_matrix() checks each date for actual/forecast/climatology. Caller passes date range only. exog_signature logs source per-date. | ✓ |
| Caller specifies | Caller passes mode per segment. More explicit but pushes cascade logic everywhere. | |
| You decide | Claude picks. | |

**User's choice:** Internal blending
**Notes:** None

---

## Claude's Discretion

- Python project structure under `scripts/forecast/`
- Migration numbering (continues after 0049)
- `weather_climatology` storage approach (lookup table vs inline SQL)
- SARIMAX order tuning
- Prophet prior scale values
- Per-model error handling pattern
- Exact exog.py column names beyond core set

## Deferred Ideas

None — discussion stayed within phase scope.
