-- 0028_retention_exclude_current_period.sql
-- quick-260418-4oh Pass 4 Item #4: NULL-mask the in-progress current period.
--
-- Why: the existing NULL-mask (0012/0027) used `period_weeks > cohort_age_weeks`
-- (and the monthly equivalent) — that leaves the row where
-- `period_weeks == cohort_age_weeks` observable. Problem: the transactions for
-- THAT period are still accumulating (current week / current month isn't over
-- yet), so the observed tx count is incomplete and the chart renders a
-- misleading 0% drop on the current-period point.
--
-- Fix: flip `>` → `>=`. Everything at or past the horizon is NULL-masked.
-- The in-progress period no longer emits a spurious 0%. All older periods
-- (where period < age) keep their observed retention_rate unchanged — so the
-- Phase 3 test fixtures (2025-08-04 cohort, 2024-07 monthly cohort) see the
-- same values they saw before: those cohorts are in the past, age ≫ period
-- for all observable points.
--
-- Shape unchanged → CREATE OR REPLACE VIEW is safe (no column add/remove).
-- GRANT SELECT is preserved across REPLACE but we re-state it defensively.

-- ============================================================
-- 1. retention_curve_v (weekly) — flip > to >=
--    Body copied verbatim from 0012_leaf_views.sql lines 21-69,
--    with the single change on the CASE expression line.
-- ============================================================
create or replace view public.retention_curve_v as
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
    -- Pass 4 Item #4: `>=` (was `>`) — current-period row now NULL-masks.
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
-- 2. retention_curve_monthly_v — flip > to >=
--    Body copied verbatim from 0027_retention_curve_monthly_v.sql lines 23-79.
-- ============================================================
create or replace view public.retention_curve_monthly_v as
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
    -- Pass 4 Item #4: `>=` (was `>`) — current-period row now NULL-masks.
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
