-- 0055_forecast_samples_janitor.sql
-- Phase 14: weekly janitor that NULLs yhat_samples on older runs.
-- Keeps only the latest run_date per (restaurant_id, kpi_name, model_name, forecast_track).
-- Runs Sundays at 04:00 UTC.

create or replace function public.null_old_forecast_samples()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.forecast_daily f
  set yhat_samples = null
  from (
    -- Subquery: rows whose run_date is NOT the latest per grouping key
    select fd.restaurant_id, fd.kpi_name, fd.target_date,
           fd.model_name, fd.run_date, fd.forecast_track
    from public.forecast_daily fd
    join (
      select restaurant_id, kpi_name, model_name, forecast_track,
             max(run_date) as max_run_date
      from public.forecast_daily
      where yhat_samples is not null
      group by restaurant_id, kpi_name, model_name, forecast_track
    ) latest
      on  fd.restaurant_id  = latest.restaurant_id
      and fd.kpi_name        = latest.kpi_name
      and fd.model_name      = latest.model_name
      and fd.forecast_track  = latest.forecast_track
      and fd.run_date        < latest.max_run_date
    where fd.yhat_samples is not null
  ) old_rows
  where f.restaurant_id  = old_rows.restaurant_id
    and f.kpi_name        = old_rows.kpi_name
    and f.target_date     = old_rows.target_date
    and f.model_name      = old_rows.model_name
    and f.run_date        = old_rows.run_date
    and f.forecast_track  = old_rows.forecast_track
    and f.yhat_samples is not null;
end;
$$;

-- Register pg_cron job — weekly on Sunday at 04:00 UTC
select cron.schedule(
  'null-old-forecast-samples',
  '0 4 * * 0',
  $$select public.null_old_forecast_samples()$$
);
