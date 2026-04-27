# Architecture Research — v1.3 External Data & Forecasting Foundation

**Domain:** Multi-tenant analytics on SvelteKit + Cloudflare Pages + Supabase Postgres, extended with external-data ingestion (weather/holidays/events), multi-horizon forecasting (SARIMAX/ETS/Theta/Naive/Prophet), and ITS counterfactual uplift attribution.
**Researched:** 2026-04-27
**Confidence:** HIGH (existing patterns are load-bearing and well-documented in migrations 0001–0038; the proposal's own §7/§13/§14/§15 already prescribe schema and DAG with internal cross-references)

---

## System Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│  GitHub Actions (cron host — free for public repo)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ orderbird    │  │ external-    │  │ forecast-    │  │ forecast-   │ │
│  │ scraper      │  │ data-refresh │  │ refresh      │  │ backtest    │ │
│  │ (existing)   │  │ 02:30 UTC    │  │ 03:00 Berlin │  │ Tue 23:00   │ │
│  │ ~02:00 UTC   │  │ NEW          │  │ NEW          │  │ NEW (weekly)│ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘ │
└─────────┼─────────────────┼─────────────────┼────────────────┼─────────┘
          │  service_role   │  service_role   │  service_role  │
          ▼                 ▼                 ▼                ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Supabase Postgres (single source of truth)                            │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ Raw / staging (REVOKE ALL from authenticated)                  │    │
│  │  stg_orderbird_order_items  transactions                       │    │
│  │  weather_daily*  holidays*  school_holidays*  transit_alerts*  │    │
│  │  recurring_events*  campaign_calendar  shop_calendar           │    │
│  │  forecast_daily  forecast_quality  pipeline_runs               │    │
│  │  feature_flags   (* = shared, see RLS section)                 │    │
│  └────────────────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ Materialized views (REVOKE ALL — refreshed by pg_cron)         │    │
│  │  cohort_mv  kpi_daily_mv  visit_attribution_mv                 │    │
│  │  customer_ltv_mv  item_counts_daily_mv                         │    │
│  │  forecast_daily_mv  (NEW: latest run per (tenant,kpi,target,model,track)) │
│  └────────────────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ Wrapper views *_v (GRANT SELECT TO authenticated)              │    │
│  │   — only thing the SvelteKit app reads —                       │    │
│  │  retention_curve_v  ltv_v  kpi_daily_v  ...existing            │    │
│  │  forecast_with_actual_v  forecast_quality_v  campaign_uplift_v │    │
│  │  campaign_active_v  baseline_items_v  kpi_daily_with_comparable_v│  │
│  │  weather_daily_v  holidays_v  events_for_chart_v               │    │
│  └────────────────────────────────────────────────────────────────┘    │
│  pg_cron jobs:                                                          │
│    refresh-analytics-mvs    03:00 UTC (existing)                        │
│    refresh-forecast-mv      03:30 Berlin (NEW)                          │
│    recurring-events-reminder Sept 15 09:00 (NEW)                        │
└────────────────────────────────────────────────────────────────────────┘
                                  │   RLS via auth.jwt()->>'restaurant_id'
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│  SvelteKit 2 + Svelte 5 on Cloudflare Pages (adapter-cloudflare)        │
│  +page.server.ts SSR load → fast cards (KPIs, summary)                 │
│  /api/* deferred endpoints → forecast, forecast-quality, campaign-uplift│
│  Components: existing dashboard + RevenueForecastCard, ForecastLegend,  │
│              ForecastHoverPopup, HorizonToggle, CampaignUpliftCard,     │
│              EventMarker, GranularityToggle (existing, extended)        │
└────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities (v1.3 additions)

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| `external-data-refresh.yml` | Pull Open-Meteo, python-holidays, ferien-api.de, BVG RSS, recurring_events.yaml → upsert shared tables | GHA cron 02:30 UTC, Python 3.12, supabase-py service-role write |
| `forecast-refresh.yml` | Refit SARIMAX/Prophet/ETS/Theta/Naive (BAU + CF) for each tenant, 365d horizon, write `forecast_daily` | GHA cron 03:00 Berlin (after external-data), Python + statsmodels/prophet |
| `forecast-backtest.yml` | Weekly rolling-origin CV, populate `forecast_quality` with `evaluation_window='rolling_origin_cv'` | GHA cron Tuesday 23:00 Berlin |
| `last_7_eval.py` | Nightly: refit each model 7× on `[T-6..T]`, compute trailing-7 RMSE/MAPE/bias, write `forecast_quality` with `evaluation_window='last_7_days'` | Runs inside `forecast-refresh.yml`, after `fit_all.py` |
| `counterfactual_fit.py` | Track-B: refit on `[2025-06-11 .. campaign_start - 1]` only, write `forecast_track='cf'` rows | Runs inside `forecast-refresh.yml`, after `fit_all.py` |
| `cumulative_uplift.py` | Sum (actual − Track-B) per campaign window per model, MC sample paths for CI | Reads `forecast_daily.yhat_samples` + `kpi_daily_with_comparable_v` |
| `forecast_daily_mv` | "Latest run" materialized view: one row per (tenant, kpi, target_date, model, track) — newest `run_date` wins | `REFRESH MATERIALIZED VIEW CONCURRENTLY` via pg_cron 03:30 Berlin (after Python writers) |
| `forecast_with_actual_v` | Joined view: actual + per-model BAU forecast + CI band, tenant-scoped via `auth.jwt()->>'restaurant_id'` | The single source the chart reads |
| `RevenueForecastCard.svelte` | Renders actual line + SARIMAX BAU + 95% CI band; optional Prophet/Chronos overlays | LayerChart on Svelte 5 runes, fetches via `/api/forecast` |
| `/api/forecast/+server.ts` | Deferred endpoint: returns mean+CI per (target_date, model, track) — never raw 1000 sample paths | SvelteKit `+server.ts`, queries `forecast_with_actual_v` |
| `/api/forecast-quality/+server.ts` | Returns trailing-7 + 12-fold CV metrics for hover popup | Reads `forecast_quality_v` |
| `/api/campaign-uplift/+server.ts` | Cumulative uplift since launch, with CI bounds | Reads `campaign_uplift_v` |

---

## Recommended Project Structure (v1.3 deltas)

```
supabase/migrations/
  0039_weather_daily.sql                 # shared, RLS read-all
  0040_holidays.sql                      # shared, RLS read-all
  0041_school_holidays.sql               # shared, RLS read-all
  0042_transit_alerts.sql                # shared, RLS read-all
  0043_recurring_events.sql              # shared, RLS read-all
  0044_external_data_views.sql           # weather_daily_v / holidays_v / events_for_chart_v
  0045_pipeline_runs.sql                 # audit table (no RLS — service_role only)
  0046_shop_calendar.sql                 # tenant-scoped, RLS write+read
  0047_campaign_calendar.sql             # tenant-scoped, RLS read; service_role + admin write
  0048_campaign_active_v.sql             # helper view
  0049_baseline_items_v.sql              # auto-derives post-launch items
  0050_kpi_daily_with_comparable_v.sql   # extends existing kpi_daily_mv
  0051_forecast_daily.sql                # main long-format table; (tenant,kpi,target,model,run_date,track) PK
  0052_forecast_daily_mv.sql             # "latest run" MV + UNIQUE index for CONCURRENTLY refresh
  0053_forecast_with_actual_v.sql        # tenant-scoped joined view (chart's only data source)
  0054_forecast_quality.sql              # backtest/last-7 results table
  0055_forecast_quality_v.sql            # tenant wrapper view
  0056_campaign_uplift_v.sql             # ITS Σ(actual − Track-B) per (campaign, model)
  0057_feature_flags.sql                 # per-tenant Chronos/NeuralProphet enables
  0058_recurring_events_reminder_cron.sql# pg_cron Sept 15 nag
  0059_refresh_function_forecast.sql     # extend refresh_analytics_mvs() to also refresh forecast_daily_mv
  0060_revoke_grants_v13.sql             # REVOKE ALL on new raw tables/MVs from authenticated; GRANT SELECT on _v views

scripts/external/                       # NEW directory
  __init__.py
  weather_fetch.py                      # Open-Meteo: backfill from 2025-06-11 + 7d forecast
  holidays_seed.py                      # python-holidays (DE+BE) + ferien-api.de school
  transit_alerts_fetch.py               # BVG RSS parser + German keyword match
  recurring_events_seed.py              # YAML loader
  recurring_events.yaml                 # 15-20 hand-curated Berlin events/year

scripts/forecast/                       # NEW directory
  __init__.py
  fit_all.py                            # nightly orchestrator
  sarimax_fit.py                        # primary, exog regressors
  prophet_fit.py                        # secondary, yearly_seasonality=False
  ets_fit.py
  theta_fit.py
  naive_dow_baseline.py
  chronos_zero_shot.py                  # behind feature flag
  neuralprophet_fit.py                  # behind feature flag
  counterfactual_fit.py                 # Track-B (pre-campaign era only)
  last_7_eval.py                        # nightly trailing-7 evaluator
  backtest.py                           # weekly 12-fold rolling-origin CV

scripts/uplift/                         # NEW directory
  __init__.py
  cumulative_uplift.py                  # Σ(actual − Track-B) MC sampling

tools/
  its_validity_audit.py                 # MOVE from workspace; weekly health check

.github/workflows/
  external-data-refresh.yml             # NEW — 02:30 UTC nightly
  forecast-refresh.yml                  # NEW — 03:00 Berlin nightly (depends on external-data)
  forecast-backtest.yml                 # NEW — Tuesday 23:00 Berlin weekly
  forecast-quality-gate.yml             # NEW — gates merges if RMSE regresses

src/lib/components/
  RevenueForecastCard.svelte            # NEW — primary forecast card
  ForecastLegend.svelte                 # NEW — toggle methods on/off
  ForecastHoverPopup.svelte             # NEW — per-line trailing-7 RMSE + cum-deviation
  HorizonToggle.svelte                  # NEW — 7d/5w/4mo/1yr chips
  CampaignUpliftCard.svelte             # NEW — per-campaign cumulative lift
  EventMarker.svelte                    # NEW — vertical marker overlay
  GranularityToggle.svelte              # MODIFIED — add sample-path-resample mode

src/lib/api/
  forecast.ts                           # NEW — typed client for /api/forecast*

src/routes/api/
  forecast/+server.ts                   # NEW — deferred load (LazyMount-friendly)
  forecast-quality/+server.ts           # NEW
  campaign-uplift/+server.ts            # NEW

src/routes/(app)/dashboard/
  +page.svelte                          # MODIFIED — slot in RevenueForecastCard + CampaignUpliftCard
  +page.server.ts                       # MODIFIED — load only headline KPI; defer forecast to /api/forecast

tests/forecast/
  test_smoke_per_model.py
  test_backtest_gate.py
  backtest_report.md                    # auto-committed weekly

docs/forecast/
  ACCURACY-LOG.md                       # weekly RMSE log
```

### Structure rationale

- **`scripts/external/` vs `scripts/forecast/`:** different cadences (02:30 UTC vs 03:00 Berlin) and different failure domains (network → external; statsmodels → forecast). Splitting makes the GHA workflow files dead-simple.
- **Migrations grouped 0039–0060:** preserves the established sequential naming (current head is 0038). Forecast migrations come AFTER external-data because forecast tables reference `restaurants(id)` and the BAU forecast queries weather/holidays as exog regressors (regressors must exist as tables before forecast Python can read them, but **not** before `forecast_daily.sql` itself is created — these are independent objects).
- **`/api/*` deferred endpoints:** Phase 11 already established the pattern that lifetime-unbounded queries must run behind `LazyMount` to avoid CF Workers Error 1102 CPU blowup. Forecast queries traverse 365 days × N models — exactly that risk profile.

---

## Architectural Patterns

### Pattern 1 — Shared external data + tenant-scoped derived facts (RLS hybrid)

**What:** External-data tables (`weather_daily`, `holidays`, `school_holidays`, `transit_alerts`, `recurring_events`) are NOT tenant-scoped. They have RLS enabled with a permissive `for select using (true)` policy. Tenant-scoped tables (`forecast_daily`, `campaign_calendar`, `shop_calendar`, `feature_flags`, `forecast_quality`) carry `tenant_id` (mapped to `restaurant_id` in this codebase) and use `auth.jwt()->>'restaurant_id'` filters.

**When to use:** When the same external signal applies identically across tenants (Berlin weather is Berlin weather; Frauentag is a Berlin holiday regardless of which restaurant asks). Avoid duplicating 365 rows × N tenants of identical weather data.

**Trade-offs:**
- **Pro:** O(1) storage in tenant count for shared signals; one fetcher run hydrates all tenants; admin (Shinno) maintains one `recurring_events.yaml` not N.
- **Pro:** Survives the multi-tenant transition cleanly — when tenant #2 is in Berlin, no data work needed; when tenant #2 is in Hamburg, add `location='hamburg'` rows alongside.
- **Con:** If a tenant ever wants per-shop event overrides (e.g., "block party in front of MY shop"), need a second `tenant_recurring_events` table layered on top.
- **Con:** RLS `using (true)` is only safe if the column set is genuinely non-sensitive. Verified: weather, public holidays, RSS-published transit alerts, public events. None of these reveal anything about a tenant's business.

**Rule for the schema PRs:** every new table MUST declare its scope explicitly in the migration comment. Pattern:

```sql
-- 0039_weather_daily.sql
-- SCOPE: shared (location-keyed, not tenant-keyed). RLS = read-all.
-- Multi-tenant strategy: when a non-Berlin tenant arrives, add rows with
-- location = 'hamburg' (etc.) and join via tenant.location_code.

create table public.weather_daily (
  date date not null,
  location text not null default 'berlin',
  ...
  primary key (date, location)
);
alter table public.weather_daily enable row level security;
create policy weather_daily_read on public.weather_daily for select using (true);
revoke insert, update, delete on public.weather_daily from authenticated, anon;
-- service_role can write (no policy needed; service_role bypasses RLS).
```

**Tenant.location wiring (defer to v1.4):** add a `location` column to `restaurants` that defaults to `'berlin'`. Wrapper views select `weather_daily.* WHERE location = (SELECT location FROM restaurants WHERE id = auth.jwt()->>'restaurant_id')`. For v1.3, hard-code `location = 'berlin'` and document the future hook.

### Pattern 2 — Forecast long-format with composite key + "latest-run" MV

**What:** `forecast_daily` is long-format (one row per `(tenant_id, kpi_name, target_date, model_name, run_date, forecast_track)`) — this is what §7 + §13 prescribe and is the right call. `forecast_daily_mv` collapses to "latest run per (tenant, kpi, target, model, track)" so the chart query never has to do `MAX(run_date)` subqueries on every page load.

**When to use:** Always for forecast/backtest/uplift workloads. The long format is mandatory because:
1. Backtest CV needs to write the **same** `(tenant, kpi, target, model)` row from MANY different `run_date` values (one per fold).
2. Track-A vs Track-B distinction requires an additional dimension that wide-format can't accommodate without doubling every column.
3. The hover popup's "last refit" timestamp is a row-level fact, not a column fact.

**Trade-offs:**
- **Pro:** Schema doesn't change when adding a model — just write rows with the new `model_name`. No `ALTER TABLE` per model.
- **Pro:** `evaluation_window='last_7_days'` and `'rolling_origin_cv'` cleanly coexist in `forecast_quality`.
- **Con:** Chart queries are slightly more verbose (must filter `model_name IN (...)`).
- **Con:** `forecast_daily_mv` MUST have a UNIQUE index on `(tenant_id, kpi_name, target_date, model_name, forecast_track)` for `REFRESH ... CONCURRENTLY` to work — easy to forget.

**The MV definition:**

```sql
-- 0052_forecast_daily_mv.sql
create materialized view public.forecast_daily_mv as
with latest as (
  select tenant_id, kpi_name, target_date, model_name, forecast_track,
         max(run_date) as run_date
  from public.forecast_daily
  group by tenant_id, kpi_name, target_date, model_name, forecast_track
)
select f.*
from public.forecast_daily f
join latest l using (tenant_id, kpi_name, target_date, model_name, forecast_track, run_date);

create unique index forecast_daily_mv_pk
  on public.forecast_daily_mv(tenant_id, kpi_name, target_date, model_name, forecast_track);

revoke all on public.forecast_daily_mv from authenticated, anon;
```

**The wrapper:** `forecast_with_actual_v` (per FND-04 / D-04 wrapper-view pattern):

```sql
create or replace view public.forecast_with_actual_v as
select
  f.tenant_id, f.kpi_name, f.target_date, f.model_name, f.forecast_track,
  f.yhat, f.yhat_lower, f.yhat_upper, f.run_date, f.fitted_at,
  k.revenue_eur as actual_eur,
  k.revenue_comparable_eur
from public.forecast_daily_mv f
left join public.kpi_daily_with_comparable_v k
  on k.tenant_id = f.tenant_id and k.date = f.target_date
where f.tenant_id::text = (auth.jwt() ->> 'restaurant_id');

grant select on public.forecast_with_actual_v to authenticated;
```

Note: this codebase's JWT claim is `restaurant_id` (per FND-03 + observed `0012_leaf_views.sql` line 25). The proposal uses `tenant_id` in policies — **standardize on `restaurant_id`** throughout v1.3 migrations to match the existing convention. Plan-phase must rename `(auth.jwt()->>'tenant_id')` in §7 sketches to `(auth.jwt()->>'restaurant_id')`.

### Pattern 3 — Two-track forecast in one table (BAU vs CF) via `forecast_track` column

**What:** §13 puts both Track-A (BAU, fit on all data) and Track-B (counterfactual, fit on pre-campaign-era only) in the same `forecast_daily` table, distinguished by `forecast_track text not null default 'bau'`. PK includes the track.

**When to use:** Whenever you need parallel forecasts on the same series with different fit cutoffs. The same machinery (Python fitters, sample-path storage, MV-collapse) serves both.

**Trade-offs:**
- **Pro:** One MV refresh, one wrapper view, one Python orchestrator. Adding a third track (e.g., "post-cutoff retraining") is just another enum value.
- **Pro:** UI never sees "two tables, two queries" — it filters one column.
- **Con:** CF rows have a structural truth: their accuracy is **unverifiable past the campaign-start cutoff** (no actual-without-campaign world exists). The `forecast_quality` table MUST encode this — a `cf` model row with `evaluation_window='last_7_days'` is a category error and should not be written. Enforce in `last_7_eval.py`: skip Track-B in trailing-7 metric loop. Hover popup shows "unverifiable by construction" for Track-B accuracy.
- **Con:** Audit discipline matters: `pipeline_runs.error_msg` (or a dedicated audit column) must record the `fit_train_end` cutoff for every CF refit, otherwise nobody can tell after the fact whether Track-B was contaminated. Add `fit_train_end date` to `pipeline_runs`.

### Pattern 4 — Refresh DAG: external-data → forecast-Python → forecast MV → analytics MV

**What:** Strict serial dependency chain, run via two GHA workflows + one pg_cron job:

```
02:30 UTC  external-data-refresh.yml (GHA)
              ↓ writes weather_daily, holidays, transit_alerts (rows)
              ↓ writes pipeline_runs row per script
03:00 Berlin (= 02:00 or 01:00 UTC depending on DST — see below)
           forecast-refresh.yml (GHA)
              ↓ reads weather_daily / holidays / transactions
              ↓ calls fit_all.py → writes forecast_daily rows
              ↓ calls counterfactual_fit.py → writes forecast_track='cf' rows
              ↓ calls last_7_eval.py → writes forecast_quality rows
              ↓ writes pipeline_runs row per script
03:30 Berlin pg_cron job 'refresh-forecast-mv'
              ↓ REFRESH MATERIALIZED VIEW CONCURRENTLY forecast_daily_mv
03:00 UTC  pg_cron job 'refresh-analytics-mvs' (existing, may overlap)
              ↓ refreshes cohort_mv, kpi_daily_mv, etc
```

**Why pg_cron schedules MVs but GHA schedules Python:** pg_cron lives inside Postgres — it cannot invoke a Python process. It can call a SECURITY DEFINER SQL function or a Supabase Edge Function via `pg_net.http_post`. Edge Functions can run arbitrary Deno code but are unsuitable for SARIMAX (no `statsmodels` in Deno). So Python forecasters MUST run on GHA, and pg_cron's job in v1.3 is limited to (a) refreshing existing analytics MVs, (b) refreshing `forecast_daily_mv` after Python writers finish, (c) firing the September YAML reminder.

**DST catch:** "03:00 Berlin" is `01:00 UTC` in summer (CEST) and `02:00 UTC` in winter (CET). GHA cron only takes UTC. Two options:

1. **Schedule in UTC, accept the wall-clock drift.** Use `'0 1 * * *'` (= 03:00 CEST / 02:00 CET). When CET kicks in (late October), the friend sees the dashboard refresh an hour earlier; she won't notice because she opens it at lunchtime.
2. **Schedule both:** `'0 1 * * *'` (CEST window) + `'0 2 * * *'` (CET window) and idempotency-guard each script. Wasteful.

**Recommendation:** option 1, document the DST drift in the workflow file. The 30-minute window between external-data (02:30 UTC) and forecast (01:00 UTC = 03:00 CEST) **only works in summer**. In winter, forecast runs at 02:00 UTC = 03:00 CET and external-data ran at 02:30 UTC = 30 minutes LATER. **This is broken.**

**Fix:** schedule external-data 90 minutes before forecast in UTC: `'0 0 * * *'` (= 00:00 UTC) for external-data, `'0 1 * * *'` (= 01:00 UTC) for forecast. Both compute against fresh data; both run before the friend's first morning check (Berlin breakfast time). DST-safe because the gap is in UTC, not local.

### Pattern 5 — Stale-data tolerance: graceful degrade, never block

**What:** When `weather_fetch.py` fails (Open-Meteo 5xx or network out at 02:30 UTC), forecast at 03:00 must NOT fail. Strategy per §14:

| Missing input | Fallback | UI signal |
|---------------|----------|-----------|
| Today's weather row | Yesterday's row OR climatological-norm fill (DoW × month historical mean) | Badge "weather data: stale (last fetched [date])" if >36h old |
| Future weather (>16d Open-Meteo limit) | Climatological norm (DoW × month over 80yr history) for horizon 17–365 | None — this is documented expected behavior |
| `holidays` table never seeded | python-holidays library still works offline; SARIMAX continues without exog | None if federal still loaded |
| `transit_alerts` empty | Treat as "no strike today" — absence-of-news ≠ strike | "transit alerts: paused" if 3+ days no fetch |
| Prophet fit fails (cmdstan) | Drop Prophet from chart for that day; SARIMAX still serves | "Prophet line: unavailable today" |
| `forecast_daily` empty (full pipeline broke) | Serve `last_good_forecast_v` (cached snapshot from prior successful refit) | "forecast snapshot from [time]" |

**Implementation gate:** every Python script writes one row to `pipeline_runs` with `status IN ('success', 'failed', 'fallback')`. The wrapper view `forecast_with_actual_v` is fed by the MV, which is fed by the latest non-empty Python write — never blocks on a missing input.

**Verifiable contract:** the test in §19 12.1 is `select count(*) from pipeline_runs where started_at >= current_date - 1 and status = 'success'` — which catches `'fallback'` as a non-success. Suggest splitting:

```sql
select count(*) filter (where status = 'success'),
       count(*) filter (where status = 'fallback'),
       count(*) filter (where status = 'failed')
from pipeline_runs where started_at >= current_date - 1;
```

### Pattern 6 — Sample paths server-side, mean+CI on the wire

**What:** Each model writes 1000 sample paths to `forecast_daily.yhat_samples jsonb`. The chart fetches mean + CI bounds only — never the 1000-path payload — via `/api/forecast`.

**Why:** 365 days × 1000 paths × 7 models × 8 bytes ≈ 20 MB per tenant per night on the wire. A phone on 4G can't load that. Only the **uplift API** (`/api/campaign-uplift`) needs sample paths server-side, and it returns aggregated CI bounds (`np.percentile(samples, [2.5, 97.5])`) — never raw arrays to the client.

**Where granularity-toggle resampling happens:**

| Granularity | Aggregation site | Why |
|-------------|------------------|-----|
| **Day** | Server reads `forecast_daily_mv` directly (one row per day) | Trivial |
| **Week** | Server: `cumulative_uplift.py` precomputes weekly Σ + percentile CIs → write to `forecast_weekly_mv` (NEW, optional in v1.3) OR computed on-the-fly in `/api/forecast?granularity=week` | Summing daily `yhat_lower`/`yhat_upper` is mathematically wrong (CI doesn't sum); must use sample paths + percentile (per §11 "Do not sum Prophet's `yhat_lower`/`yhat_upper`") |
| **Month** | Same as week | Same |

**Recommendation for v1.3:** compute on-the-fly inside `/api/forecast`. The endpoint loads the relevant `yhat_samples` jsonb columns for the requested date range, sums per-week, takes percentiles. 365d × 1000 samples × 5 models is ~14 MB to read in Postgres but only 4 KB to ship to the client (the aggregate). CF Workers can handle a 14 MB read if the SQL is well-indexed and the response is paged. Defer pre-computed weekly/monthly MVs to v1.4 once we measure latency.

**Don't:** refit on the client. The client never sees raw data; it only sees aggregated forecast points + CI bounds.

**Endpoint shape:**

```typescript
// GET /api/forecast?from=2026-04-27&to=2027-04-27&granularity=week&models=sarimax,prophet&track=bau
type ForecastResponse = {
  granularity: 'day' | 'week' | 'month';
  series: Array<{
    model: string;          // 'sarimax', 'prophet', ...
    track: 'bau' | 'cf';
    points: Array<{
      bucket_start: string; // ISO date
      yhat: number;
      yhat_lower: number;   // 2.5 percentile of resampled paths
      yhat_upper: number;   // 97.5 percentile
      n_actual: number | null;  // null if future
      actual: number | null;
    }>;
  }>;
  meta: {
    last_refit: string;     // ISO timestamp from forecast_daily.fitted_at
    horizon_days: number;
  };
};
```

### Pattern 7 — Tenant-scoped admin write for `campaign_calendar`

**What:** `campaign_calendar` is tenant-scoped. Read policy: `for select using (tenant_id::text = auth.jwt()->>'restaurant_id')`. Write policy: NONE (no `for insert/update/delete` policy → blocked for `authenticated`). For V1, Shinno inserts via Supabase Studio (which uses the `service_role` key, bypassing RLS).

**When to graduate:** when v1.4 ships `CampaignAdminForm.svelte`, add a write policy gated by an `admin` role claim:

```sql
create policy campaign_calendar_admin_write on public.campaign_calendar
  for all using (
    tenant_id::text = auth.jwt()->>'restaurant_id'
    and (auth.jwt()->>'role') = 'admin'
  );
```

This requires extending the existing custom access token hook (FND-02 / migration `0015_auth_hook_security_definer.sql`) to inject a `role` claim. Defer to v1.4 unless time permits in 12.4.

### Pattern 8 — `LazyMount` deferred load for forecast endpoints

**What:** Phase 11 established that lifetime-unbounded queries (any "all history" query that scales with tenant data depth) cannot run inside `+page.server.ts` without risking CF Workers Error 1102 (CPU time blowup). The fix is to mount the heavy card behind `<LazyMount>` and have it `fetch('/api/forecast')` after the page paints.

**Apply to v1.3:**
- `/api/forecast` — touches 365 days × N models, on-the-fly granularity resample. **Must** be deferred.
- `/api/forecast-quality` — small (one row per (model, horizon)). Could go in `+page.server.ts`. **Recommend deferred** anyway for consistency and because cold-start backtest computation is bursty.
- `/api/campaign-uplift` — small per campaign but does `np.percentile` over sample paths. **Must** be deferred.

**Page-level pattern in `+page.server.ts`:**

```typescript
// Existing dashboard load function — no change.
// Headline KPIs (kpi_daily_v) load inline; forecast cards mount lazily.
export const load = async ({ locals }) => {
  const { data } = await locals.supabase.from('kpi_daily_v').select('*').limit(30);
  return { kpiDaily: data };
};
```

**Page-level pattern in `+page.svelte`:**

```svelte
<HeadlineKPIs data={data.kpiDaily} />
<LazyMount>
  <RevenueForecastCard />     <!-- fetches /api/forecast on mount -->
</LazyMount>
<LazyMount>
  <CampaignUpliftCard />      <!-- fetches /api/campaign-uplift on mount -->
</LazyMount>
```

---

## Data Flow

### Request flow — chart load (default state)

```
1. Browser GET /dashboard
2. SvelteKit SSR: +page.server.ts loads kpi_daily_v (fast: ~30 rows)
3. Page paints with HeadlineKPIs immediately
4. <LazyMount> sees viewport, fires fetch('/api/forecast?from=…&to=…&track=bau&models=sarimax')
5. /api/forecast/+server.ts queries forecast_with_actual_v with RLS via supabase client
6. Postgres: forecast_with_actual_v → forecast_daily_mv (filtered by JWT) + kpi_daily_with_comparable_v
7. Endpoint returns { series: [{model:'sarimax', points:[...]}], meta: {last_refit, horizon_days} }
8. RevenueForecastCard renders LayerChart with actual line + SARIMAX BAU line + CI band
```

### Request flow — hover popup

```
1. User hovers a forecast point on the chart at target_date = 2026-05-12
2. Component already has yhat / yhat_lower / yhat_upper for that point (from step 8 above)
3. Component triggers ForecastHoverPopup with model='sarimax', target_date='2026-05-12'
4. Popup checks cache; if miss, fetches /api/forecast-quality?model=sarimax&kpi=revenue_eur
5. Endpoint reads forecast_quality_v WHERE evaluation_window='last_7_days' ORDER BY evaluated_at DESC LIMIT 1
6. Popup displays RMSE/MAPE/bias/direction-hit-rate alongside the local yhat + CI
7. (Cumulative deviation) — popup also fetches /api/campaign-uplift?model=sarimax for the cum-uplift-since-launch row
```

### Nightly write flow (full pipeline)

```
T-1 day, 23:59 Berlin: orderbird scraper completes, writes transactions
T   day, 02:30 UTC = 03:30 CEST / 04:30 CET:
  external-data-refresh.yml runs:
    weather_fetch.py: Open-Meteo backfill since last fetch + 7d future, upsert weather_daily
    holidays_seed.py: idempotent reseed (cheap), upsert holidays + school_holidays
    transit_alerts_fetch.py: BVG RSS poll, upsert transit_alerts
    recurring_events_seed.py: idempotent reload, upsert recurring_events
    EVERY script writes pipeline_runs row
T   day, 01:00 UTC = 03:00 CEST / 02:00 CET (per DST fix above):
  forecast-refresh.yml runs:
    fit_all.py:
      For each tenant, kpi in [revenue_eur, invoice_count, revenue_comparable_eur]:
        Build exog matrix from weather_daily + holidays + school_holidays + transit_alerts
                              + recurring_events + campaign_active_v + shop_calendar
        Fit SARIMAX, ETS, Theta, Naive on full history → write forecast_track='bau' rows
        (Optional behind flag) Fit Prophet, Chronos, NeuralProphet → write forecast_track='bau' rows
    counterfactual_fit.py:
      Fit each model on history WHERE date < min(campaign_calendar.start_date)
      Project 365d forward → write forecast_track='cf' rows
      Sample 1000 paths → write yhat_samples jsonb
    last_7_eval.py:
      For each model, refit 7× on T-7..T-1, predict T-6..T → upsert forecast_daily
      Compute trailing-7 RMSE/MAPE/bias → upsert forecast_quality (last_7_days, BAU only — NOT CF)
    cumulative_uplift.py:
      For each open campaign in campaign_calendar:
        Sum (actual - cf_yhat) over campaign window
        MC sample 1000 cumulative-uplift paths → percentiles → write campaign_uplift_v inputs
  EVERY script writes pipeline_runs row
T   day, 03:30 Berlin:
  pg_cron job 'refresh-forecast-mv':
    REFRESH MATERIALIZED VIEW CONCURRENTLY forecast_daily_mv;
T   day, 03:00 UTC (existing):
  pg_cron job 'refresh-analytics-mvs':
    refresh cohort_mv, kpi_daily_mv, ...
T   day, friend opens dashboard at 12:00 Berlin:
  All MVs are fresh (≤9h stale); chart loads via Pattern 8.
```

---

## Build Order — Phase Sequence Recommendation

| Phase | Scope | Why this order |
|-------|-------|----------------|
| **12.0 — Foundation** | Lock decisions D-01..D-12 in `12-0-CONTEXT.md`. Move `tools/its_validity_audit.py` into the repo. **NO migrations, NO Python.** | Discuss-phase only artifact; the proposal §2 is explicit. ITS audit script port is the one piece of code, and it depends on no new schema. |
| **12.1 — External data ingestion** | Migrations 0039–0045 (weather/holidays/school/transit/events/external-data-views/pipeline_runs). Python fetchers. `external-data-refresh.yml`. Backfill from 2025-06-11. | Forecast Python in 12.2 reads these tables. Order is forced. |
| **12.2 — Forecasting engine (BAU only)** | Migrations 0046–0055 (shop_calendar/campaign_calendar/campaign_active_v/baseline_items_v/kpi_daily_with_comparable_v/forecast_daily/forecast_daily_mv/forecast_with_actual_v/forecast_quality/forecast_quality_v). SARIMAX/ETS/Theta/Naive only — Prophet behind flag, no Track-B yet. `forecast-refresh.yml` (BAU only). `last_7_eval.py`. | Track-B (12.4) requires `campaign_calendar` populated AND BAU forecast already proven. Can ship BAU + chart UI to friend in 1 week, get the visceral "now I see a forecast" feedback before adding causal claims. |
| **12.3 — Forecast chart UI (BAU only)** | All 6 new components. `/api/forecast/+server.ts`, `/api/forecast-quality/+server.ts`. Modify dashboard `+page.svelte`. Mobile QA at 375px. | Reads from 12.2's `forecast_with_actual_v`. Can run **partially in parallel with 12.2** if we mock `forecast_daily` rows during 12.3 component development — but the migrations and Python in 12.2 must land first or the UI has nothing to render. **Recommend: 12.2 ships migrations + one model (SARIMAX), then 12.3 starts in parallel with 12.2's other models.** |
| **12.4 — Track-B + uplift attribution** | Migration 0056 (campaign_uplift_v) + 0057 (feature_flags) + 0058 (recurring_events_reminder_cron). `counterfactual_fit.py`, `cumulative_uplift.py`. `/api/campaign-uplift/+server.ts`, `CampaignUpliftCard.svelte`, `EventMarker.svelte`. Seed `campaign_calendar` with the 2026-04-14 campaign. | MUST come AFTER 12.3 because the cumulative-deviation field in the hover popup and the CampaignUpliftCard depend on stable forecast_with_actual_v + UI scaffolding. Track-B is a nuanced causal claim — better to ship BAU first and let the friend see the chart works, then add the "is the campaign working?" overlay. |
| **12.5 — Backtest gate + alerting** | Migration 0059 (refresh function extension) + 0060 (REVOKE/GRANT cleanup). `forecast-quality-gate.yml`, `test_backtest_gate.py`, `backtest.py` (rolling-origin CV). `docs/forecast/ACCURACY-LOG.md`. | The gate needs ≥4 weeks of actual forecast vs actual data to compute meaningful CV folds. Ship it last so the gate is meaningful from day 1 of its existence. |

### Parallelism opportunities

- **12.2 and 12.3 can overlap.** Once 12.2 lands `forecast_daily` schema + SARIMAX (the first model), the UI work in 12.3 can start against real data. The remaining 12.2 models (Prophet/Chronos/NeuralProphet) ship rows into the same schema; the chart picks them up via `models=` query param. Strict sequencing only between 12.2-01 (schema) and 12.3-01 (component skeleton).
- **12.4 cannot overlap with 12.3.** The CampaignUpliftCard layout and the hover-popup's "cum deviation" row both depend on the legend / horizon-toggle pattern being settled in 12.3. Build 12.3 cleanly, then 12.4.
- **12.5 cannot overlap with 12.2 or 12.3.** Needs accumulated history.

### Migration-order risk answers (specific to the question)

- **Q: If we add `forecast_daily` before `campaign_calendar`, can we still develop Track-B?**
  **A: Yes.** Track-B's training cutoff is just a date constant in `counterfactual_fit.py`. For the friend's situation, that constant is `2026-04-14` and is hard-coded for V1. `campaign_calendar` is needed to (a) populate `campaign_active_v` for the BAU `is_campaign` regressor, (b) compute `campaign_uplift_v`. Neither blocks Track-B fitting per se. **Recommend: ship `campaign_calendar` in 12.2 anyway** because BAU's `is_campaign` regressor needs it; without it, BAU model omits the campaign feature and its forecasts will be biased once a campaign is active.

- **Q: If `holidays` table arrives before SARIMAX exog regressors are wired, does forecast still work?**
  **A: Yes.** `holidays` is an additive exog regressor. `sarimax_fit.py` reads what it can find: if `holidays` exists, include it in the exog matrix; if not, skip. Same for weather. The fit converges either way — exog regressors improve forecast quality, they don't gate model fitting. Order migrations as listed (0039 holidays before 0051 forecast_daily) but treat exog wiring as **soft dependency**, not hard.

- **Q: If `shop_calendar` is empty (no manual is_open data), what happens?**
  **A: Backfill from history.** `shop_calendar` migration 0046 should include a backfill step: `INSERT INTO shop_calendar SELECT restaurant_id, generate_series, true FROM …` for every date in `kpi_daily_mv` where invoice_count > 0; flip Mon/Tue based on observed pattern of last 8 weeks. Future seed: assume same pattern. The friend manually flips days she knows she'll be away. Without `shop_calendar`, the 365d forecast predicts revenue for closed days — biased.

---

## Multi-Tenant Schema Decisions (Justified)

| Table | Scope | Justification |
|-------|-------|---------------|
| `weather_daily` | **Shared** (location-keyed) | Same Berlin weather applies to all current/future Berlin tenants. Cross-tenant deduplication. RLS `using (true)`. |
| `holidays`, `school_holidays` | **Shared** (country/state-keyed) | Same German holidays apply to all DE tenants. RLS `using (true)`. |
| `transit_alerts` | **Shared** (city-keyed implicit, BVG = Berlin) | Same. RLS `using (true)`. |
| `recurring_events` | **Shared** (city-keyed implicit) | One YAML to maintain. RLS `using (true)`. |
| `campaign_calendar` | **Tenant-scoped** (`tenant_id` = `restaurant_id`) | Each restaurant has its own marketing campaigns. RLS read = `restaurant_id` match; write = service_role + future admin role. |
| `shop_calendar` | **Tenant-scoped** | Each restaurant has its own opening hours / closures. RLS read = `restaurant_id` match. |
| `forecast_daily` | **Tenant-scoped** | Each restaurant gets its own forecast. RLS read = `restaurant_id` match. |
| `forecast_quality` | **Tenant-scoped** | Per-tenant per-model accuracy. RLS read = `restaurant_id` match. |
| `feature_flags` | **Tenant-scoped** | Per-tenant model enables. RLS read = `restaurant_id` match. |
| `pipeline_runs` | **Operational** (no RLS) | Service-role-only audit trail. `REVOKE ALL` from authenticated/anon. Read via Supabase Studio or admin tool. |
| `forecast_daily_mv` | **MV — REVOKE ALL from authenticated** | Per FND-04 / ANL-08 / D-04. Wrapper view `forecast_with_actual_v` is the only thing the app reads. |

**Standardization note:** the proposal sketches use `tenant_id`. This codebase's column and JWT claim are both `restaurant_id` (verified: migrations 0010, 0012, 0023; FND-03). **All v1.3 migrations MUST use `restaurant_id`** for column name AND JWT key. Plan-phase converts §7's `tenant_id` to `restaurant_id` mechanically.

---

## Scaling Considerations

| Scale | Architecture adjustments |
|-------|--------------------------|
| 1 tenant (V1, current) | Stack as proposed. Sample paths in jsonb. Granularity resample on-the-fly in `/api/forecast`. ~125 MB per tenant `yhat_samples` storage (per §18). Free tier comfortable. |
| 50 tenants | Per-tenant nightly forecast: ~50 × 10s × 5 models = ~40 min GHA compute. Within free tier. Open-Meteo single fetch covers all (shared). Storage: ~6 GB `yhat_samples` jsonb. Within Supabase Pro ($25/mo) — start considering compression or move samples to Supabase Storage as Parquet. |
| 100+ tenants | Re-evaluate Open-Meteo commercial tier. Pre-compute weekly/monthly aggregates in `forecast_weekly_mv` to cut `/api/forecast?granularity=week` load. Consider moving forecast Python from GHA to a dedicated Fly.io worker if GHA monthly minutes exceed 1500 (per §21). |

### Scaling priorities

1. **First bottleneck:** the `yhat_samples` jsonb column at ~125 MB/tenant/year. Acceptable for 1 tenant; revisit at 10+ tenants. Mitigation: drop sample paths older than 90 days, keep mean+CI only for archival.
2. **Second bottleneck:** `forecast-refresh.yml` GHA runtime as model count × tenant count grows. Mitigation: shard the workflow by tenant range (matrix builds), or move Python to a dedicated worker.
3. **Third bottleneck:** `/api/forecast` cold-start latency on CF Workers when sample-path resample for week/month granularity is on the hot path. Mitigation: pre-compute `forecast_weekly_mv` and `forecast_monthly_mv` in a separate pg_cron job.

---

## Anti-Patterns

### Anti-Pattern 1 — `tenant_id` instead of `restaurant_id` in v1.3 migrations
**What people do:** Copy the proposal's §7 SQL verbatim, which uses `tenant_id` and `auth.jwt()->>'tenant_id'`.
**Why it's wrong:** Existing migrations (0001 onward) use `restaurant_id` as the column name AND JWT claim key. `auth.jwt()->>'tenant_id'` returns NULL on every existing user's session → all RLS policies fail open or fail closed unpredictably.
**Do this instead:** Plan-phase mechanically renames `tenant_id` → `restaurant_id` in every §7/§13/§15 sketch before pasting into the migration file. CI grep-guard (ANL-09 pattern) for `auth.jwt()->>'tenant_id'` in migrations to catch regressions.

### Anti-Pattern 2 — Summing `yhat_lower` / `yhat_upper` for week/month CI
**What people do:** When user toggles granularity to week, sum the daily `yhat_lower` and `yhat_upper` to get weekly bounds.
**Why it's wrong:** CI bounds don't sum. The variance of a sum of correlated daily forecasts is NOT the sum of daily variances. Result: vastly overconfident weekly CI.
**Do this instead:** Read `yhat_samples jsonb` (1000 paths), sum across days within the bucket, take percentiles `[2.5, 97.5]`. Per §18.

### Anti-Pattern 3 — Direct query of `forecast_daily` (raw table) from SvelteKit load function
**What people do:** `from('forecast_daily').select('*')` in `+page.server.ts`.
**Why it's wrong:** RLS works (the policy filters by `restaurant_id`), but the SELECT is a full-table scan over all model_name × run_date rows — including stale runs. CF Workers CPU blow-up risk.
**Do this instead:** Always read `forecast_with_actual_v` (which goes through `forecast_daily_mv`, the latest-run collapse). Add ANL-09-style CI grep guard for `from('forecast_daily')` (raw table) and `from('forecast_daily_mv')` (raw MV) in `src/`.

### Anti-Pattern 4 — Track-B fit on data that includes campaign-active days
**What people do:** Reuse the BAU model orchestrator for Track-B and forget the cutoff filter.
**Why it's wrong:** The "uplift" label is justified IF AND ONLY IF Track-B is fit on pre-campaign-era only (per §11). With contaminated training data, "actual − Track-B" is no longer a causal estimate, and the entire CampaignUpliftCard is misleading.
**Do this instead:** `counterfactual_fit.py` is a SEPARATE script with a hard-coded `TRAIN_END = min(campaign_calendar.start_date) - 1`. Every CF refit writes `pipeline_runs.fit_train_end` — auditable. Plan-phase task: add a CI test that asserts `forecast_daily WHERE forecast_track='cf'` rows were written by `counterfactual_fit.py` (via `commit_sha` or a script tag in `pipeline_runs`).

### Anti-Pattern 5 — Running Track-B accuracy through `last_7_eval.py`
**What people do:** Loop over all models AND tracks in the trailing-7 evaluator.
**Why it's wrong:** Track-B's accuracy is **structurally unverifiable** past the campaign-start cutoff (per §13). Computing RMSE between Track-B and actual on post-cutoff days measures the campaign effect, not forecast error. Hover popup would show a "fake" RMSE.
**Do this instead:** `last_7_eval.py` skips `forecast_track='cf'`. Hover popup shows "unverifiable by construction" for Track-B accuracy.

### Anti-Pattern 6 — Closing the GHA → Python → DB loop in pg_cron
**What people do:** Try to schedule a Python job from pg_cron via `pg_net.http_post` to a long-running endpoint.
**Why it's wrong:** pg_cron jobs are single-statement; `pg_net.http_post` is fire-and-forget; Python forecast jobs take minutes, not milliseconds. Cascading failures, no retry, no logs.
**Do this instead:** Two schedulers, one DAG. GHA cron schedules Python; pg_cron schedules SQL refreshes. They communicate via `pipeline_runs` (Python writes status; SQL reads to decide if refresh should proceed). Alternative: pg_cron triggers Edge Function for trivial jobs (the YAML reminder), but never for forecasting.

### Anti-Pattern 7 — Showing all 5+ forecast lines on mobile by default
**What people do:** Render every model's line on the chart, leave the user to toggle off.
**Why it's wrong:** 375px iPhone screen + 5 colored lines = unreadable spaghetti. Per §22 ("Default UI defaults — KISS at the chart level"): default mobile is 1 line (actual) + 1 forecast (SARIMAX BAU) + CI band only.
**Do this instead:** `ForecastLegend.svelte` defaults all models except SARIMAX BAU to off. User opts in via legend chips. Verify at 375px before merge per UI-11.

---

## Integration Points

### External services

| Service | Integration pattern | Gotchas |
|---------|---------------------|---------|
| Open-Meteo | HTTPS GET, no API key, JSON. `weather_fetch.py` uses `requests` + retry-with-backoff. CC-BY 4.0 data. | "Non-commercial" ToS clause on the API itself (data is fine). Switch to Bright Sky if Ramen BONES incorporates. 16-day forecast horizon — fall back to climatological norm for >16d. |
| python-holidays (PyPI) | `pip install holidays`; in-process call, zero network. MIT. | Berlin Frauentag (since 2019) is in `holidays.Germany(prov='BE')`. |
| ferien-api.de | HTTPS GET REST JSON. MIT. State code `BE`. | Verify URL during research-phase. Alternative: `mehr-schulferien` if endpoint dies. |
| BVG RSS | HTTPS GET XML at `https://www.bvg.de/de/aktuelles?format=rss`. German keyword match (`Streik`, `Ausfälle`, `Betriebsstörung`). | URL **not yet verified** — open risk #1 (§12). Fallback: HTML scrape of BVG aktuelles page. |
| recurring_events.yaml | Source-controlled YAML in repo at `scripts/external/recurring_events.yaml`. ~15-20 events/year. | pg_cron Sept 15 reminder (§21). |
| Anthropic Claude API | (existing) Edge Function only — never client. Used by Phase 5 insights, NOT v1.3. | No change. |
| Cloudflare Pages | (existing) `adapter-cloudflare`, `platform.env` bindings, deferred endpoints. | Workers runtime ≠ Node — Date.now/fetch/Web Crypto only. |
| Supabase Postgres | (existing) RLS via `auth.jwt()->>'restaurant_id'`. service_role for cron writes. | pg_cron lives in Postgres; can't invoke Python (forecast jobs run on GHA). |
| GitHub Actions | (existing) Free unlimited for public repos. UTC cron. Service-role secret in `secrets.SUPABASE_SERVICE_ROLE_KEY`. | DST edge case on 03:00 Berlin schedule — use UTC-anchored cron with a comfortable gap (00:00 external, 01:00 forecast). |

### Internal boundaries

| Boundary | Communication | Considerations |
|----------|---------------|----------------|
| GHA scraper ↔ Supabase staging | service_role POST | Existing pattern. ING-02 idempotency. |
| GHA external-data fetcher ↔ Supabase shared tables | service_role POST | New. RLS bypassed via service_role. Idempotent upsert keyed by PK. |
| GHA forecast Python ↔ Supabase forecast tables | service_role POST | New. Reads `kpi_daily_with_comparable_v` + shared external-data tables; writes `forecast_daily` + `forecast_quality` + `pipeline_runs`. |
| GHA forecast Python ↔ Supabase via wrapper view | NOT recommended for writers | Writers should hit raw tables (with service_role); only the SvelteKit app reads via `_v` views. |
| pg_cron ↔ Supabase MVs | Internal SECURITY DEFINER function | Existing pattern (`refresh_analytics_mvs()`). Extend to also refresh `forecast_daily_mv`. |
| SvelteKit `+page.server.ts` ↔ Supabase | RLS-enforced via authenticated user JWT | Reads `*_v` only. Per ANL-08 / ANL-09. |
| SvelteKit `/api/*` deferred ↔ Supabase | Same authenticated client | Heavy reads happen here, not in `+page.server.ts`. Per Phase 11 lazy-mount pattern. |
| Component ↔ `/api/*` | `fetch()` from inside `<LazyMount>` | Defers JSON until viewport hits. |

---

## Specific Answers to Question §1–§5

**§1.1 (Schema — shared vs tenant-scoped for weather/holidays):** SHARED, location-keyed. RLS `using (true)`. Future-proof via `location` column on `restaurants`. Justified above (Pattern 1).

**§1.2 (`forecast_daily` long vs wide):** LONG, confirmed. Mandatory for backtest CV (multi `run_date`), for Track-A vs Track-B (extra dim), and for "last refit" being a row-level fact. Wide format would force `ALTER TABLE` per model.

**§1.3 (RLS wrapper for forecast tables):** Same pattern as existing MVs. `forecast_daily_mv` is `REVOKE ALL` from authenticated; `forecast_with_actual_v` is the wrapper that filters by `auth.jwt()->>'restaurant_id'` AND joins to `kpi_daily_with_comparable_v`. Multiple models in one row is NOT a problem because each row is a single `(model_name, forecast_track)` — there are N rows per (target_date, tenant).

**§1.4 (`campaign_calendar`):** Tenant-scoped, RLS read for tenant; writes via service_role / Supabase Studio for V1. Add admin write policy in v1.4 when `CampaignAdminForm.svelte` ships.

**§1.5 (Indexes):** As proposed in §7 plus:
- `forecast_daily(restaurant_id, kpi_name, target_date, model_name, forecast_track, run_date)` — composite primary key.
- `forecast_daily(restaurant_id, model_name, horizon_days)` — already in §7.
- `forecast_daily_mv` — UNIQUE index on `(restaurant_id, kpi_name, target_date, model_name, forecast_track)` mandatory for `REFRESH CONCURRENTLY`.
- `campaign_uplift_v` — this is a view; indexes belong on the underlying tables. `campaign_calendar(restaurant_id, start_date, end_date)` and `forecast_daily_mv` already covered.
- `forecast_quality(restaurant_id, kpi_name, model_name, evaluation_window, evaluated_at DESC)` — for fast hover popup query.

**§2.1 (Sequence external→forecast→MV):** external-data 00:00 UTC, forecast Python 01:00 UTC, forecast MV refresh 03:00 UTC (after forecast Python writes settled), analytics MV refresh 03:00 UTC (existing). DST-safe via UTC anchoring with a 1-hour gap.

**§2.2 (pg_cron + Python):** pg_cron CANNOT directly invoke Python. GHA runs Python; pg_cron handles SQL refreshes only. They share state via `pipeline_runs`.

**§2.3 (Failure mode for missing weather):** Climatological-norm fill (DoW × month historical mean) inside `weather_fetch.py`. Forecast at 03:00 keeps running with last-known weather + climate norm for missing days. UI badge "weather data: stale" if >36h. Never block.

**§3 (Build order):** 12.0 (decisions only) → 12.1 (ingestion) → 12.2 (BAU forecasting + chart-feeding views) → 12.3 (chart UI, partially in parallel with 12.2 after schema lands) → 12.4 (Track-B + uplift) → 12.5 (gate + alerting). Justified above.

**§4.1 (Sample-path resampling for granularity):** Server-side, on-the-fly inside `/api/forecast`. Don't refit on the client. Don't ship 1000 paths to the wire. Don't sum yhat_lower/yhat_upper.

**§4.2 (Memory at 365d × 1000 paths × N models on phone):** Phone never sees the paths. Server reads ~14 MB jsonb from Postgres, computes percentile aggregates, returns ~4 KB JSON.

**§4.3 (`/api/forecast` JSON shape):** Pre-aggregated at requested granularity. Endpoint accepts `from`, `to`, `granularity`, `models`, `track` query params. Server resamples paths if `granularity != 'day'`.

**§5.1 (forecast_daily before campaign_calendar):** Yes, Track-B development not blocked. But ship campaign_calendar in 12.2 anyway because BAU's `is_campaign` regressor needs it.

**§5.2 (holidays before SARIMAX exog wired):** Yes, forecast still works. Exog regressors are additive — model fits without them, just less accurate. Soft dependency, not hard.

---

## Sources

- `.planning/phases/12-forecasting-foundation/12-PROPOSAL.md` §2 (sub-phase breakdown), §7 (schema sketches), §8 (GHA cron pattern), §11 (NOT-do list), §12 (open risks), §13 (two-track architecture), §14 (failure modes / freshness SLO), §15 (supporting tables), §16 (backtest gate), §17 (last-7 hover-popup spec), §18 (per-model uplift CI sampling), §19 (per-phase acceptance tests), §20 (timezone/dates/money discipline), §21 (operating discipline), §22 (UI defaults).
- `.planning/PROJECT.md` lines 80–98 (current milestone definition).
- `.planning/REQUIREMENTS.md` (FND-03/04, ANL-08/09 — wrapper-view + REVOKE pattern that v1.3 inherits).
- `supabase/migrations/0012_leaf_views.sql` (verified the codebase uses `auth.jwt()->>'restaurant_id'`, NOT `tenant_id`).
- `supabase/migrations/0013_refresh_function_and_cron.sql` (verified existing pg_cron pattern: SECURITY DEFINER + REVOKE PUBLIC + service_role grant + idempotent unschedule).
- `supabase/migrations/0024_customer_ltv_mv.sql` (verified MV pattern: REVOKE from authenticated, wrapper `_v` view).
- Project memory: `feedback_localhost_first_ui_verify.md`, `project_silent_error_isolation.md`, `feedback_layerchart_mobile_scroll.md`, `project_cf_pages_stuck_recovery.md` (Phase 11 LazyMount + CF deployment lessons).

---

*Architecture research for: Ramen Bones Analytics v1.3 External Data & Forecasting Foundation*
*Researched: 2026-04-27*
