CREATE OR REPLACE VIEW public.forecast_with_actual_v AS
SELECT
    f.restaurant_id, f.kpi_name, f.target_date, f.model_name, f.forecast_track,
    f.run_date, f.yhat, f.yhat_lower, f.yhat_upper, f.horizon_days, f.exog_signature,
    k.value AS actual_value
FROM public.forecast_daily_mv f
LEFT JOIN public.kpi_daily_mv k
    ON k.restaurant_id = f.restaurant_id
    AND k.kpi_name = f.kpi_name
    AND k.date = f.target_date
WHERE f.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid;

GRANT SELECT ON public.forecast_with_actual_v TO authenticated;
