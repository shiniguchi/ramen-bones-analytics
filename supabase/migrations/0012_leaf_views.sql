-- 0012_leaf_views.sql
-- Phase 3 leaf views: retention_curve_v, ltv_v, frequency_v, new_vs_returning_v.
-- All plain views (D-16). All read from public.cohort_mv + public.transactions.
-- All enforce JWT-claim filter (D-18 defense-in-depth).
-- All GRANT SELECT TO authenticated (D-19); raw cohort_mv stays REVOKE'd.
--
-- See .planning/phases/03-analytics-sql/03-RESEARCH.md §Patterns 3..6
-- and 03-CONTEXT.md D-08..D-14, D-18, D-19.

-- Idempotency: drop any pre-existing leaf views so re-applying after a
-- mid-flight edit (planner did this once) succeeds cleanly.
drop view if exists public.retention_curve_v;
drop view if exists public.ltv_v;
drop view if exists public.frequency_v;
drop view if exists public.new_vs_returning_v;

-- ============================================================
-- 1. retention_curve_v (Pattern 3)
--    Per-cohort weekly retention with NULL-mask past horizon.
-- ============================================================
create view public.retention_curve_v as
with cohorts as (
  select distinct restaurant_id, cohort_week, cohort_size_week
  from public.cohort_mv
  where restaurant_id::text = (auth.jwt()->>'restaurant_id')
),
periods as (
  -- 5-year horizon headroom (Pitfall 5)
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
    and not (
      t.occurred_at >= '2026-04-01 00:00:00+00'
      and t.occurred_at <  '2026-04-12 00:00:00+00'
    )
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
    when p.period_weeks > floor(extract(epoch from (now() - c.cohort_week::timestamptz)) / (7 * 86400))::int
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
-- 2. ltv_v (Pattern 4)
--    Cumulative average LTV per acquired customer, NULL past horizon.
-- ============================================================
create view public.ltv_v as
with cohorts as (
  select distinct restaurant_id, cohort_week, cohort_size_week
  from public.cohort_mv
  where restaurant_id::text = (auth.jwt()->>'restaurant_id')
),
periods as (select generate_series(0, 260) as period_weeks),
cohort_revenue as (
  select
    c.restaurant_id,
    c.cohort_week,
    floor(extract(epoch from (t.occurred_at - c.first_visit_at)) / (7 * 86400))::int as period_weeks,
    sum(t.gross_cents) as period_revenue_cents
  from public.cohort_mv c
  join public.transactions t
    on t.restaurant_id = c.restaurant_id
   and t.card_hash     = c.card_hash
  where c.restaurant_id::text = (auth.jwt()->>'restaurant_id')
    and not (
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

-- ============================================================
-- 3. frequency_v (Pattern 5 — fixed buckets D-12)
-- ============================================================
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
      when visit_count = 1              then '1'
      when visit_count = 2              then '2'
      when visit_count between 3 and 5  then '3-5'
      when visit_count between 6 and 10 then '6-10'
      else '11+'
    end as bucket,
    case
      when visit_count = 1              then 1
      when visit_count = 2              then 2
      when visit_count between 3 and 5  then 3
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
  count(*)::int               as customer_count,
  sum(revenue_cents)::numeric as revenue_cents
from bucketed
group by restaurant_id, bucket, bucket_order;

grant select on public.frequency_v to authenticated;

-- ============================================================
-- 4. new_vs_returning_v (Pattern 6 — 4 buckets including blackout_unknown)
-- ============================================================
create view public.new_vs_returning_v as
with carded as (
  select
    t.restaurant_id,
    (t.occurred_at at time zone r.timezone)::date as business_date,
    t.card_hash,
    t.gross_cents,
    t.occurred_at,
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
      when occurred_at >= '2026-04-01 00:00:00+00'
       and occurred_at <  '2026-04-12 00:00:00+00'  then 'blackout_unknown'
      when first_visit_business_date = business_date then 'new'
      when first_visit_business_date is null         then 'blackout_unknown'
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
  count(*)::int                 as tx_count,
  sum(gross_cents)::numeric     as revenue_cents
from combined
where restaurant_id::text = (auth.jwt()->>'restaurant_id')
group by restaurant_id, business_date, bucket;

grant select on public.new_vs_returning_v to authenticated;

-- ============================================================
-- Test helpers (Rule 3 — needed for integration test verification).
--
-- Leaf views filter on `auth.jwt()->>'restaurant_id'`, which returns NULL
-- when called via the service-role admin client — so admin queries see
-- zero rows. These SECURITY DEFINER RPCs set the JWT claim via
-- set_config(..., true) (transaction-local, like PostgREST) and re-query
-- the leaf view, so integration tests can assert row contents without
-- minting real JWTs.
-- ============================================================

drop function if exists public.test_retention_curve(uuid);
drop function if exists public.test_ltv(uuid);
drop function if exists public.test_frequency(uuid);
drop function if exists public.test_new_vs_returning(uuid);

create or replace function public.test_retention_curve(rid uuid)
returns table (
  restaurant_id    uuid,
  cohort_week      date,
  cohort_size_week bigint,
  period_weeks     int,
  retention_rate   numeric,
  cohort_age_weeks int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('restaurant_id', rid::text)::text, true);
  return query select * from public.retention_curve_v;
end;
$$;
revoke all on function public.test_retention_curve(uuid) from public, anon, authenticated;
grant execute on function public.test_retention_curve(uuid) to service_role;

create or replace function public.test_ltv(rid uuid)
returns table (
  restaurant_id    uuid,
  cohort_week      date,
  cohort_size_week bigint,
  period_weeks     int,
  ltv_cents        numeric,
  cohort_age_weeks int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('restaurant_id', rid::text)::text, true);
  return query select * from public.ltv_v;
end;
$$;
revoke all on function public.test_ltv(uuid) from public, anon, authenticated;
grant execute on function public.test_ltv(uuid) to service_role;

create or replace function public.test_frequency(rid uuid)
returns table (
  restaurant_id  uuid,
  bucket         text,
  bucket_order   int,
  customer_count int,
  revenue_cents  numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('restaurant_id', rid::text)::text, true);
  return query select * from public.frequency_v;
end;
$$;
revoke all on function public.test_frequency(uuid) from public, anon, authenticated;
grant execute on function public.test_frequency(uuid) to service_role;

create or replace function public.test_new_vs_returning(rid uuid)
returns table (
  restaurant_id uuid,
  business_date date,
  bucket        text,
  tx_count      int,
  revenue_cents numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('restaurant_id', rid::text)::text, true);
  return query select * from public.new_vs_returning_v;
end;
$$;
revoke all on function public.test_new_vs_returning(uuid) from public, anon, authenticated;
grant execute on function public.test_new_vs_returning(uuid) to service_role;
