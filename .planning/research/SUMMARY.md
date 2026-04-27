# Research Summary — v1.3 External Data & Forecasting Foundation

**Project:** Ramen Bones Analytics
**Milestone:** v1.3 — External Data & Forecasting Foundation
**Synthesized:** 2026-04-27
**Confidence:** HIGH (4 research docs converged with zero strategic divergence)

**Sources:**
- `.planning/research/STACK.md`
- `.planning/research/FEATURES.md`
- `.planning/research/ARCHITECTURE.md`
- `.planning/research/PITFALLS.md`
- `.planning/PROJECT.md`
- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` (1484-line driving proposal)

---

## Convergence Findings

All four research files independently surfaced the same five design-time-preventable risks plus the same MVP scope-cut order with zero strategic divergence.

1. **Sample-path resampling is mandatory** — STACK + ARCHITECTURE Pattern 6 + FEATURES TS-12/D-17 + PITFALLS Anti-Pattern #2. Summing `yhat_lower`/`yhat_upper` for week/month CI is wrong. 1000 paths in `yhat_samples jsonb` server-side; client only ever sees aggregated mean+CI.
2. **Mobile chart spaghetti is the #1 UX risk** — STACK + ARCHITECTURE Anti-Pattern #7 + FEATURES AF-9 + PITFALLS #9. Default = actual + SARIMAX BAU + CI band only; everything else opt-in.
3. **Track-B contamination collapses the entire causal claim** — FEATURES TS-14/AF-20 + ARCHITECTURE Anti-Pattern #4 + PITFALLS #3/#4/#10. `pipeline_runs.fit_train_end` audit + `revenue_comparable_eur` derivation + `naive_dow_uplift_eur` cross-check.
4. **Two-track architecture in one table via `forecast_track` discriminator** — proposal §13 + ARCHITECTURE Pattern 3 + FEATURES D-2/D-9. One MV refresh, one wrapper view, one orchestrator serves both.
5. **External-data → forecast-Python → forecast-MV → analytics-MV strict serial DAG** — ARCHITECTURE Pattern 4 + STACK GHA pattern + PITFALLS #5.

---

## Critical Design-Time-Preventable Pitfalls

These five MUST be addressed before any code lands. Runtime mitigation is too late.

### 1. Prophet `yearly_seasonality='auto'` auto-flip at 2026-06-11

When `len(history) >= 365`, Prophet silently enables yearly Fourier terms — fitting ghost cycles on a single annual observation.

- **Detection:** Unit test `assert prophet.fit(...).yearly_seasonality is False` until 2027-06-11
- **Prevention:** Hard-code `Prophet(yearly_seasonality=False)` until `len(history) >= 730`
- **Phase:** 12.2 (`prophet_fit.py`)

### 2. JWT claim rename `tenant_id` → `restaurant_id`

Proposal §7 sketches use `tenant_id`; codebase column AND JWT claim are `restaurant_id` (verified migrations 0010, 0012, 0023). RLS fails open if missed.

- **Detection:** CI grep guard for `auth.jwt()->>'tenant_id'` in `supabase/migrations/`
- **Prevention:** Mechanical rename of every §7 SQL sketch before pasting
- **Phase:** 12.0 (CI guard) + 12.1 (first migrations to apply rename)

### 3. DST bug in proposed cron schedule

Proposal "external-data 02:30 UTC + forecast 03:00 Berlin" works summer (CEST = UTC+2) but inverts winter (CET = UTC+1, forecast at 02:00 UTC runs BEFORE external at 02:30 UTC).

- **Detection:** Schedule audit during 12.0 office hours
- **Prevention:** Anchor both crons in UTC with 60-min gap (`00:00 UTC external` → `01:00 UTC forecast` → `03:00 UTC MV refresh`). DST-safe by construction.
- **Phase:** 12.0 (decision) + 12.1 (workflow files)

### 4. Open-Meteo "non-commercial" ToS gray zone

For-profit restaurant on a self-hosted dashboard sits in the gray zone. Verified directly with Open-Meteo terms 2026-04-27.

- **Detection:** ToS audit + weekly Bright Sky CI path test
- **Prevention:** `WEATHER_PROVIDER=brightsky` (DWD public-domain) for production; Open-Meteo is local-dev-only. Cost of switching = one env var.
- **Phase:** 12.1 (`weather_fetch.py` provider abstraction)

### 5. Track-B trend extrapolation in declining pre-period

Pre-period revenue declined 10 months → SARIMAX projects continued decline → flat post-period reads as positive lift even with €0 campaign effect.

- **Detection:** `naive_dow_uplift_eur` cross-check column in `campaign_uplift_v`; sensitivity analysis at multiple cutoff dates
- **Prevention:** Track-B cutoff defaults to `campaign_start_date - 7 days` (anticipation buffer); honest CI-overlaps-zero labeling on UpliftCard
- **Phase:** 12.4 (`counterfactual_fit.py` + `campaign_uplift_v`)

---

## Critical-Path Features (non-skippable)

Per FEATURES feature-dependency graph: **TS-9 → TS-10 → D-15 → TS-14 → TS-11 → D-6**.

- **TS-9:** External data ingest (weather/holidays/events in DB)
- **TS-10:** Campaign calendar table populated
- **D-15:** `revenue_comparable_eur` auto-deconfounded for ITS
- **TS-14:** Track-B cutoff discipline (`pipeline_runs.fit_train_end` audit)
- **TS-11:** Cumulative uplift (`actual − Track-B` per campaign window)
- **D-6:** `CampaignUpliftCard` answering "did it work?" as a single number

Skip any node and the friend's question becomes either wrong (skip TS-14, D-15) or unanswerable (skip TS-10, TS-11).

---

## Recommended Roadmap — 6 Sub-Phases (12.0 → 12.5)

The proposal §2, ARCHITECTURE build-order, and FEATURES MVP-recommendation all converge on the same 6-phase structure.

| Phase | Scope | Key deliverables | Risks prevented |
|---|---|---|---|
| **12.0 Foundation** | Discuss-phase + commit `tools/its_validity_audit.py`. Lock 5 office-hours decisions. | `12-0-CONTEXT.md`; ITS audit script; CI grep guard for `tenant_id` | Pitfall #4 (audit must exist before any uplift fit); JWT claim rename |
| **12.1 External Data Ingestion** | Migrations 0039–0046 (5 shared tables + `pipeline_runs` + `shop_calendar`); 5 fetchers; `external-data-refresh.yml`; backfill from 2025-06-11 | weather/holidays/school/transit/events tables; `pipeline_runs`; `shop_calendar` | Open-Meteo ToS (Bright Sky default); DST cron drift; `ferien-api` abandonment; BVG RSS URL drift |
| **12.2 Forecasting Engine — BAU** | Migrations 0047–0055 (`campaign_calendar` + `forecast_daily` + MV + wrapper view + `forecast_quality`); SARIMAX/ETS/Theta/Naive + Prophet (yearly=False); `forecast-refresh.yml`; `last_7_eval.py` | BAU forecasts writing nightly; long-format with `forecast_track='bau'` | Pitfall #1 (yearly auto-flip); exog leakage; closed-day NaN/zero; stale-weather check; CI summing |
| **12.3 Forecast Chart UI — BAU only** *(parallel-eligible with 12.2 after schema lands)* | 5 components + `/api/forecast` + `/api/forecast-quality`; mobile QA at 375px | `RevenueForecastCard` + `ForecastLegend` + `ForecastHoverPopup` + `HorizonToggle` + `GranularityToggle` mod | Mobile spaghetti; Track-B in last_7; Svelte 5 snippet regression; sample-paths-leaked-to-client |
| **12.4 Track-B + Cumulative Uplift** | Migrations 0056–0058 (`campaign_uplift_v` + `feature_flags` + Sept 15 reminder); `counterfactual_fit.py` (`TRAIN_END = campaign_start - 7d`); `cumulative_uplift.py`; `/api/campaign-uplift`; `CampaignUpliftCard` + `EventMarker` | "Did the campaign work?" answer surface | Pitfall #3 (trend extrapolation); concurrent intervention; anticipation; CF contamination |
| **12.5 Backtest Gate + Alerting + Cleanup** | Migrations 0059–0060; `backtest.py` (`statsforecast.cross_validation` + `ConformalIntervals`); `forecast-backtest.yml` (Tue 23:00); `forecast-quality-gate.yml`; `audit-cron.yml`; freshness-SLO badges | §16 gate; weekly accuracy log; final REVOKE/GRANT | Unfair comparison (regressor-aware naive); Chronos shipped unverified; production-grade freshness |

**Parallelism opportunity:** 12.2 ↔ 12.3 once 12.2-01 (schema) + 12.2-02 (SARIMAX) land. Estimated 30-40% schedule compression.

**Strict-serial gates:**
- 12.0 → 12.1 (audit + grep guard before migrations)
- 12.1 → 12.2 (external-data tables before SARIMAX exog)
- 12.2 → 12.4 (BAU stable + `campaign_calendar` populated)
- 12.4 → 12.5 (≥4 weeks of forecast-vs-actual to gate on)

---

## Stack Additions Confirmed

- **Zero new JS deps.** LayerChart 2.0.0-next.54 already in `package.json`; primitives `Spline`, `Area` (with `y0`/`y1`), `Rule` (Date `x`), `Tooltip.Root` (`{#snippet children}`) verified in `node_modules`.
- **9 new Python deps:** `prophet==1.3.0`, `holidays>=0.25,<1` (hard pin — Prophet break history), `statsforecast` (covers §16 12-fold CV via `cross_validation`), `openmeteo-requests==1.7.5` (official SDK with FlatBuffers), `python-holidays`, `httpx`, `feedparser`, `PyYAML`, `statsmodels` (already installed).
- **Tier-B feature-flagged:** `chronos-forecasting`, `neuralprophet` — CPU-only torch wheel (`--index-url https://download.pytorch.org/whl/cpu`) drops install size 2GB → 250MB on GHA. Cache `~/.cache/huggingface` between runs.
- **Replaced abandoned dep:** `ferien-api` PyPI wrapper last released 2022-10-06. Use raw `httpx.get('https://ferien-api.de/api/v1/holidays/BE/2026.json')` — five lines.
- **GHA budget verified:** Tier-A nightly fit (SARIMAX + Prophet + Theta + Naive) <1 GB peak, <2 min wall time on `ubuntu-latest`.

---

## Architecture Decisions

- **Hybrid RLS pattern:** weather/holidays/school/transit/events are SHARED location-keyed tables with `using (true)` policies (one Berlin = one row, scales O(1) in tenant count). `forecast_daily`, `campaign_calendar`, `shop_calendar`, `forecast_quality`, `feature_flags` are tenant-scoped via `restaurant_id`. Future-proof shared tables with a `location` column on `restaurants`.
- **Long-format forecast table with `forecast_track` discriminator:** `(restaurant_id, kpi_name, target_date, model_name, horizon_days, run_date, forecast_track)` — `bau` and `cf` tracks share one schema, one MV, one wrapper view.
- **pg_cron cannot invoke Python.** GHA schedules forecast Python; pg_cron only refreshes MVs (extends existing `refresh_analytics_mvs()` to also handle `forecast_daily_mv`). Communication via `pipeline_runs`.
- **Sample paths server-side, mean+CI on the wire.** 365d × 1000 paths × 5 models = ~20 MB per tenant per night — never reaches the phone. `/api/forecast` does percentile aggregation in Postgres, ships ~4 KB JSON. Granularity toggle resamples server-side.
- **`LazyMount` mandatory** for `/api/forecast` and `/api/campaign-uplift` per Phase 11 lessons (CF Workers Error 1102 risk).
- **22 new migrations identified** (0039–0060) with explicit ordering and scope-comment rule.
- **3 new GHA workflows** with UTC-anchored cron schedules.
- **~12 new SvelteKit components and 3 new `/api/*` deferred endpoints.**

---

## Watch Out For (Pitfalls Catalogue)

11 critical pitfalls in PITFALLS.md, of which the top design-time-preventables are listed above. Runtime mitigations needed for:

- **Refresh cascade staleness** — external-data fails → forecast uses stale weather → silent stale forecast. Mitigation: `pipeline_runs.upstream_freshness_h` check before Python forecast runs; UI badge "data ≥24h stale".
- **LayerChart marker-count ceiling** — 50+ markers on iPhone SE may degrade pan/zoom. Benchmark with 100+ markers in Chrome MCP early in 12.3.
- **`yhat_samples` storage growth** — ~125 MB/year/tenant on 500 MB Supabase free tier. TTL/janitor decision in `12-2-01-PLAN.md` or `12-5-01-PLAN.md`.

---

## Research Flags for Phase Planning

**Phases needing deeper research during `/gsd-research-phase`:**
- **12.2** — SARIMAX exog matrix flavor handling, Prophet ↔ holidays version-pin matrix, sample-path APIs per model
- **12.4** — Track-B cutoff sensitivity methodology, MC sampling for cumulative-uplift CIs, `revenue_comparable_eur` edge cases
- **12.5** — `statsforecast.cross_validation` + `ConformalIntervals` `n_windows × h < len(series)` constraint; regressor-aware naive baseline; gate workflow

**Phases with standard patterns (skip dedicated research):**
- **12.0** — Discuss-phase only
- **12.1** — All five fetcher patterns well-documented; shared-RLS table convention covered in ARCHITECTURE Pattern 1
- **12.3** — LayerChart primitives verified in `node_modules`; Svelte 5 snippet patterns covered by existing memory; LazyMount discipline established Phase 11

---

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Stack | HIGH | All 9 Python deps + version pins verified on PyPI 2026-04-27; LayerChart primitives verified by direct source inspection; `holidays>=0.25,<1` Prophet pin confirmed via Apache Superset #26629; `ferien-api` abandonment confirmed |
| Features | HIGH | Cross-checked against Tableau Pulse / Datadog / Toast / Lineup.ai / BIS; proposal covers 100% of industry table-stakes |
| Architecture | HIGH | Existing v1.0–v1.2 patterns load-bearing and verified in migrations 0001–0038; two-track `forecast_track` follows long-format-with-discriminator shape; JWT claim verified against migration 0012 |
| Pitfalls | HIGH | All 11 critical pitfalls map to documented sources; 5 are design-time preventable today with specific verify-phase assertions |

**Overall:** HIGH. Research converged on the proposal with zero strategic divergence.

---

## Gaps for Plan-Phase to Address

- `yhat_samples` jsonb storage trajectory — TTL/janitor decision in `12-2-01-PLAN.md` or `12-5-01-PLAN.md`
- FLT-01 date-range picker × horizon chips visual coexistence at 375px — resolve in `12-3-01-PLAN.md`
- BVG RSS URL not yet end-to-end verified — CI step in 12.1 acceptance test
- Chronos GHA wall-time + HF cache hit rate — not measured; watch-item for 12.5 alerting
- NeuralProphet promotion criterion (≥5% RMSE win) — drop deps if neither Chronos nor NeuralProphet promote after 4 weeks
- Anticipation cutoff date for 2026-04-14 campaign — confirm with friend in office hours; default `-7d` in `12-0-CONTEXT.md`

---

*Synthesized from 4 parallel research agents (gsd-project-researcher) + 1 synthesizer (gsd-research-synthesizer).*
