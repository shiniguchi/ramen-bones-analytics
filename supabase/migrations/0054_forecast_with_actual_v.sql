-- kpi_daily_mv is wide-form (revenue_cents, tx_count, avg_ticket_cents) while
-- forecast_daily_mv is long-form (kpi_name). Use CASE to unpivot the actual
-- value from the correct column based on forecast kpi_name.
CREATE OR REPLACE VIEW public.forecast_with_actual_v AS
SELECT
    f.restaurant_id, f.kpi_name, f.target_date, f.model_name, f.forecast_track,
    f.run_date, f.yhat, f.yhat_lower, f.yhat_upper, f.horizon_days, f.exog_signature,
    CASE f.kpi_name
        WHEN 'revenue_eur' THEN k.revenue_cents / 100.0
        WHEN 'invoice_count' THEN k.tx_count::double precision
    END AS actual_value
FROM public.forecast_daily_mv f
LEFT JOIN public.kpi_daily_mv k
    ON k.restaurant_id = f.restaurant_id
    AND k.business_date = f.target_date
WHERE f.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid;

GRANT SELECT ON public.forecast_with_actual_v TO authenticated;
