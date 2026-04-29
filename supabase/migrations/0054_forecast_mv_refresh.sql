-- 0054_forecast_mv_refresh.sql
-- Phase 14: nightly refresh of forecast_daily_mv via pg_cron.
-- Runs at 03:00 UTC daily (after the forecast pipeline completes).

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

-- Register pg_cron job — daily at 03:00 UTC
select cron.schedule(
  'refresh-forecast-mvs',
  '0 3 * * *',
  $$select public.refresh_forecast_mvs()$$
);
