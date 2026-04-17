-- 0024_customer_ltv_mv.sql
-- Phase 10 Plan 03: one row per customer with lifetime revenue, visit count, and
-- cohort assignments. Feeds VA-07 (histogram), VA-09 (cohort total), VA-10 (cohort avg).
-- Joins cohort_mv (for cohort assignments) with transactions (for aggregates).
-- Excludes cash (card_hash IS NULL) — same filter as cohort_mv.
-- Excludes April 2026 Worldline blackout — same rule as cohort_mv (keeps MVs consistent).

create materialized view public.customer_ltv_mv as
with filtered_tx as (
  select
    t.restaurant_id,
    t.card_hash,
    t.gross_cents,
    t.occurred_at
  from public.transactions t
  where t.card_hash is not null
    and not (
      t.occurred_at >= '2026-04-01 00:00:00+00'
      and t.occurred_at <  '2026-04-12 00:00:00+00'
    )
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

-- MANDATORY unique index for REFRESH CONCURRENTLY (Guard 3b)
create unique index customer_ltv_mv_pk
  on public.customer_ltv_mv (restaurant_id, card_hash);

-- Lock raw MV — wrapper view is the only tenant-facing read path
revoke all on public.customer_ltv_mv from anon, authenticated;

-- Wrapper view (JWT tenant filter; do NOT set security_invoker — raw MV bypasses RLS)
create view public.customer_ltv_v as
select
  restaurant_id,
  card_hash,
  revenue_cents,
  visit_count,
  cohort_day,
  cohort_week,
  cohort_month,
  first_visit_business_date,
  first_visit_at
from public.customer_ltv_mv
where restaurant_id::text = (auth.jwt()->>'restaurant_id');

grant select on public.customer_ltv_v to authenticated;

-- Test helper for integration tests (follows 0020_visit_attribution_mv.sql pattern)
create or replace function public.test_customer_ltv(rid uuid)
returns table (
  restaurant_id uuid,
  card_hash     text,
  revenue_cents bigint,
  visit_count   integer,
  cohort_day    date,
  cohort_week   date,
  cohort_month  date,
  first_visit_business_date date,
  first_visit_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('restaurant_id', rid::text)::text, true);
  return query select * from public.customer_ltv_v;
end;
$$;
revoke all on function public.test_customer_ltv(uuid) from public, anon, authenticated;
grant execute on function public.test_customer_ltv(uuid) to service_role;

-- Extend refresh_analytics_mvs() — customer_ltv_mv depends on cohort_mv.
-- Ordering per D-04: cohort → kpi → visit_attribution → customer_ltv → (item_counts in 0025).
create or replace function public.refresh_analytics_mvs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.cohort_mv;
  refresh materialized view concurrently public.kpi_daily_mv;
  refresh materialized view concurrently public.visit_attribution_mv;
  refresh materialized view concurrently public.customer_ltv_mv;
  -- item_counts_daily_mv appended by 0025
end;
$$;

-- Test helper used by Phase 10 Plan 10-01 integration test (refresh_analytics_mvs ordering).
-- Returns the pg_get_functiondef text of refresh_analytics_mvs so the integration
-- test can assert the 5-MV DAG order via regex.
create or replace function public.test_refresh_function_body()
returns text
language sql
security definer
set search_path = public
as $$
  select pg_get_functiondef('public.refresh_analytics_mvs()'::regprocedure);
$$;
revoke all on function public.test_refresh_function_body() from public, anon, authenticated;
grant execute on function public.test_refresh_function_body() to service_role;
