-- 0034_lift_april_blackout.sql
-- Lift the 2026-04-01..04-11 Worldline blackout exclusion from cohort_mv,
-- customer_ltv_mv, retention_curve_v, and retention_curve_monthly_v.
-- April 2026 Worldline data is now present (ingested 2026-04-20) so the
-- exclusion is stale and silently drops 11 days from cohort/retention/LTV.
--
-- cohort_mv has 3 dependents (customer_ltv_mv, retention_curve_v,
-- retention_curve_monthly_v) — cannot ALTER a MV body, so drop with CASCADE
-- and recreate all five objects. Bodies copied verbatim from the latest
-- authoritative migrations (0010, 0024, 0028) with the `not (occurred_at
-- between ...)` clause removed. Test helpers (test_customer_ltv) survive
-- the cascade because function→view dependencies are soft in Postgres.

begin;

-- Nuke cohort_mv and everything that reads from it.
drop materialized view public.cohort_mv cascade;

-- ============================================================
-- 1. cohort_mv (body from 0010, minus blackout clause)
-- ============================================================
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
  where t.card_hash is not null
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
    (fv.first_visit_at at time zone r.timezone)::date                    as first_visit_business_date,
    (fv.first_visit_at at time zone r.timezone)::date                    as cohort_day,
    date_trunc('week',  fv.first_visit_at at time zone r.timezone)::date as cohort_week,
    date_trunc('month', fv.first_visit_at at time zone r.timezone)::date as cohort_month
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

create unique index cohort_mv_pk on public.cohort_mv (restaurant_id, card_hash);
revoke all on public.cohort_mv from anon, authenticated;

create view public.cohort_v as
select
  restaurant_id, card_hash, first_visit_at, first_visit_business_date,
  cohort_day, cohort_week, cohort_month,
  cohort_size_day, cohort_size_week, cohort_size_month
from public.cohort_mv
where restaurant_id::text = (auth.jwt()->>'restaurant_id');

grant select on public.cohort_v to authenticated;

-- ============================================================
-- 2. customer_ltv_mv (body from 0024, minus blackout clause)
-- ============================================================
create materialized view public.customer_ltv_mv as
with filtered_tx as (
  select
    t.restaurant_id,
    t.card_hash,
    t.gross_cents,
    t.occurred_at
  from public.transactions t
  where t.card_hash is not null
),
per_customer as (
  select
    restaurant_id,
    card_hash,
    sum(gross_cents)::bigint as revenue_cents,
    count(*)::integer         as visit_count
  from filtered_tx
  group by restaurant_id, card_hash
)
select
  pc.restaurant_id,
  pc.card_hash,
  pc.revenue_cents,
  pc.visit_count,
  c.cohort_day,
  c.cohort_week,
  c.cohort_month,
  c.first_visit_business_date,
  c.first_visit_at
from per_customer pc
join public.cohort_mv c
  on c.restaurant_id = pc.restaurant_id
 and c.card_hash     = pc.card_hash;

create unique index customer_ltv_mv_pk
  on public.customer_ltv_mv (restaurant_id, card_hash);
revoke all on public.customer_ltv_mv from anon, authenticated;

create view public.customer_ltv_v as
select
  restaurant_id, card_hash, revenue_cents, visit_count,
  cohort_day, cohort_week, cohort_month,
  first_visit_business_date, first_visit_at
from public.customer_ltv_mv
where restaurant_id::text = (auth.jwt()->>'restaurant_id');

grant select on public.customer_ltv_v to authenticated;

-- ============================================================
-- 3. retention_curve_v (body from 0028, minus blackout clause)
-- ============================================================
create or replace view public.retention_curve_v as
with cohorts as (
  select distinct restaurant_id, cohort_week, cohort_size_week
  from public.cohort_mv
  where restaurant_id::text = (auth.jwt()->>'restaurant_id')
),
periods as (
  select generate_series(0, 260) as period_weeks
),
visits as (
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
),
observed as (
  select restaurant_id, cohort_week, period_weeks,
         count(distinct card_hash) as retained
  from visits
  group by restaurant_id, cohort_week, period_weeks
)
select
  c.restaurant_id,
  c.cohort_week,
  c.cohort_size_week,
  p.period_weeks,
  case
    when p.period_weeks >= floor(extract(epoch from (now() - c.cohort_week::timestamptz)) / (7 * 86400))::int
      then null
    else coalesce(o.retained, 0)::numeric / nullif(c.cohort_size_week, 0)
  end as retention_rate,
  floor(extract(epoch from (now() - c.cohort_week::timestamptz)) / (7 * 86400))::int as cohort_age_weeks
from cohorts c
cross join periods p
left join observed o
  on  o.restaurant_id = c.restaurant_id
  and o.cohort_week   = c.cohort_week
  and o.period_weeks  = p.period_weeks;

grant select on public.retention_curve_v to authenticated;

-- ============================================================
-- 4. retention_curve_monthly_v (body from 0028, minus blackout clause)
-- ============================================================
create or replace view public.retention_curve_monthly_v as
with cohorts as (
  select distinct restaurant_id, cohort_month, cohort_size_month
  from public.cohort_mv
  where restaurant_id::text = (auth.jwt()->>'restaurant_id')
),
periods as (
  select generate_series(0, 60) as period_months
),
visits as (
  select
    c.restaurant_id,
    c.cohort_month,
    (extract(year  from age(t.occurred_at, c.first_visit_at)) * 12
   + extract(month from age(t.occurred_at, c.first_visit_at)))::int as period_months,
    c.card_hash
  from public.cohort_mv c
  join public.transactions t
    on t.restaurant_id = c.restaurant_id
   and t.card_hash     = c.card_hash
  where c.restaurant_id::text = (auth.jwt()->>'restaurant_id')
),
observed as (
  select restaurant_id, cohort_month, period_months,
         count(distinct card_hash) as retained
  from visits
  group by restaurant_id, cohort_month, period_months
)
select
  c.restaurant_id,
  c.cohort_month,
  c.cohort_size_month,
  p.period_months,
  case
    when p.period_months >=
      (extract(year  from age(now(), c.cohort_month::timestamptz)) * 12
     + extract(month from age(now(), c.cohort_month::timestamptz)))::int
      then null
    else coalesce(o.retained, 0)::numeric / nullif(c.cohort_size_month, 0)
  end as retention_rate,
  (extract(year  from age(now(), c.cohort_month::timestamptz)) * 12
 + extract(month from age(now(), c.cohort_month::timestamptz)))::int as cohort_age_months
from cohorts c
cross join periods p
left join observed o
  on  o.restaurant_id  = c.restaurant_id
  and o.cohort_month   = c.cohort_month
  and o.period_months  = p.period_months;

grant select on public.retention_curve_monthly_v to authenticated;

commit;
