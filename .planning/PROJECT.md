# Ramen Bones Analytics

## What This Is

A free, forkable, mobile-first analytics web app that turns Orderbird POS transactions into banking-grade growth metrics (cohorts, retention, LTV) for non-technical restaurant owners. V1 serves a single ramen restaurant (the founder's friend); the architecture is built multi-tenant-ready so any restaurant owner can eventually fork or self-host.

## Core Value

A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see — without needing a data team, a dashboard tool, or a deck.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Automated extraction of per-transaction Orderbird data with card-hash customer ID (daily refresh)
- [ ] Supabase Postgres as single source of truth, with SQL models for cohorts/retention/LTV as materialized views refreshed nightly via pg_cron
- [ ] First-visit acquisition cohorts (daily / weekly / monthly) with retention curves
- [ ] Customer LTV per segment
- [ ] Revenue trend KPIs (daily / weekly / monthly, avg ticket, tx count)
- [ ] Repeat visit rate and visit-frequency distribution
- [ ] Mobile-first SvelteKit frontend on Cloudflare Pages with interactive date/segment filters
- [ ] Login-protected access (Supabase Auth), scoped per restaurant
- [ ] Multi-tenant-ready data model from day 1 (RLS policies in place) even while v1 serves one tenant
- [ ] Forkable open-source repo (one-click deploy) so other restaurant owners can self-host

### Out of Scope

- Real-time / streaming data — daily refresh covers 99% of decisions, webhooks add complexity
- Onboarding flow / signup UI for v1 — single tenant, manual provisioning is fine
- Paid tier / billing — free and forkable is the business model
- Slide/PDF report generation — phone dashboard is the delivery vehicle
- Embedded notebooks in the user-facing UI — notebooks are the dev environment, not the product
- Non-Orderbird POS integrations — scope creep risk
- Desktop-first layout — phone is the primary viewing surface
- Looker / Metabase / external BI tools — product requirement is a custom web UI

## Context

- **Founder background:** Growth analyst at a bank, expert in acquisition/retention/LTV modeling. Applying banking playbooks to restaurants.
- **Origin:** Helping a friend who owns a ramen restaurant. Friend is non-technical.
- **Data source:** Orderbird POS. No public API; ISV Partner API requires application (weeks). Fallback: Playwright scraper against `my.orderbird.com` CSV export; email parsing for tax/DATEV as last resort.
- **Data depth:** 3–12 months of history available — enough for meaningful first-visit cohorts and short-range retention curves, not enough for 12-month LTV yet.
- **Customer identity:** Card hash / payment token (anonymized, no opt-in required).
- **User device:** Friend (and future owners) will open this on a phone. Mobile UX is non-negotiable.
- **Prior research (completed in pre-init conversation):**
  - Streamlit rejected — mobile layout broken
  - Next.js on Cloudflare Pages rejected — adapter friction
  - Supabase RLS confirmed as multi-tenancy strategy, with materialized views to avoid the analytical-query performance trap
  - SvelteKit chosen for first-class Cloudflare adapter and mobile bundle size

## Constraints

- **Tech stack:** SvelteKit + Cloudflare Pages (frontend), Supabase Postgres + Edge Functions + pg_cron (backend), Python + Playwright (extraction), Claude API (insight generation). No paid tiers in v1.
- **Timeline:** 2 weeks to MVP in friend's hands. Aggressive — skip polish, prioritize working KPIs over pixel-perfect UI.
- **Budget:** $0/month target. Free tiers only. Acceptable to reach ~$25/mo at 100+ restaurants later.
- **Data freshness:** Daily refresh (nightly cron) — no realtime/hourly in v1.
- **Mobile-first:** All views must be usable on a phone browser. Desktop is secondary.
- **Multi-tenant readiness:** RLS and tenant-scoped schema from day 1, even though v1 has one tenant. No rewrite later.
- **Forkability:** Repo must be forkable + self-hostable with minimal steps. No proprietary SaaS lock-in.
- **Security:** Card-hash only — never store PAN, PII, or raw card data. Supabase Auth handles credentials.
- **No Orderbird API yet:** v1 ships on Playwright scraper while ISV Partner API application is pending.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Single-tenant v1, multi-tenant architecture | Validate KPIs matter before building onboarding UX; avoid rewrite | — Pending |
| SvelteKit over Next.js on Cloudflare | First-class CF adapter, smaller mobile bundle, no edge-runtime workarounds | — Pending |
| Supabase Postgres over Cloudflare D1 | Postgres window functions + CTEs + generate_series needed for cohort SQL; RLS for multi-tenancy | — Pending |
| Materialized views + pg_cron (not dbt) | Simpler at current scale; revisit dbt past 50+ models | — Pending |
| Playwright CSV scraper as v1 extract path | ISV API approval takes weeks; need data flowing day 1 | — Pending |
| Daily refresh cadence | 99% of decisions don't need intraday; simpler cron | — Pending |
| Card hash as customer ID | Works without opt-in, captures all repeat visits | — Pending |
| Forkable open-source, no paid tier | Product philosophy — give the banking playbook away | — Pending |

## Current Milestone: v1.3 External Data & Forecasting Foundation

**Goal:** Ingest free external signals (weather, holidays, events), build a multi-horizon forecasting engine, render forecast overlays on the revenue chart, and attribute campaign uplift via Interrupted Time Series counterfactuals.

**Target features:**
- ✓ **External data ingestion** — shipped Phase 13 (PR #17, 2026-04-21). Open-Meteo weather, `python-holidays` federal+state, `ferien-api.de` school breaks, BVG transit-strike RSS, hand-curated recurring events — backfilled from 2025-06-11.
- ✓ **Multi-horizon forecasting engine** — shipped Phase 14 (PR #22, 2026-05-01). SARIMAX + Prophet + ETS + Theta + Naive at +7d / +35d / +120d / +365d; daily refit; 5/5 models producing forecasts on DEV.
- ✓ **Forecast chart UI** — shipped Phase 15 (PR #26, 2026-05-01). LayerChart overlay with horizon toggle, event markers (5 sources), backtest overlay v2.
- ✓ **ITS-based uplift attribution** — shipped Phase 16 (2026-05-04). Track-B counterfactual fit on pre-campaign era only; `campaign_uplift_v` exposes per-campaign cumulative `actual − Track-B` with 95% Monte Carlo CIs from 1000 sample paths; `CampaignUpliftCard.svelte` renders honest "CI overlaps zero — no detectable lift" labeling when 95% CI straddles 0; sensitivity log at `tests/forecast/cutoff_sensitivity.md` confirms sarimax 1.139 + prophet 0.890 ratios PASS in [0.8, 1.25] healthy band. UPL-01..07 validated.
- [ ] Backtest gate (Phase 17): rolling-origin CV at 4 horizons, 12-week harness, ≥10% RMSE improvement vs naive same-DoW required to deploy a new model
- [ ] Last-7-actual-days nightly accuracy log surfaced on hover tooltip (freshness ≤24h)

**Shipped this milestone (in order):** 13 → 14 → 15 → 16. Phase 17 (Backtest Gate & Quality Monitoring) is the final v1.3 phase.

**Key context:**
- Friend-owner started a marketing campaign on 2026-04-14; she needs a "did it work?" answer that current MDE analysis cannot give (lift detection requires ≥6 weeks at current σ)
- Pre-campaign era (10 months, 2025-06-11 → 2026-04-13) is the natural control period — Track-B counterfactual on pre-period only enables causal inference without a customer holdout (Instagram channel = no per-follower exclusion possible)
- Driving artifact: `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` (1484-line pre-baked proposal — verified data sources, schema sketches, GHA cron pattern, failure modes, backtest fairness rules, hover-popup spec, ITS validity audit)
- $0/month budget preserved: Open-Meteo + python-holidays + ferien-api.de + BVG RSS + GitHub Actions = $0
- Out of scope: full Marketing Mix Modeling (defer to v1.4+ when 3+ channels exist), real-time/hourly forecasting, item-level demand, multi-shop scaling
- Phase numbering continues from 11 → Phases 12-N (no `--reset-phase-numbers`)

## Forecast Model Availability Matrix

(captured 2026-05-05 during Phase 16.2 polish — see also `.planning/phases/16.2-friend-persona-qa-gap-closure/16.2-04-AUDIT.md` for the SQL audit and `src/lib/components/ModelAvailabilityDisclosure.svelte` for the in-product surface)

The pipeline runs separate fits per `(model, kpi, granularity)` tuple. Each model has minimum-history thresholds before it can fit at a given grain. Chips in `ForecastLegend` are data-driven — disabled at 40% opacity when the API does not return rows for that model at the selected grain.

| Model | day grain | week grain | month grain | Why |
|---|---|---|---|---|
| **SARIMAX** | 30 daily buckets | 104 weekly buckets | 24 monthly buckets | Statsmodels SARIMAX requires ≥3× seasonal period to estimate AR/MA orders. At week/month grain, `scripts/forecast/grain_helpers.py` `YEARLY_THRESHOLD_BY_GRAIN` is the hard gate — fit refuses to run below it (workflow log: `RuntimeError: Insufficient week history: 41 buckets (need >= 104)`). At day grain the pipeline runs without yearly seasonality below 730 (gracefully degraded). |
| **Prophet** | 30 daily | 8 weekly | 4 monthly | Prophet auto-degrades gracefully — `yearly_seasonality=False` until ≥730 daily / 104 weekly / 24 monthly buckets per `scripts/forecast/prophet_fit.py:52` `YEARLY_THRESHOLD_BY_GRAIN`, but the model still fits below threshold without yearly term. Lowest fit threshold of all 5 statistical models. |
| **ETS** | 30 daily | 104 weekly | 24 monthly | Same hard week/month gate as SARIMAX (workflow log: `RuntimeError: Insufficient week history: 41 buckets`). |
| **Theta** | 30 daily | 104 weekly | 24 monthly | Same hard week/month gate as SARIMAX/ETS. |
| **Naive_DoW** | 7 daily | 1 weekly | 1 monthly | Trivial — just averages historical day-of-week values. Always available once history exists. |
| **Chronos** | feature-flagged off | feature-flagged off | feature-flagged off | Not in `FORECAST_ENABLED_MODELS` env in `.github/workflows/forecast-refresh.yml`. Phase 17 backlog (foundation models need backtest gate before promotion). |
| **NeuralProphet** | feature-flagged off | feature-flagged off | feature-flagged off | Same as Chronos — Phase 17 backlog. ROADMAP entry: "≥5% RMSE-win promotion criterion". |

**Friend's data as of 2026-05-05:** ~330 days / ~46 weeks / ~10 months. So:

- **Day grain:** all 5 statistical models available + 2 disabled feature-flagged
- **Week grain:** only Prophet + Naive_DoW available (need ~58 more weeks for SARIMAX/ETS/Theta to unlock — projected mid-2027)
- **Month grain:** only Prophet + Naive_DoW available (need ~14 more months for SARIMAX/ETS/Theta — projected mid-2027)

**The "just sum daily forecasts" question** (raised by the friend 2026-05-05): summing daily yhat point estimates is mathematically fine; **summing daily yhat_lower / yhat_upper is a documented anti-pattern** because daily errors are correlated and pointwise CIs assume independence. The pipeline already stores 200 sample paths per daily forecast in `forecast_daily.yhat_samples jsonb` (written by `paths_to_jsonb` in every `*_fit.py`). A future v1.3 polish could aggregate those daily paths to weekly/monthly buckets server-side and expose SARIMAX/ETS/Theta at non-day grain via path aggregation rather than native fit — half-day work, cleanest as a SQL view + Edge Function. Not blocking v1.3 friend-persona acceptance; flagged as a v1.4 candidate.

**In-product surface:** `ModelAvailabilityDisclosure` component renders this matrix as an inline `<details>`-style disclosure under the legend chip row on RevenueForecastCard, InvoiceCountForecastCard, CalendarRevenueCard, and CalendarCountsCard. The status column reads available/Phase-17/short-history dynamically based on the current grain + the API's `availableModels` shape. i18n keys `model_avail_*` in `src/lib/i18n/messages.ts` (en + ja real, de/es/fr placeholder per 16.1-02 pattern).

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-04 — Phase 16 (ITS Uplift Attribution) complete. Track-B counterfactual pipeline, campaign_uplift_v + CampaignUpliftCard with honest "CI overlaps zero" labeling shipped. UPL-01..07 validated. Headline empirical result for the 2026-04-14 friend campaign: −€565 cumulative deviation over 14 post-launch days, 95% CI [−€3,745, +€2,298] — statistically indistinguishable from null effect. Sensitivity log: sarimax 1.139 + prophet 0.890 ratios PASS in [0.8, 1.25] band. Wave 4 also folded in 4 Wave-2 spec-gap hotfixes (mig 0065/0066, pred_dates anchor, started_at probe). Phase 17 (Backtest Gate) is the only remaining v1.3 phase.*
