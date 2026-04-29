-- 0054_forecast_mv_refresh.sql
-- Phase 14: nightly refresh of forecast_daily_mv via pg_cron.
-- Runs at 03:30 UTC daily — after refresh-analytics-mvs (03:00) and
-- generate-insights (03:15) to avoid overlap (Guard 8).

create or replace function public.refresh_forecast_mvs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.forecast_daily_mv;
end;
$$;

-- Register pg_cron job — daily at 03:30 UTC (staggered after analytics + insights)
select cron.schedule(
  'refresh-forecast-mvs',
  '30 3 * * *',
  $$select public.refresh_forecast_mvs()$$
);
