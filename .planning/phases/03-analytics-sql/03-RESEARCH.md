# Phase 3: Analytics SQL - Research

**Researched:** 2026-04-14
**Domain:** Postgres analytics (cohort/retention/LTV SQL, materialized views, pg_cron, RLS wrapper views)
**Confidence:** HIGH

## Summary

Phase 3 is almost entirely SQL on top of an already-stable data layer. Phase 1 established a canonical wrapper-view template (`supabase/migrations/0004_kpi_daily_mv_template.sql`) that MUST be copied verbatim — MV + unique index + `REVOKE ALL FROM anon, authenticated` + default-invoker wrapper view filtering on `auth.jwt()->>'restaurant_id'`. Phase 2 delivered `public.transactions` (invoice-grain, `gross_cents`/`net_cents`/`tip_cents`/`card_hash`/`occurred_at`/`payment_method`/`sales_type`) as the single source of truth — Phase 3 reads only this table for money and identity, never staging.

Three of the four hard-to-get-right things are already decided in CONTEXT.md: survivorship handling (NULL-mask past per-cohort horizon, D-08/D-09), April Worldline exclusion (identity metrics only, parameterize the range, D-06 — confirmed Phase 2 boundary is `2026-04-01..04-11` not the full month), and the "one sequential SECURITY DEFINER function, one pg_cron job" orchestration shape (D-20). What this research adds: concrete SQL patterns for each leaf view, the exact cohort_age_weeks horizon math, a fixture-builder strategy for the 3-customer retention test, and the CI guard regex extension.

**Primary recommendation:** Copy the 0004 template verbatim for `cohort_mv` and the replacement `kpi_daily_mv`. Build all four leaves as plain views reading from `cohort_mv` (`retention_curve_v`, `ltv_v`, `frequency_v`, `new_vs_returning_v`) plus the existing `kpi_daily_v`. Use `date_trunc('week', ... at time zone r.timezone)` for cohort assignment to be timezone-correct. Parameterize the April blackout as a SQL constant (inline `WHERE`) in the `cohort_mv` source CTE — no `data_quality_exclusions` table in v1. Single `public.refresh_analytics_mvs()` SECURITY DEFINER function scheduled via `cron.schedule('refresh-analytics-mvs', '0 3 * * *', $$select public.refresh_analytics_mvs()$$)`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Cohort trunk (`cohort_mv`):**
- D-01: first-visit via pure `MIN(occurred_at) GROUP BY restaurant_id, card_hash`. Nightly full rebuild via `REFRESH MATERIALIZED VIEW CONCURRENTLY`. Late data shifting a cohort backward is CORRECT behavior, not a bug. No freeze-state table.
- D-02: all three grains (day/week/month) in ONE wide MV — not three MVs. Suggested columns: `restaurant_id uuid, card_hash text, first_visit_at timestamptz, first_visit_business_date date, cohort_day date, cohort_week date, cohort_month date, cohort_size_day int, cohort_size_week int, cohort_size_month int`. Unique index `(restaurant_id, card_hash)`.
- D-03: `cohort_mv` excludes `card_hash IS NULL` (cash). Cash revenue still appears in `kpi_daily_v`.
- D-04: UI default grain = **weekly**. MV stores all three so Phase 4 can toggle.
- D-05: NO minimum-cohort-size filter in SQL. Expose `cohort_size`, return every cohort. Filtering is a Phase 4 UI concern.

**April 2026 Worldline blackout:**
- D-06: April transactions excluded from identity metrics ONLY (`cohort_mv` + all leaves that inherit from it). NOT excluded from `kpi_daily_v` (cash + non-Worldline card revenue is unaffected). Implementation: predicate in `cohort_mv` source CTE. **Parameterize** the range (SQL constant or `data_quality_exclusions` table — planner picks). **gsd-planner MUST confirm exact dates against 02-04-SUMMARY.md before hardcoding.** (Confirmed below: Phase 2 scoped reporting to `[2025-06-11, 2026-03-31]` Berlin → blackout window is `2026-04-01..2026-04-11` per 02-04 decisions.)
- D-07: Exclusion implemented ONCE in `cohort_mv` source CTE; every leaf reads from `cohort_mv` so inheritance guarantees no leak.

**Survivorship guard:**
- D-08: NULL-mask past per-cohort horizon. `retention_curve_v` / `ltv_v` return a row for every `(cohort, period)` pair; metric column is NULL past horizon. LayerChart draws natural gaps in Phase 4.
- D-09: Horizon is **per-cohort** = `now() - cohort_start`. Not a global shortest-cohort clip.
- D-10: Expose `cohort_age_weeks` (or equivalent for selected grain) so Phase 4 can render a boundary line.
- D-11: LTV = `SUM(revenue_cents) / cohort_size` up to period p. Average LTV per acquired customer. Cumulative total NOT exposed.

**Metric definitions:**
- D-12: `frequency_v` → fixed buckets `1`, `2`, `3–5`, `6–10`, `11+`. One row per bucket with `customer_count` + `revenue_cents`.
- D-13: `new_vs_returning_v` uses **first-ever-visit split** (no 60-day window). For each `business_date`: new = customers whose first-ever visit is that date; returning = visited before.
- D-14: `new_vs_returning_v` has a **third bucket `cash_anonymous`**. Revenue tie-out: `new + returning + cash_anonymous = kpi_daily_v.revenue_cents` for the same business_date. Tested via D-26 #3.
- D-15: `kpi_daily_mv` real body columns: `restaurant_id, business_date, revenue_cents (sum gross_cents), tx_count, avg_ticket_cents`. Unique index `(restaurant_id, business_date)` (already declared in 0004 — reuse). `business_date` via `AT TIME ZONE r.timezone`.

**View shape:**
- D-16: ONLY two MVs (`cohort_mv` new, `kpi_daily_mv` replace body). Every leaf is a plain view reading from `cohort_mv` + `transactions`. Revisit only on Phase 4 perf walls.
- D-17: Every MV follows `0004_kpi_daily_mv_template.sql` EXACTLY: MV + unique index + `REVOKE ALL FROM anon, authenticated` + wrapper view with `WHERE restaurant_id::text = (auth.jwt()->>'restaurant_id')`. **No SECURITY DEFINER functions. No overriding the default invoker mode on wrapper views** (silent-leak failure mode per 01-RESEARCH Pitfall A).
- D-18: Every plain leaf view also enforces `WHERE restaurant_id::text = (auth.jwt()->>'restaurant_id')` (defense-in-depth).
- D-19: Leaves `GRANT SELECT TO authenticated`. Raw MVs stay `REVOKE ALL`.

**pg_cron orchestration:**
- D-20: ONE pg_cron job, ONE SECURITY DEFINER function, sequential refresh. `cron.schedule('refresh-analytics-mvs', '0 3 * * *', 'SELECT public.refresh_analytics_mvs();')`. Function body: `REFRESH MV CONCURRENTLY cohort_mv;` then `REFRESH MV CONCURRENTLY kpi_daily_mv;`.
- D-21: Schedule `'0 3 * * *'` = 03:00 UTC = 05:00 Europe/Berlin. Stored in migration file.
- D-22: Refresh failures tracked via built-in `cron.job_run_details`. No custom `mv_refresh_log` table in v1.
- D-23: `refresh_analytics_mvs()` is SECURITY DEFINER, owned by postgres, granted only to `postgres` / `service_role`, revoked from `anon` / `authenticated`.

**CI guard extension:**
- D-24: Extend existing guard 1 in `scripts/ci-guards.sh` to also match `cohort_mv`, raw `transactions`, and `stg_orderbird_order_items` from `src/`. Regex suggestion: `(cohort_mv|kpi_daily_mv|\btransactions\b|stg_orderbird_order_items)`. Migrations/tests/scripts exempt.
- D-25: Guard asserted in Phase 3 CI run — not deferred. ANL-09 provably satisfied before phase close.

**Testing (D-26):** 8 integration tests in Vitest against TEST Supabase project:
1. Fixture correctness (3 known customers, right cohort at all 3 grains)
2. RLS / wrapper tenancy (every `*_v` scoped, raw `*_mv` returns 0/error)
3. Tie-out (`kpi_daily_v.revenue_cents` == sum of 3 `new_vs_returning_v` buckets on same date)
4. Survivorship NULL-mask (youngest cohort NULL past horizon; oldest non-NULL up to now-cohort_start)
5. April exclusion (zero cohort rows in April; non-zero `kpi_daily_v` rows in April)
6. Cash exclusion (zero NULL card_hash in cohort_mv; positive revenue in kpi_daily_v for days with cash)
7. Refresh concurrent (function succeeds with concurrent SELECTs)
8. CI guard (fails on fake `src/lib/evil.ts` referencing `cohort_mv`, passes after removal)

D-27: Extend existing `tests/integration/tenant-isolation.test.ts`. Phase 1 skipped UAT tests 3/4/5 stay deferred (separate TEST project blocker unchanged).

### Claude's Discretion

- Exact wrapper view names when collisions possible (`cohort_v` exists vs inlining)
- Whether `cohort_mv` is single wide row or three pivoted views (D-02 suggests wide as starting point; benchmark if slow)
- April exclusion mechanism: hardcoded, SQL constant, or `data_quality_exclusions` table
- Migration file naming/splitting (likely `0010_cohort_mv.sql`, `0011_kpi_daily_mv_real.sql`, `0012_leaf_views.sql`, `0013_refresh_function_and_cron.sql`)
- `cohort_size_*` denominators: pre-compute in `cohort_mv` vs derive in leaves
- Leaf column naming (`period_number` vs `periods_since_first_visit` vs `week_offset`)
- Whether REFRESH CONCURRENTLY is called inside a transaction block in `refresh_analytics_mvs()` (docs recommend separate statements — see Pitfall 3 below)
- Exact 3-customer fixture profiles for test D-26 #1

### Deferred Ideas (OUT OF SCOPE)

- Materializing LTV / retention / frequency / new-vs-returning leaves (Phase 5 or Phase 4 if perf walls)
- Raw per-customer visit count view (`frequency_customer_v`)
- Active-60-day returning definition
- Cumulative cohort revenue total column in `ltv_v`
- `mv_refresh_log` custom table with alerting (Phase 5)
- Dashboard refresh-status UI (Phase 4 if friend asks)
- Cohort grain beyond day/week/month
- Chart horizon marker line (Phase 4 UI)
- Unblocking Phase 1 UAT tests 3/4/5 (separate TEST project still blocked)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ANL-01 | `cohort_mv` — load-bearing trunk, first-visit cohort per card_hash, day/week/month grain | SQL pattern below (Pattern 1); reuses 0004 template shape |
| ANL-02 | `retention_curve_v` wrapper — retention by cohort × periods-since-first-visit with survivorship guard | Pattern 3 (NULL-masked per-cohort horizon) |
| ANL-03 | `ltv_v` — LTV-to-date per cohort with data-depth caveat | Pattern 4 (avg-per-acquired-customer, same horizon NULL-mask) |
| ANL-04 | `kpi_daily_mv` / `kpi_daily_v` — revenue, tx_count, avg_ticket per business_date | Pattern 2 (replaces 0004 placeholder body) |
| ANL-05 | `frequency_v` — repeat visit rate + visit-frequency distribution | Pattern 5 (fixed buckets 1/2/3–5/6–10/11+) |
| ANL-06 | `new_vs_returning_v` — revenue + tx_count split first-time vs repeat | Pattern 6 (+ cash_anonymous bucket for tie-out) |
| ANL-07 | All MVs nightly `REFRESH CONCURRENTLY` via pg_cron, unique index mandatory | Pattern 7 (single SECURITY DEFINER function + cron.schedule) |
| ANL-08 | Frontend reads ONLY `*_v` wrapper views; raw tables/MVs `REVOKE ALL FROM authenticated` | Canonical 0004 template — no deviation (Pitfall 2) |
| ANL-09 | CI grep check fails build on frontend queries hitting raw MVs or tables | `scripts/ci-guards.sh` guard 1 regex extension (Pattern 8) |
</phase_requirements>

## Standard Stack

All stack choices are locked by Phase 1. Phase 3 adds zero new dependencies. Tools listed are already in the project.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Supabase Postgres | 15+ | MV host, pg_cron extension, RLS | Already the project's only datastore |
| pg_cron | extension | Nightly MV refresh scheduler | Built into Supabase, enabled via Dashboard → Database → Extensions; system tables `cron.job` + `cron.job_run_details` |
| Vitest | 3.x | Integration tests against TEST project | Phase 1/2 precedent; `tests/integration/*.test.ts` pattern |
| @supabase/supabase-js | 2.103.x | Admin + tenant test clients | `tests/helpers/supabase.ts` already provides factories |

### Supporting
None. No npm additions. No Python changes. All work is SQL migration files.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain views reading from `cohort_mv` | Four additional MVs (one per leaf) | More refresh orchestration, four more unique indexes, four more wrapper views. Premature per D-16 at 6,842 tx scale. Revisit on Phase 4 perf walls. |
| Inline SQL constant for April range | `data_quality_exclusions` table | Table is cleaner for future blackouts but adds a migration + seed + Phase 4 visibility. v1 has exactly one blackout — inline constant is proportional. |
| SECURITY DEFINER wrapper function (the generic Supabase pattern from discussion #17790) | Default-invoker wrapper view over REVOKE'd MV (Phase 1 canonical) | Phase 1 explicitly chose wrapper-view-with-default-invoker and documented the silent-leak failure mode. D-17 forbids deviation. |

**Installation:**
```bash
# pg_cron already enabled on Supabase project (verify in Dashboard → Database → Extensions)
# No npm / pip installs. All work is in supabase/migrations/*.sql
```

**Version verification:** N/A — no new packages.

## Architecture Patterns

### Recommended Migration Layout
```
supabase/migrations/
├── 0010_cohort_mv.sql                    # create materialized view + unique index + REVOKE + wrapper
├── 0011_kpi_daily_mv_real.sql            # drop + recreate kpi_daily_mv body (replaces 0004 placeholder)
├── 0012_leaf_views.sql                   # retention_curve_v, ltv_v, frequency_v, new_vs_returning_v
├── 0013_refresh_function_and_cron.sql    # refresh_analytics_mvs() SECURITY DEFINER + cron.schedule()
```

Each migration is one logical concern (Phase 2 precedent). One transaction per migration where practical.

### Pattern 1: `cohort_mv` — the trunk

Per-tenant timezone is mandatory (FND-08 / Phase 1 D-09). `date_trunc` must happen AFTER the timezone conversion or Monday-week boundaries drift.

```sql
-- 0010_cohort_mv.sql
create materialized view public.cohort_mv as
with filtered_tx as (
  select
    t.restaurant_id,
    t.card_hash,
    t.occurred_at,
    (t.occurred_at at time zone r.timezone)::date as business_date,
    t.gross_cents
  from public.transactions t
  join public.restaurants r on r.id = t.restaurant_id
  where t.card_hash is not null                                -- D-03: exclude cash
    and not (                                                   -- D-06: April Worldline blackout
      t.occurred_at >= '2026-04-01 00:00:00+00'
      and t.occurred_at <  '2026-04-12 00:00:00+00'
    )
),
first_visits as (
  select
    restaurant_id,
    card_hash,
    min(occurred_at) as first_visit_at
  from filtered_tx
  group by restaurant_id, card_hash
),
enriched as (
  select
    fv.restaurant_id,
    fv.card_hash,
    fv.first_visit_at,
    (fv.first_visit_at at time zone r.timezone)::date                              as first_visit_business_date,
    (fv.first_visit_at at time zone r.timezone)::date                              as cohort_day,
    date_trunc('week',  fv.first_visit_at at time zone r.timezone)::date           as cohort_week,
    date_trunc('month', fv.first_visit_at at time zone r.timezone)::date           as cohort_month
  from first_visits fv
  join public.restaurants r on r.id = fv.restaurant_id
)
select
  e.restaurant_id,
  e.card_hash,
  e.first_visit_at,
  e.first_visit_business_date,
  e.cohort_day,
  e.cohort_week,
  e.cohort_month,
  count(*) over (partition by e.restaurant_id, e.cohort_day)   as cohort_size_day,
  count(*) over (partition by e.restaurant_id, e.cohort_week)  as cohort_size_week,
  count(*) over (partition by e.restaurant_id, e.cohort_month) as cohort_size_month
from enriched e;

-- MANDATORY unique index for REFRESH CONCURRENTLY (D-08 from Phase 1)
create unique index cohort_mv_pk on public.cohort_mv (restaurant_id, card_hash);

-- Lock raw MV (D-07 / D-19)
revoke all on public.cohort_mv from anon, authenticated;

-- Wrapper view (D-17 — exact template, default invoker mode)
create view public.cohort_v as
select
  restaurant_id,
  card_hash,
  first_visit_at,
  first_visit_business_date,
  cohort_day,
  cohort_week,
  cohort_month,
  cohort_size_day,
  cohort_size_week,
  cohort_size_month
from public.cohort_mv
where restaurant_id::text = (auth.jwt()->>'restaurant_id');

grant select on public.cohort_v to authenticated;
```

**Why window functions for `cohort_size_*`:** pre-computing in the MV means leaves divide without running another `count(*) over` every query. Cost is paid once at refresh time.

### Pattern 2: `kpi_daily_mv` real body (replaces 0004 placeholder)

0004 declared the MV + unique index + REVOKE + wrapper; Phase 3 replaces ONLY the body. Because `create materialized view` is not idempotent, do `drop materialized view ... cascade; create materialized view ...` in 0011, then recreate the unique index and wrapper view.

```sql
-- 0011_kpi_daily_mv_real.sql
drop materialized view public.kpi_daily_mv cascade;   -- cascades kpi_daily_v; we recreate it

create materialized view public.kpi_daily_mv as
select
  t.restaurant_id,
  (t.occurred_at at time zone r.timezone)::date         as business_date,
  sum(t.gross_cents)::numeric                           as revenue_cents,
  count(*)::int                                         as tx_count,
  case when count(*) = 0 then null
       else (sum(t.gross_cents)::numeric / count(*)) end as avg_ticket_cents
from public.transactions t
join public.restaurants r on r.id = t.restaurant_id
group by t.restaurant_id, (t.occurred_at at time zone r.timezone)::date;

-- NOT filtered for April or cash (D-06, D-15) — kpi_daily stays inclusive.

create unique index kpi_daily_mv_pk on public.kpi_daily_mv (restaurant_id, business_date);
revoke all on public.kpi_daily_mv from anon, authenticated;

create view public.kpi_daily_v as
select restaurant_id, business_date, revenue_cents, tx_count, avg_ticket_cents
from public.kpi_daily_mv
where restaurant_id::text = (auth.jwt()->>'restaurant_id');

grant select on public.kpi_daily_v to authenticated;
```

**⚠ cascade side-effect:** dropping `kpi_daily_mv` cascades to `kpi_daily_v` AND to the existing `public.refresh_kpi_daily_mv()` test helper in `0006_test_helpers.sql`. Recreate both in 0011, OR update 0006_test_helpers to call the new `refresh_analytics_mvs()` wrapper. Planner must handle this explicitly — integration tests in `tests/integration/tenant-isolation.test.ts` call `admin.rpc('refresh_kpi_daily_mv')` in `beforeAll`.

### Pattern 3: `retention_curve_v` with per-cohort horizon NULL-mask (D-08/D-09/D-10)

Retention math: for each cohort and each period p (weeks since first visit), the retention rate is the fraction of the cohort that has at least one transaction in week p.

The conceptual matrix is `(cohort, period)` for every `(c, p)` pair. `NULL` out any cell where `p > now() - cohort_start` (in weeks). Generate the full matrix via `generate_series`, `LEFT JOIN` the observed retention, and apply the mask.

```sql
-- 0012_leaf_views.sql (excerpt)
create view public.retention_curve_v as
with cohorts as (
  select distinct restaurant_id, cohort_week, cohort_size_week
  from public.cohort_mv
  where restaurant_id::text = (auth.jwt()->>'restaurant_id')  -- D-18 defense-in-depth
),
max_period as (
  -- largest period we'll ever need — bounded by project history (~10mo → ~44w) + headroom
  select generate_series(0, 52) as period_weeks
),
visits as (
  -- period index = weeks between tx and customer's first visit
  select
    c.restaurant_id,
    c.cohort_week,
    floor(extract(epoch from (t.occurred_at - c.first_visit_at)) / (7 * 86400))::int as period_weeks,
    c.card_hash
  from public.cohort_mv c
  join public.transactions t
    on t.restaurant_id = c.restaurant_id
   and t.card_hash     = c.card_hash
  where c.restaurant_id::text = (auth.jwt()->>'restaurant_id')
    and not (                                                   -- same April exclusion as cohort_mv
      t.occurred_at >= '2026-04-01 00:00:00+00'
      and t.occurred_at <  '2026-04-12 00:00:00+00'
    )
),
observed as (
  select
    restaurant_id,
    cohort_week,
    period_weeks,
    count(distinct card_hash) as retained
  from visits
  group by restaurant_id, cohort_week, period_weeks
)
select
  c.restaurant_id,
  c.cohort_week,
  c.cohort_size_week,
  mp.period_weeks,
  -- NULL-mask past the cohort's own observable horizon (D-09)
  case
    when mp.period_weeks > floor(extract(epoch from (now() - c.cohort_week::timestamptz)) / (7 * 86400))::int
      then null
    else coalesce(o.retained, 0)::numeric / nullif(c.cohort_size_week, 0)
  end as retention_rate,
  -- expose horizon for Phase 4 boundary-line rendering (D-10)
  floor(extract(epoch from (now() - c.cohort_week::timestamptz)) / (7 * 86400))::int as cohort_age_weeks
from cohorts c
cross join max_period mp
left join observed o
  on  o.restaurant_id = c.restaurant_id
  and o.cohort_week   = c.cohort_week
  and o.period_weeks  = mp.period_weeks;

grant select on public.retention_curve_v to authenticated;
```

Note: `c.cohort_week::timestamptz` uses the session timezone. Since this expression runs inside the view at query time and we only need week-resolution for horizon math, the off-by-a-few-hours drift is fine. For stricter correctness, store the cohort start as a `timestamptz` anchor column in `cohort_mv` — planner's call.

### Pattern 4: `ltv_v` with same horizon NULL-mask

```sql
create view public.ltv_v as
with cohorts as (
  select distinct restaurant_id, cohort_week, cohort_size_week
  from public.cohort_mv
  where restaurant_id::text = (auth.jwt()->>'restaurant_id')
),
periods as (select generate_series(0, 52) as period_weeks),
cohort_revenue as (
  -- cumulative revenue per cohort up to each period
  select
    c.restaurant_id,
    c.cohort_week,
    floor(extract(epoch from (t.occurred_at - c.first_visit_at)) / (7 * 86400))::int as period_weeks,
    sum(t.gross_cents) as period_revenue_cents
  from public.cohort_mv c
  join public.transactions t
    on t.restaurant_id = c.restaurant_id
   and t.card_hash     = c.card_hash
  where not (
    t.occurred_at >= '2026-04-01 00:00:00+00'
    and t.occurred_at <  '2026-04-12 00:00:00+00'
  )
  group by c.restaurant_id, c.cohort_week, 3
)
select
  c.restaurant_id,
  c.cohort_week,
  c.cohort_size_week,
  p.period_weeks,
  case
    when p.period_weeks > floor(extract(epoch from (now() - c.cohort_week::timestamptz)) / (7 * 86400))::int
      then null
    else (
      -- cumulative sum through period p, divided by cohort size
      coalesce((
        select sum(cr.period_revenue_cents)
        from cohort_revenue cr
        where cr.restaurant_id = c.restaurant_id
          and cr.cohort_week   = c.cohort_week
          and cr.period_weeks <= p.period_weeks
      ), 0)::numeric / nullif(c.cohort_size_week, 0)
    )
  end as ltv_cents,
  floor(extract(epoch from (now() - c.cohort_week::timestamptz)) / (7 * 86400))::int as cohort_age_weeks
from cohorts c
cross join periods p;

grant select on public.ltv_v to authenticated;
```

Correlated subquery is fine for this size; planner may rewrite as a window-function `SUM() OVER (... ORDER BY period_weeks ROWS UNBOUNDED PRECEDING)` for elegance. Same output.

### Pattern 5: `frequency_v` fixed buckets (D-12)

```sql
create view public.frequency_v as
with my_cohort as (
  select * from public.cohort_mv
  where restaurant_id::text = (auth.jwt()->>'restaurant_id')
),
visits_per_customer as (
  select
    c.restaurant_id,
    c.card_hash,
    count(*) as visit_count,
    sum(t.gross_cents) as revenue_cents
  from my_cohort c
  join public.transactions t
    on t.restaurant_id = c.restaurant_id
   and t.card_hash     = c.card_hash
  where not (
    t.occurred_at >= '2026-04-01 00:00:00+00'
    and t.occurred_at <  '2026-04-12 00:00:00+00'
  )
  group by c.restaurant_id, c.card_hash
),
bucketed as (
  select
    restaurant_id,
    case
      when visit_count = 1             then '1'
      when visit_count = 2             then '2'
      when visit_count between 3 and 5 then '3-5'
      when visit_count between 6 and 10 then '6-10'
      else '11+'
    end as bucket,
    case
      when visit_count = 1             then 1
      when visit_count = 2             then 2
      when visit_count between 3 and 5 then 3
      when visit_count between 6 and 10 then 4
      else 5
    end as bucket_order,
    revenue_cents
  from visits_per_customer
)
select
  restaurant_id,
  bucket,
  bucket_order,
  count(*)::int           as customer_count,
  sum(revenue_cents)::numeric as revenue_cents
from bucketed
group by restaurant_id, bucket, bucket_order
order by bucket_order;

grant select on public.frequency_v to authenticated;
```

`bucket_order` column is exposed so Phase 4 doesn't have to maintain a second ordering dictionary.

### Pattern 6: `new_vs_returning_v` with `cash_anonymous` tie-out bucket (D-13/D-14)

This is the trickiest leaf — must tie out to `kpi_daily_v.revenue_cents`.

```sql
create view public.new_vs_returning_v as
with carded as (
  select
    t.restaurant_id,
    (t.occurred_at at time zone r.timezone)::date as business_date,
    t.card_hash,
    t.gross_cents,
    c.first_visit_business_date
  from public.transactions t
  join public.restaurants r on r.id = t.restaurant_id
  left join public.cohort_mv c
    on c.restaurant_id = t.restaurant_id
   and c.card_hash     = t.card_hash
  where t.card_hash is not null
),
carded_split as (
  select
    restaurant_id,
    business_date,
    case
      when first_visit_business_date = business_date then 'new'
      when first_visit_business_date is null         then 'new'   -- April blackout cohort rows missing → treat as new
      else 'returning'
    end as bucket,
    gross_cents
  from carded
),
cash as (
  select
    t.restaurant_id,
    (t.occurred_at at time zone r.timezone)::date as business_date,
    'cash_anonymous'::text as bucket,
    t.gross_cents
  from public.transactions t
  join public.restaurants r on r.id = t.restaurant_id
  where t.card_hash is null
),
combined as (
  select * from carded_split
  union all
  select * from cash
)
select
  restaurant_id,
  business_date,
  bucket,
  count(*)::int                                      as tx_count,
  sum(gross_cents)::numeric                          as revenue_cents
from combined
where restaurant_id::text = (auth.jwt()->>'restaurant_id')
group by restaurant_id, business_date, bucket;

grant select on public.new_vs_returning_v to authenticated;
```

**⚠ April reconciliation gotcha:** In April, `cohort_mv` has no rows for carded customers (D-06 exclusion), so `first_visit_business_date IS NULL` for every April carded row. The snippet above treats those as `'new'`, which preserves revenue tie-out but gives April a (wrong but identified) "all new" look. **Planner must decide:** either (a) add a fourth bucket `blackout_unknown` for April carded revenue, or (b) accept the "all new" framing with a Phase 4 UI caveat. Option (a) is more honest but breaks the 3-bucket tie-out test D-26 #3. Option (b) keeps the tie-out clean but misrepresents April identity.

Recommend option (a) with test D-26 #3 sum rewritten to `sum(new + returning + cash_anonymous + blackout_unknown)`.

### Pattern 7: pg_cron + single orchestration function (D-20 through D-23)

```sql
-- 0013_refresh_function_and_cron.sql
create or replace function public.refresh_analytics_mvs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Per Postgres docs: REFRESH MATERIALIZED VIEW CONCURRENTLY cannot run inside
  -- a transaction that already holds a write lock on the MV. plpgsql functions
  -- run each statement in its own sub-transaction, which is fine. Do NOT wrap
  -- these in BEGIN/COMMIT — that's a pitfall below.
  refresh materialized view concurrently public.cohort_mv;
  refresh materialized view concurrently public.kpi_daily_mv;
end;
$$;

revoke all on function public.refresh_analytics_mvs() from public, anon, authenticated;
grant execute on function public.refresh_analytics_mvs() to service_role;

-- Schedule (03:00 UTC = 05:00 Europe/Berlin)
-- pg_cron's cron.schedule returns the jobid. Idempotent via cron.unschedule-by-name.
select cron.unschedule('refresh-analytics-mvs')
  where exists (select 1 from cron.job where jobname = 'refresh-analytics-mvs');

select cron.schedule(
  'refresh-analytics-mvs',
  '0 3 * * *',
  $$select public.refresh_analytics_mvs();$$
);
```

**Observability query** (founder copies to SQL editor when numbers look stale):
```sql
select
  j.jobname,
  d.start_time,
  d.end_time,
  d.status,
  d.return_message
from cron.job j
join cron.job_run_details d on d.jobid = j.jobid
where j.jobname = 'refresh-analytics-mvs'
order by d.start_time desc
limit 20;
```

`cron.job` stores schedule metadata; `cron.job_run_details` stores execution history with `status IN ('starting','running','succeeded','failed')` and `return_message` for error text. Schema: `cron`, extension: `pg_cron` (enable via Supabase Dashboard → Database → Extensions if not already on — check in pre-flight).

### Pattern 8: CI guard regex extension (D-24/D-25)

Existing guard 1 in `scripts/ci-guards.sh`:
```bash
if grep -rnE '\b[a-z_]+_mv\b' src/ 2>/dev/null; then
```

This already catches any `*_mv` including `cohort_mv` and `kpi_daily_mv`. Phase 3 only needs to add raw-table detection:

```bash
# Guard 1 (D-14.1 + Phase 3 D-24): No raw _mv or raw analytics-source-table refs from src/.
if [ -d src ]; then
  if grep -rnE '\b([a-z_]+_mv|transactions|stg_orderbird_order_items)\b' src/ 2>/dev/null; then
    echo "::error::Guard 1 FAILED: src/ references a materialized view or raw table directly. Use the *_v wrapper views."
    fail=1
  fi
fi
```

**⚠ False positive risk:** `\btransactions\b` will match legitimate uses like the word "transactions" in comments or variable names (`const transactionCount = ...`). Tighten to only match SQL-table-ish contexts:

```bash
grep -rnE "from\s+['\"]?transactions['\"]?|\.from\(['\"]transactions['\"]\)|\btransactions_(mv|v)\b|\bstg_orderbird_order_items\b|\b[a-z_]+_mv\b" src/
```

The `.from('transactions')` Supabase-js pattern is the realistic attack surface — that's what a Phase 4 dev would write if they forgot to use the wrapper. Planner can refine during plan check.

### Anti-Patterns to Avoid

- **SECURITY DEFINER function as the wrapper.** The generic Supabase-recommended pattern (discussion #17790) uses a SECDEF function returning `SETOF mv` behind a wrapper view. Phase 1 explicitly rejected this in favor of a plain view over a REVOKE'd MV with default invoker mode. Do not mix the two patterns — it silently leaks across tenants (01-RESEARCH.md Pitfall A).
- **`SELECT ... FROM transactions` in leaf views without `WHERE restaurant_id::text = (auth.jwt()->>'restaurant_id')`.** Even though `transactions` has an RLS policy (`tx_tenant_read`), plain views default to `security invoker`, so the policy IS applied at query time — but defense-in-depth per D-18 means we write the filter explicitly anyway. Cheap and lets downstream leaves survive a `tx_tenant_read` policy regression.
- **`SUM(tip_eur)` from `stg_orderbird_order_items`.** Phase 2 D-12 forbids this. All money comes from `public.transactions.gross_cents` / `tip_cents` / `net_cents`.
- **Inline `REFRESH MATERIALIZED VIEW CONCURRENTLY` in a `BEGIN ... COMMIT` block.** See Pitfall 3.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "Did the MV refresh last night?" | Custom `mv_refresh_log` table + trigger + email alert | `cron.job_run_details` (built-in) | pg_cron already records `start_time`, `end_time`, `status`, `return_message`. v1 alerting is Phase 5. |
| "What period is this tx in relative to first visit?" | Manual week-bucketing in application code | `floor(extract(epoch from (tx - first_visit)) / (7*86400))` in SQL | Already inside the view so RLS and horizon masking work together. |
| "Generate all (cohort, period) pairs even when empty" | Application-side pivot | `generate_series(0, N) CROSS JOIN cohorts LEFT JOIN observed` | Postgres idiom; handles empty cohorts and survivorship nulls cleanly. |
| "Scheduled job runner" | GitHub Actions cron hitting a Supabase function | pg_cron extension | In-DB, no egress, no secrets, already installed. |
| "RLS on MV" | `ALTER MATERIALIZED VIEW ENABLE ROW LEVEL SECURITY` | Wrapper view pattern (Phase 1 canonical) | Postgres doesn't support RLS directly on MVs (confirmed via discussion #17790). |
| "Tenant isolation test harness" | Build new one | Extend `tests/integration/tenant-isolation.test.ts` | D-27 mandates reuse. |

**Key insight:** Phase 3 is deliberately thin on custom infrastructure. Every "how do I..." has a canonical Phase 1 or Postgres answer. If you find yourself inventing something, you're probably deviating from D-17.

## Runtime State Inventory

> Skipped — Phase 3 is greenfield SQL with no renames/refactors of existing runtime state. Phase 2 left `transactions` stable; Phase 3 only reads it. Existing `kpi_daily_mv` placeholder is dropped-and-recreated within migration 0011 (not a rename), and the `refresh_kpi_daily_mv` test helper is the only other stateful artifact (see Pitfall 6).

## Common Pitfalls

### Pitfall 1: `date_trunc('week', ...)` BEFORE timezone conversion

**What goes wrong:** Every cohort boundary is off by several hours. A customer whose first visit is Sunday 23:30 Berlin lands in the WRONG cohort_week.

**Why it happens:** `date_trunc('week', t.occurred_at)` operates on UTC if `occurred_at` is `timestamptz`. Postgres truncates in the session timezone for `timestamp without time zone`, but not for `timestamptz` — it uses UTC unconditionally.

**How to avoid:** Always `date_trunc('week', t.occurred_at at time zone r.timezone)::date`. This is the same pattern Phase 1 D-09 nailed down for `business_date`; Phase 3 must apply it consistently.

**Warning signs:** Test D-26 #1 (three known customers) catches this — design fixture with at least one customer whose first visit is after 22:00 Berlin on a Sunday.

### Pitfall 2: Overriding default invoker mode on wrapper views

**What goes wrong:** Someone adds `with (security_invoker=true)` to a wrapper view thinking it's safer. Result: authenticated role now queries the MV as itself, not postgres; since MV has `REVOKE ALL`, all queries return zero rows. UI silently shows empty dashboard with no error.

**Why it happens:** `security_invoker=true` is the Postgres 15 default for views created without the option, but Supabase/PostgREST patterns sometimes recommend setting it explicitly. Phase 1 deliberately relies on default-invoker behavior where the view owner (postgres) has MV access.

**How to avoid:** NEVER set `security_invoker` on wrapper views. Copy 0004 verbatim. Test D-26 #2 catches this.

**Warning signs:** `kpi_daily_v` returning zero rows for an authenticated user who has a valid restaurant_id claim.

### Pitfall 3: `REFRESH MATERIALIZED VIEW CONCURRENTLY` inside an explicit transaction

**What goes wrong:** `REFRESH ... CONCURRENTLY` requires acquiring an `EXCLUSIVE` lock only briefly at the end of the refresh; if it's inside a `BEGIN ... COMMIT` that's already doing other writes on the MV, Postgres errors out or deadlocks.

**Why it happens:** plpgsql wraps function bodies in an implicit outer transaction. But each `REFRESH` statement inside plpgsql runs in its own savepoint, so for our SECURITY DEFINER function with nothing but two `REFRESH` statements it's safe. The pitfall is if someone later adds `BEGIN ... UPDATE ... REFRESH ... COMMIT` to the function.

**How to avoid:** Keep `refresh_analytics_mvs()` as just two `REFRESH` statements. No `BEGIN`/`COMMIT`, no other DML mixed in. If Phase 5 wants atomic refresh-and-log, use a separate function.

**Warning signs:** Test D-26 #7 (refresh with concurrent SELECTs) catches lock-ordering bugs.

### Pitfall 4: Dropping `kpi_daily_mv` cascades to Phase 1 test helpers

**What goes wrong:** Migration 0011 does `drop materialized view public.kpi_daily_mv cascade` to replace the placeholder body. This cascades to:
1. `public.kpi_daily_v` (the wrapper view — recreated in 0011, fine)
2. Any object depending on the MV

`public.refresh_kpi_daily_mv()` in `0006_test_helpers.sql` does NOT depend on the MV (function body is just a string `'refresh materialized view ...'` — no dependency). Safe. But the integration test `tests/integration/tenant-isolation.test.ts` calls `admin.rpc('refresh_kpi_daily_mv')` in `beforeAll` — this still works since the function name exists, but it now refreshes only `kpi_daily_mv` while Phase 3 also needs `cohort_mv` refreshed for downstream leaf tests.

**How to avoid:** In 0013, update `refresh_kpi_daily_mv()` to call `refresh_analytics_mvs()` instead, OR rename the test helper. Plan should explicitly edit `0006_test_helpers.sql` (or add a new migration superseding it). Update the `beforeAll` in `tenant-isolation.test.ts` to call the new function.

**Warning signs:** Extended integration tests pass for `kpi_daily_v` but fail for new leaves because `cohort_mv` was never refreshed.

### Pitfall 5: `generate_series(0, 52)` hardcodes the max horizon

**What goes wrong:** Project has 10 months of history now → ~44 weeks → 52 is fine. In 6 months it'll be ~65 weeks and retention/LTV will silently clip at week 52 for old cohorts.

**How to avoid:** Compute the upper bound from data: `select max(floor(...)) from cohort_mv`, OR set a generous ceiling (`generate_series(0, 260)` = 5 years) and let the NULL mask handle everything. NULL mask is free at read time.

**Warning signs:** Test D-26 #4 asserts oldest cohort is non-NULL up to `now() - cohort_start`. If that test passes today but fails 3 months later, this pitfall triggered.

### Pitfall 6: Test infrastructure drift from Phase 1

**What goes wrong:** `tests/integration/tenant-isolation.test.ts` currently tests only `kpi_daily_v`. D-27 says extend it, but extending means (a) seeding `transactions` rows for tenants A and B in `beforeAll`, (b) calling the new refresh RPC, (c) asserting every leaf view respects tenancy. That's 5 new views × 2 tenants = 10 more isolation assertions.

Phase 1 UAT tests 3/4/5 are already skipped due to "second TEST project" blocker. Phase 3 **does not fix** this — D-27 explicitly keeps them deferred. Do not scope-creep into unblocking them.

**How to avoid:** Plan a dedicated test file `tests/integration/phase3-analytics.test.ts` for the 8 new tests (D-26) and only MINIMAL edits to `tenant-isolation.test.ts` (adding the 5 new views to the scoped-reads assertion). Keeps diff small and avoids breaking Phase 1 baseline.

**Warning signs:** Phase 3 CI run shows more Phase 1 test failures than it started with.

## Code Examples

### Refresh observability query (founder copies to SQL editor)
```sql
-- How did last night's refresh go?
select
  j.jobname,
  d.start_time::timestamptz at time zone 'Europe/Berlin' as berlin_start,
  age(d.end_time, d.start_time) as duration,
  d.status,
  coalesce(d.return_message, '') as message
from cron.job j
join cron.job_run_details d on d.jobid = j.jobid
where j.jobname = 'refresh-analytics-mvs'
order by d.start_time desc
limit 10;
```

### 3-customer fixture for D-26 #1

```typescript
// tests/integration/phase3-analytics.test.ts (excerpt)
//
// Customer A: first visit 2025-08-04 (Mon, week 0), returns week 2, week 8
// Customer B: first visit 2025-08-04 (same cohort as A), returns week 1, week 3
// Customer C: first visit 2025-11-10 (Mon, later cohort), returns week 1
//
// Expected cohort_mv rows (weekly grain):
//   A: cohort_week=2025-08-04, cohort_size_week=2 (A+B share cohort)
//   B: cohort_week=2025-08-04, cohort_size_week=2
//   C: cohort_week=2025-11-10, cohort_size_week=1
//
// Expected retention_curve_v (cohort 2025-08-04, size 2):
//   period 0: 2/2 = 1.0 (both visited in cohort week — first visit IS a visit)
//   period 1: 1/2 = 0.5 (B returned)
//   period 2: 1/2 = 0.5 (A returned)
//   period 3: 1/2 = 0.5 (B returned)
//   period 8: 1/2 = 0.5 (A returned)
//   other periods < horizon: 0.0

const fixtureTxs = [
  // Customer A
  { card_hash: 'hash-a', occurred_at: '2025-08-04T12:00:00+02:00', gross_cents: 1500 },
  { card_hash: 'hash-a', occurred_at: '2025-08-18T12:00:00+02:00', gross_cents: 1800 },  // week 2
  { card_hash: 'hash-a', occurred_at: '2025-09-29T12:00:00+02:00', gross_cents: 2100 },  // week 8
  // Customer B
  { card_hash: 'hash-b', occurred_at: '2025-08-05T12:00:00+02:00', gross_cents: 1400 },  // cohort_week = 2025-08-04
  { card_hash: 'hash-b', occurred_at: '2025-08-11T12:00:00+02:00', gross_cents: 1700 },  // week 1
  { card_hash: 'hash-b', occurred_at: '2025-08-25T12:00:00+02:00', gross_cents: 1600 },  // week 3
  // Customer C
  { card_hash: 'hash-c', occurred_at: '2025-11-10T12:00:00+02:00', gross_cents: 1300 },
  { card_hash: 'hash-c', occurred_at: '2025-11-17T12:00:00+02:00', gross_cents: 1200 },  // week 1
];
```

Note: 2025-08-04 is a Monday (ISO week starts Monday). `date_trunc('week', ...)` in Postgres also uses ISO Monday-start. Keep the fixture aligned with ISO to avoid edge-case drift.

## State of the Art

No ecosystem shift applicable — Postgres MV/pg_cron/wrapper-view patterns have been stable for 3+ years. Nothing in training data contradicts 2026 docs.

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| RLS-on-MV (theoretically planned) | Wrapper-view + REVOKE (Phase 1 canonical) | Postgres has never supported this | Must use the wrapper pattern; generic Supabase advice confirms |
| `cron` schema permissions grant-free | Supabase auto-grants `cron.*` to postgres only | Always — v1 migration must run as postgres/service_role | Plan check should confirm migration runner is service-role |

## Open Questions

1. **Which `new_vs_returning_v` bucket strategy for April 2026?**
   - What we know: D-14 says 3 buckets (`new`/`returning`/`cash_anonymous`). April's carded rows have no cohort_mv match → ambiguous bucket.
   - What's unclear: whether to add a 4th `blackout_unknown` bucket (honest but breaks D-26 #3 tie-out sum) or bucket April carded rows as `new` (preserves 3-bucket test, misrepresents April identity).
   - Recommendation: planner adds `blackout_unknown` as 4th bucket; test D-26 #3 sums all four. Written in Pattern 6 above.

2. **Max period for `generate_series` in retention/LTV?**
   - Recommendation: `generate_series(0, 260)` (5 years); NULL mask handles everything beyond observed. Free at read time. Pitfall 5.

3. **Store `cohort_mv.cohort_week` as `date` or `timestamptz`?**
   - What we know: D-02 suggests `date`. Horizon math then needs `cohort_week::timestamptz` cast which picks up session TZ.
   - Recommendation: store as `date` per D-02; also store `first_visit_at timestamptz` and use THAT for horizon math (already suggested). Week bucket stays as `date` for UI grouping.

4. **Exact April blackout range — full month or 04-01..04-11?**
   - Resolved: Phase 2 02-04-SUMMARY.md states "Worldline blackout 2026-04-01..04-11" and scopes reporting to `[2025-06-11, 2026-03-31]` Berlin. Use `2026-04-01 00:00:00+00` to `2026-04-12 00:00:00+00` (exclusive upper — 11 days covered). Patterns above use this range. Planner should double-check by greping `02-04-REAL-RUN.md` too.

5. **Does `kpi_daily_v` need a `currency` or `vat_rate` column?**
   - Out of scope per D-15. Revenue is always `gross_cents` in EUR for v1.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase Postgres (DEV + TEST) | All migrations + integration tests | ✓ | 15+ (Supabase managed) | — |
| pg_cron extension | Nightly refresh | ✓ (assumed; verify in pre-flight) | built-in | Manual daily refresh via service-role RPC — acceptable degraded mode but requires documenting |
| `cron.schedule` / `cron.job_run_details` | Pattern 7 | ✓ | pg_cron ≥ 1.4 | — |
| Vitest + TEST env vars | Integration test run | ✓ | Phase 1/2 precedent | — |
| Supabase CLI (`supabase db push`) | Migration application | ✓ | Phase 1/2 precedent | — |

**Missing dependencies with no fallback:** None.

**Pre-flight check:** Planner should add a task that runs `select extname from pg_extension where extname='pg_cron';` against DEV + TEST before 0013 migration. If missing, first step is enabling via Dashboard → Database → Extensions (or a migration `create extension if not exists pg_cron with schema cron;` but Supabase requires Dashboard toggle in some project ages).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (Phase 1/2 precedent) |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `npm test -- tests/integration/phase3-analytics.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| ANL-01 | `cohort_mv` first-visit assignment correct across 3 grains (3-customer fixture) | integration | `npm test -- tests/integration/phase3-analytics.test.ts -t "cohort assignment"` | ❌ Wave 0 |
| ANL-02 | `retention_curve_v` returns expected matrix; survivorship NULL past horizon | integration | `... -t "retention curve"` | ❌ Wave 0 |
| ANL-03 | `ltv_v` returns cumulative avg LTV; NULL past horizon | integration | `... -t "ltv"` | ❌ Wave 0 |
| ANL-04 | `kpi_daily_v` revenue/tx_count/avg_ticket correct | integration | `... -t "kpi daily"` | ❌ Wave 0 |
| ANL-05 | `frequency_v` buckets match 3-customer fixture | integration | `... -t "frequency"` | ❌ Wave 0 |
| ANL-06 | `new_vs_returning_v` tie-out: `sum(buckets.revenue) == kpi_daily_v.revenue` | integration | `... -t "tie-out"` | ❌ Wave 0 |
| ANL-07 | `select public.refresh_analytics_mvs()` succeeds under concurrent SELECTs | integration | `... -t "refresh concurrent"` | ❌ Wave 0 |
| ANL-08 | `authenticated` has no SELECT on `cohort_mv`; has SELECT on all leaves; tenant A cannot read tenant B rows via any leaf | integration | `... -t "tenant isolation"` + extend `tenant-isolation.test.ts` | ❌ Wave 0 (extend existing) |
| ANL-09 | `bash scripts/ci-guards.sh` fails when fake `src/lib/evil.ts` references `cohort_mv` or `.from('transactions')`, passes after removal | unit | `npm test -- tests/unit/ci-guards.test.ts` OR direct shell assertion | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- tests/integration/phase3-analytics.test.ts` (8 tests, ~15s against TEST)
- **Per wave merge:** `npm test` (full suite including existing Phase 1/2 tests)
- **Phase gate:** Full suite green + `bash scripts/ci-guards.sh` exits 0 before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/integration/phase3-analytics.test.ts` — new test file covering ANL-01..ANL-07
- [ ] Extension to `tests/integration/tenant-isolation.test.ts` — add 5 new leaf views to scoped-reads loop (ANL-08)
- [ ] Fixture helper in same file or `tests/integration/helpers/phase3-fixtures.ts` — 3-customer seeder
- [ ] CI guard shell test — either a new Vitest unit test that `exec`s `ci-guards.sh`, or a GHA workflow step that intentionally creates a fake `src/lib/evil.ts`, runs the guard, asserts non-zero exit, then cleans up
- [ ] Update `0006_test_helpers.sql` (or new migration) so `refresh_kpi_daily_mv` RPC wraps the new `refresh_analytics_mvs()` — to keep Phase 1 tests' `beforeAll` working without changes (OR update `tenant-isolation.test.ts` beforeAll)

## Project Constraints (from CLAUDE.md)

From `/Users/shiniguchi/development/ramen-bones-analytics/CLAUDE.md` — directives with same authority as locked decisions:

- **Stack locked:** Supabase Postgres + pg_cron + MVs (not dbt, not D1). No new packages in Phase 3.
- **Forbidden packages:** `@supabase/auth-helpers-sveltekit`, `svelte-chartjs`, `Moment.js`, direct-browser Claude API. None of these apply to Phase 3 (no frontend work) but flag for Phase 4 planner.
- **Security paramount:** Never store PAN, PII, raw card data. Phase 3 only reads `transactions.card_hash` — already hashed in Phase 2 loader. No new PII exposure.
- **RLS + MV pattern:** Use wrapper view with REVOKE ALL (already locked D-17).
- **REFRESH CONCURRENTLY requires unique index** (already locked in template).
- **pg_cron observability via `cron.job_run_details`** (CLAUDE.md documents this; matches D-22).
- **RLS via security-definer wrapper function** — CLAUDE.md mentions this; Phase 1 deviated by choosing default-invoker-view-over-REVOKEd-MV instead. Phase 3 follows Phase 1 (D-17), NOT the CLAUDE.md generic recommendation. This is a resolved conflict.

From `/Users/shiniguchi/development/ramen-bones-analytics/.claude/CLAUDE.md`:

- **Default env is DEV** — migrations apply to DEV first. Phase 3 integration tests run against TEST project, matching Phase 1/2 precedent.
- **Per-task QA mandatory** — each MV/view migration must be verified via DB MCP or SQL editor before the next task starts. Cannot claim done until verified against DEV.
- **No `Co-authored-by: Claude`** in commit messages.
- **Self-verify before asking user** — planner should not schedule user-verification tasks for facts that can be asserted via a query.

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/0004_kpi_daily_mv_template.sql` — canonical wrapper-view template (must copy verbatim)
- `supabase/migrations/0003_transactions_skeleton.sql` + `0008_transactions_columns.sql` — Phase 3 input schema
- `supabase/migrations/0006_test_helpers.sql` — existing `refresh_kpi_daily_mv` RPC Phase 3 must update
- `scripts/ci-guards.sh` — existing guard 1 regex Phase 3 extends (D-24)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-04 (JWT claim), D-06/07/08 (wrapper template), D-09 (tenant timezone), D-14 guards
- `.planning/phases/02-ingestion/02-04-SUMMARY.md` — April blackout range (2026-04-01..04-11) + scoped reporting
- `.planning/phases/03-analytics-sql/03-CONTEXT.md` — 27 locked decisions (D-01..D-27)
- `.planning/REQUIREMENTS.md` §ANL-01..ANL-09

### Secondary (MEDIUM confidence)
- Supabase pg_cron docs (https://supabase.com/docs/guides/database/extensions/pg_cron) — confirms existence + schema location; exact syntax corroborated via training data (pg_cron is stable 4+ years)
- GitHub discussion supabase/discussions#17790 — confirms "Postgres does not support RLS on MVs" and the wrapper-view workaround; note Phase 1 chose a variant of this pattern (plain view + REVOKE, not SECDEF function)

### Tertiary (LOW confidence)
- None — every recommendation is grounded in existing migration files or locked decisions.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, stack fully locked from Phase 1
- Architecture: HIGH — wrapper-view template is verbatim from 0004; SQL patterns follow Postgres idioms
- Pitfalls: HIGH — Pitfalls 1, 2, 3 are well-documented Postgres gotchas; Pitfalls 4, 5, 6 are project-specific and verified against existing files
- pg_cron exact syntax: MEDIUM — WebFetch returned limited content; syntax shown above is the standard `cron.schedule(name, cron_expr, sql)` form documented across all pg_cron sources. Planner should verify by running `select * from cron.job` on DEV after 0013 applies.

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (30 days — Phase 3 is SQL-only, stack is stable)
