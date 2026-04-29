-- 0052_forecast_daily_mv.sql
-- Phase 14: MV collapsing forecast_daily to "latest run per key" +
-- wrapper view joining actuals from kpi_daily_mv.
-- Pattern: 0025_item_counts_daily_mv.sql (MV + unique index + REVOKE +
-- wrapper view + test helper + grant to service_role).

-- MV: latest run_date per (restaurant_id, kpi_name, target_date, model_name, forecast_track)
create materialized view public.forecast_daily_mv as
with latest as (
  select
    restaurant_id,
    kpi_name,
    target_date,
    model_name,
    forecast_track,
    max(run_date) as run_date
  from public.forecast_daily
  group by restaurant_id, kpi_name, target_date, model_name, forecast_track
)
select f.*
from public.forecast_daily f
join latest l using (restaurant_id, kpi_name, target_date, model_name, forecast_track, run_date);

-- MANDATORY unique index for REFRESH CONCURRENTLY
create unique index forecast_daily_mv_pk
  on public.forecast_daily_mv (restaurant_id, kpi_name, target_date, model_name, forecast_track);

-- Lock raw MV — tenant roles read only through the wrapper view
revoke all on public.forecast_daily_mv from anon, authenticated;

-- Wrapper view: joins forecast MV with kpi_daily_mv actuals.
-- CASE maps kpi_name to the matching actual column from kpi_daily_mv.
-- kpi_daily_mv columns: revenue_cents (numeric), tx_count (int).
create view public.forecast_with_actual_v as
select
  f.restaurant_id,
  f.kpi_name,
  f.target_date,
  f.model_name,
  f.forecast_track,
  f.yhat,
  f.yhat_lower,
  f.yhat_upper,
  f.run_date,
  f.fitted_at,
  f.horizon_days,
  f.ci_level,
  case
    when f.kpi_name = 'revenue_cents' then k.revenue_cents
    when f.kpi_name = 'tx_count'      then k.tx_count::numeric
  end as actual
from public.forecast_daily_mv f
left join public.kpi_daily_mv k
  on  k.restaurant_id = f.restaurant_id
  and k.business_date  = f.target_date
where f.restaurant_id::text = (auth.jwt() ->> 'restaurant_id');

grant select on public.forecast_with_actual_v to authenticated;

-- Test helper (follows 0025 pattern exactly)
create or replace function public.test_forecast_with_actual(rid uuid)
returns table (
  restaurant_id  uuid,
  kpi_name       text,
  target_date    date,
  model_name     text,
  forecast_track text,
  yhat           numeric,
  yhat_lower     numeric,
  yhat_upper     numeric,
  run_date       date,
  fitted_at      timestamptz,
  horizon_days   int,
  ci_level       numeric,
  actual         numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('restaurant_id', rid::text)::text, true);
  return query select * from public.forecast_with_actual_v;
end;
$$;
revoke all on function public.test_forecast_with_actual(uuid) from public, anon, authenticated;
grant execute on function public.test_forecast_with_actual(uuid) to service_role;
