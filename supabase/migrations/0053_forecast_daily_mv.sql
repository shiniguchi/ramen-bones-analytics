CREATE MATERIALIZED VIEW public.forecast_daily_mv AS
SELECT DISTINCT ON (restaurant_id, kpi_name, target_date, model_name, forecast_track)
    restaurant_id, kpi_name, target_date, model_name, forecast_track,
    run_date, yhat, yhat_lower, yhat_upper, horizon_days, exog_signature
FROM public.forecast_daily
ORDER BY restaurant_id, kpi_name, target_date, model_name, forecast_track, run_date DESC;

CREATE UNIQUE INDEX forecast_daily_mv_uq
    ON public.forecast_daily_mv (restaurant_id, kpi_name, target_date, model_name, forecast_track);

REVOKE ALL ON public.forecast_daily_mv FROM authenticated, anon;
