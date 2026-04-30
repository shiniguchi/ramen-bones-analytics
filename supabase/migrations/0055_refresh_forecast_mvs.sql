CREATE OR REPLACE FUNCTION public.refresh_forecast_mvs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.forecast_daily_mv;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_forecast_mvs() FROM public;
GRANT EXECUTE ON FUNCTION public.refresh_forecast_mvs() TO service_role;
