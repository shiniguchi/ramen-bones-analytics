-- 0027_retention_curve_monthly_v.sql
-- quick-260418-28j Pass 2: monthly twin of retention_curve_v (0012).
--
-- Why: the dashboard's monthly retention curve was computed client-side by
-- re-bucketing weekly rows (period_weeks / 4.33) and taking a weighted
-- average. Result: period 0 came out at ~34%, not 100%. This view computes
-- real monthly cohorts from cohort_mv + transactions so period_months=0 is
-- definitionally 1.0 (first_visit_at is in the cohort's own month).
--
-- Shape mirrors retention_curve_v from 0012_leaf_views.sql — CTEs, JWT
-- claim filter, NULL-mask past horizon, SECURITY DEFINER test RPC. The only
-- semantic difference is the period expression: calendar-month diff via
-- extract(age()) instead of floor(epoch/(7*86400)).

-- Idempotency: re-applying after mid-flight edits succeeds cleanly.
drop view if exists public.retention_curve_monthly_v;
drop function if exists public.test_retention_curve_monthly(uuid);

-- ============================================================
-- retention_curve_monthly_v (Pattern 3 — plain view)
--   Per-cohort monthly retention with NULL-mask past horizon.
-- ============================================================
create view public.retention_curve_monthly_v as
with cohorts as (
  select distinct restaurant_id, cohort_month, cohort_size_month
  from public.cohort_mv
  where restaurant_id::text = (auth.jwt()->>'restaurant_id')
),
periods as (
  -- 5-year horizon headroom (parity with weekly's 260 weeks).
  select generate_series(0, 60) as period_months
),
visits as (
  select
    c.restaurant_id,
    c.cohort_month,
    -- Calendar-month difference between tx time and first visit.
    -- age(t,f) returns an interval; extract(year)*12 + extract(month)
    -- yields the calendar-month offset. Evaluates to 0 whenever
    -- occurred_at is in the same calendar month as first_visit_at.
    (extract(year  from age(t.occurred_at, c.first_visit_at)) * 12
   + extract(month from age(t.occurred_at, c.first_visit_at)))::int as period_months,
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
    when p.period_months >
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

-- ============================================================
-- Test helper — SECURITY DEFINER RPC for integration tests.
-- Mirrors public.test_retention_curve from 0012_leaf_views.sql.
-- Sets the JWT claim transaction-locally so admin clients can
-- assert row contents without minting real JWTs.
-- ============================================================
create or replace function public.test_retention_curve_monthly(rid uuid)
returns table (
  restaurant_id     uuid,
  cohort_month      date,
  cohort_size_month bigint,
  period_months     int,
  retention_rate    numeric,
  cohort_age_months int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('restaurant_id', rid::text)::text, true);
  return query select * from public.retention_curve_monthly_v;
end;
$$;
revoke all on function public.test_retention_curve_monthly(uuid) from public, anon, authenticated;
grant execute on function public.test_retention_curve_monthly(uuid) to service_role;
