-- 0056_forecast_janitor.sql
-- Phase 14: weekly pg_cron job to NULL yhat_samples for older run_dates (D-05)
-- Keeps only the latest run_date per (restaurant_id, kpi_name, model_name, forecast_track)
-- Autoplan fix: no "- 1" offset

SELECT cron.schedule(
    'forecast-janitor',
    '0 4 * * 0',
    $$
    UPDATE public.forecast_daily
    SET yhat_samples = NULL
    WHERE yhat_samples IS NOT NULL
      AND (restaurant_id, kpi_name, model_name, forecast_track, run_date) NOT IN (
          SELECT restaurant_id, kpi_name, model_name, forecast_track, MAX(run_date)
          FROM public.forecast_daily
          GROUP BY restaurant_id, kpi_name, model_name, forecast_track
      );
    $$
);
