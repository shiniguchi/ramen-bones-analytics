-- 0010_cohort_mv.sql
-- Phase 3 trunk MV: first-visit cohort per card_hash with day/week/month grain.
-- See .planning/phases/03-analytics-sql/03-CONTEXT.md D-01..D-07, D-17, D-18.
-- Excludes cash (card_hash IS NULL) and April 2026 Worldline blackout 2026-04-01..04-11.

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
    and not (
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

-- MANDATORY unique index for REFRESH CONCURRENTLY (D-08 from Phase 1)
create unique index cohort_mv_pk on public.cohort_mv (restaurant_id, card_hash);

-- Lock raw MV — wrapper view is the only tenant-facing read path (D-17/D-19)
revoke all on public.cohort_mv from anon, authenticated;

-- Wrapper view — DO NOT set security_invoker (Pitfall 2)
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

-- Local refresh helper — lets ANL-01 tests flip green NOW (Nyquist).
-- Plan 03-05 supersedes this with refresh_analytics_mvs() which refreshes
-- both cohort_mv and kpi_daily_mv sequentially. Drop this helper then.
create or replace function public.refresh_cohort_mv()
returns void
language sql
security definer
set search_path = public
as $$
  refresh materialized view concurrently public.cohort_mv;
$$;

revoke all on function public.refresh_cohort_mv() from public, anon, authenticated;
grant execute on function public.refresh_cohort_mv() to service_role;
