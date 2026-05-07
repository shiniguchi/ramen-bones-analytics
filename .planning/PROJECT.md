# Ramen Bones Analytics

## What This Is

A free, forkable, mobile-first analytics platform that turns Orderbird POS transactions into banking-grade growth metrics (cohorts, retention, LTV, forecasting, and campaign uplift attribution) for non-technical restaurant owners. Shipped through v1.3 to a single ramen restaurant; built multi-tenant-ready so any restaurant owner can fork or self-host. Features a nightly forecasting engine (5 statistical models), external-signal ingestion (weather/holidays/events), ITS campaign attribution, and a backtest gate for honest model promotion.

## Core Value

A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see — without needing a data team, a dashboard tool, or a deck.

## Requirements

### Validated

- ✓ Automated extraction of per-transaction Orderbird data with card-hash customer ID (daily refresh) — v1.0
- ✓ Supabase Postgres as single source of truth, with SQL models for cohorts/retention/LTV as materialized views refreshed nightly via pg_cron — v1.0
- ✓ First-visit acquisition cohorts (daily / weekly / monthly) with retention curves — v1.0
- ✓ Customer LTV per segment — v1.2
- ✓ Revenue trend KPIs (daily / weekly / monthly, avg ticket, tx count) — v1.0
- ✓ Repeat visit rate and visit-frequency distribution — v1.2
- ✓ Mobile-first SvelteKit frontend on Cloudflare Pages with interactive date/segment filters — v1.0
- ✓ Login-protected access (Supabase Auth), scoped per restaurant — v1.0
- ✓ Multi-tenant-ready data model from day 1 (RLS policies in place) — v1.0
- ✓ Forkable open-source repo (one-click deploy) so other restaurant owners can self-host — v1.0
- ✓ External data ingestion (weather, holidays, school breaks, events, transit strikes) backfilled from 2025-06-11 — v1.3
- ✓ Multi-horizon forecasting engine (SARIMAX/Prophet/ETS/Theta/Naive) with nightly refit and 95% CI — v1.3
- ✓ ITS campaign uplift attribution with Track-B counterfactual and honest "CI overlaps zero" labeling — v1.3
- ✓ Backtest gate: rolling-origin CV at 4 horizons, ≥10% RMSE vs regressor-aware naive required for model promotion — v1.3
- ✓ Event overlay (campaigns/holidays/events) wired into every date-axis chart via EventBadgeStrip — v1.3

### Active

- [ ] Admin UI for campaign calendar entry (currently Supabase Studio manual — low-friction for v1.3 single campaign, but next campaign needs a form)
- [ ] Date-range filter performance — residual single-cascade latency after 71% improvement in v1.3 Phase 16.2; owner notices the lag on April day-grain queries
- [ ] SARIMAX/ETS/Theta at week/month grain via sample-path aggregation (currently only Prophet + Naive_DoW available at non-day grain until ~mid-2027 when 104-week threshold met)
- [ ] At-risk customer identification — regulars gone quiet (follow-up to existing cohort analytics)

### Out of Scope

- Real-time / streaming data — daily refresh covers 99% of decisions, webhooks add complexity
- Onboarding flow / signup UI — single tenant, manual provisioning is fine
- Paid tier / billing — free and forkable is the business model
- Slide/PDF report generation — phone dashboard is the delivery vehicle
- Non-Orderbird POS integrations — scope creep risk
- Desktop-first layout — phone is the primary viewing surface
- Full Marketing Mix Modeling — need ≥3 marketing channels; Instagram-only in v1.x
- Deep-learning forecasters (TFT, DeepAR) — need ≥2 years data + GPU; SARIMAX wins at current scale
- Per-customer churn predictions — sparse card-hash tracking + low signal at 1 location

## Context

- **Founder background:** Growth analyst at a bank, expert in acquisition/retention/LTV modeling. Applying banking playbooks to restaurants.
- **Origin:** Helping a friend who owns a ramen restaurant. Friend is non-technical.
- **Data source:** Orderbird POS. No public API; ISV Partner API requires application (weeks). Fallback: Playwright scraper against `my.orderbird.com` CSV export; email parsing for tax/DATEV as last resort.
- **Data depth:** ~330 days / ~46 weeks / ~11 months (as of 2026-05-06). Enough for SARIMAX/ETS/Theta at day grain; Prophet + Naive_DoW only at week/month grain until ~mid-2027 (104-week threshold). LTV-to-date only, no 12-month projection yet.
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
| Single-tenant v1, multi-tenant architecture | Validate KPIs matter before building onboarding UX; avoid rewrite | ✓ Good — RLS + restaurant_id from day 1 paid off; no schema rewrite needed across 17 phases |
| SvelteKit over Next.js on Cloudflare | First-class CF adapter, smaller mobile bundle, no edge-runtime workarounds | ✓ Good — adapter-cloudflare worked cleanly; LazyMount pattern resolved CF Workers CPU limit |
| Supabase Postgres over Cloudflare D1 | Postgres window functions + CTEs + generate_series needed for cohort SQL; RLS for multi-tenancy | ✓ Good — window functions essential for every v1.x phase; D1 would have been fatal |
| Materialized views + pg_cron (not dbt) | Simpler at current scale; revisit dbt past 50+ models | ✓ Good — ~15 MVs manageable without dbt; refresh DAG in refresh_analytics_mvs() sufficient |
| Playwright CSV scraper as v1 extract path | ISV API approval takes weeks; need data flowing day 1 | ✓ Good — still active extract path; ISV API still pending as of v1.3 |
| Daily refresh cadence | 99% of decisions don't need intraday; simpler cron | ✓ Good — nightly cron covers all use cases; owner hasn't requested intraday |
| Card hash as customer ID | Works without opt-in, captures all repeat visits | ✓ Good — Worldline blackout (Apr 2026) only limitation; cohort linkage preserved for 10-month pre-campaign era |
| Forkable open-source, no paid tier | Product philosophy — give the banking playbook away | ✓ Good — repo public since v1.0; $0/month preserved through v1.3 |
| Two-track architecture (forecast_track discriminator) | Single forecast_daily table serves BAU + counterfactual; one MV, one wrapper view | ✓ Good — clean separation; Track-B never leaks campaign-era data into BAU |
| Hybrid RLS (shared location tables vs tenant-scoped) | Weather/holidays are public data; pipeline_runs/shop_calendar/campaign_calendar are tenant data | ✓ Good — no accidental PII in shared tables; audit confirmed |
| revenue_comparable_eur for ITS attribution | Coincident menu launches (Onsen EGG, Tantan, Hell beer) contaminate raw revenue | ✓ Good — ITS validity audit confirmed contamination; comparable revenue is the correct baseline |
| Honest "CI overlaps zero" labeling | No detectable lift doesn't mean the campaign failed — just underpowered at current sample size | ✓ Good — friend accepted the honest framing; sensitivity log PASS in [0.8, 1.25] |

## Current Milestone: v1.4 Weekly Campaign Read

**Goal:** Replace the CampaignUpliftCard's "since launch" cumulative headline with a per-ISO-week (Mon–Sun) counterfactual answer, plus a tap-scrubbable bar-chart history of all completed weeks since campaign launch — so the friend-owner gets a fresh weekly read on whether the campaign is working, not a single decaying cumulative number that drifts toward "no detectable lift" the longer it runs.

**Target features:**
- Per-ISO-week counterfactual uplift with proper bootstrap CI (re-fit on the 7-day slice — daily CIs do not subtract additively because bootstrap samples are correlated)
- Persisted weekly history (one row per fully-completed Mon–Sun week since campaign launch; partial launch week excluded)
- Dashboard hero shows last completed week ("Week of Apr 27 – May 3") replacing cumulative-since-launch
- Bar chart below hero: one bar per week, CI whiskers, color-coded by significance (gray = CI straddles zero, green = CI > 0, red = CI < 0), tap-to-scrub hero updates
- Reuses existing campaign_uplift table + CampaignUpliftCard component (single-phase, single-feature milestone)

**Requirements added:** UPL-08 (pipeline weekly window + bootstrap CI), UPL-09 (dashboard hero + bar chart UI, replaces UPL-05/06 cumulative-since-launch surface)

## Current State: v1.3 SHIPPED 2026-05-06

v1.3 complete. All 9 phases (12–17 + 16.1/16.2/16.3) shipped across 6 PRs (#17, #22, #26, #28, #29, #30).

**Shipped this milestone:**
- External data ingestion — 5 sources (weather/holidays/school/transit/events), nightly GHA, backfill from 2025-06-11
- Multi-horizon forecasting engine — SARIMAX/Prophet/ETS/Theta/Naive, 365d forward, 1000-path sample CI
- ITS campaign attribution — Track-B on pre-campaign era, revenue_comparable_eur, CampaignUpliftCard with honest CI labeling
- EventBadgeStrip — event overlay on every date-axis chart (replaced deleted forecast cards per owner feedback)
- Backtest gate — rolling-origin CV at 4 horizons, conformal 95% CI, ≥10% RMSE promotion gate, weekly ACCURACY-LOG

**Empirical headline:** 2026-04-14 friend campaign — cumulative deviation −€565 over 14 days, 95% CI [−€3,745, +€2,298]. Statistically indistinguishable from null. Sensitivity sarimax 1.139 + prophet 0.890, both PASS in [0.8, 1.25].

**Budget:** $0/month preserved. All external data sources free. No new paid tiers added in v1.3.

**Next:** v1.4 Weekly Campaign Read — see Current Milestone section above. Phase 18 to plan.

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

**In-product surface:** `ModelAvailabilityDisclosure` component renders this matrix as an inline `<details>`-style disclosure under the legend chip row on CalendarRevenueCard and CalendarCountsCard. (RevenueForecastCard and InvoiceCountForecastCard were deleted in Phase 16.3 per owner feedback — they didn't drive business decisions.) The status column reads available/Phase-17/short-history dynamically based on the current grain + the API's `availableModels` shape. i18n keys `model_avail_*` in `src/lib/i18n/messages.ts` (en + ja real, de/es/fr placeholder per 16.1-02 pattern).

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
*Last updated: 2026-05-07 — opened milestone v1.4 "Weekly Campaign Read" (single-phase, single-feature scope). Adds UPL-08 + UPL-09 for per-ISO-week counterfactual + bar-chart history on CampaignUpliftCard.*
