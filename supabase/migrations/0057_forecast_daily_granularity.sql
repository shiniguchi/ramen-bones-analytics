-- 0057_forecast_daily_granularity.sql
-- Phase 15 v2 D-14: per-grain forecasts. Each refresh writes 3 rows per
-- (model, target_date) — one for each (day, week, month) granularity —
-- so the chart can show a daily forecast trained at last_actual−7d AND
-- a weekly forecast trained at last_actual−5w AND a monthly forecast
-- trained at end-of-month−5mo, all from the same forecast_daily table.
--
-- Backfill safety: ALTER ADD COLUMN with DEFAULT is O(rows) on PG12+.
-- forecast_daily currently holds Phase 14's nightly runs (all daily
-- grain), so DEFAULT 'day' produces correct historical labelling.
-- Then DROP DEFAULT so future inserts must specify granularity.

ALTER TABLE public.forecast_daily
  ADD COLUMN IF NOT EXISTS granularity text NOT NULL DEFAULT 'day'
    CHECK (granularity IN ('day', 'week', 'month'));

ALTER TABLE public.forecast_daily ALTER COLUMN granularity DROP DEFAULT;

-- Drop + recreate PK to include granularity in the natural key.
-- Existing key was (restaurant_id, kpi_name, target_date, model_name, run_date, forecast_track).
ALTER TABLE public.forecast_daily DROP CONSTRAINT forecast_daily_pkey;
ALTER TABLE public.forecast_daily ADD PRIMARY KEY
  (restaurant_id, kpi_name, target_date, model_name, granularity, run_date, forecast_track);

-- Rebuild forecast_daily_mv with granularity in select + unique index.
DROP MATERIALIZED VIEW IF EXISTS public.forecast_daily_mv CASCADE;

CREATE MATERIALIZED VIEW public.forecast_daily_mv AS
SELECT DISTINCT ON (restaurant_id, kpi_name, target_date, model_name, granularity, forecast_track)
    restaurant_id, kpi_name, target_date, model_name, granularity, forecast_track,
    run_date, yhat, yhat_lower, yhat_upper, horizon_days, exog_signature
FROM public.forecast_daily
ORDER BY restaurant_id, kpi_name, target_date, model_name, granularity, forecast_track, run_date DESC;

CREATE UNIQUE INDEX forecast_daily_mv_uq
    ON public.forecast_daily_mv
    (restaurant_id, kpi_name, target_date, model_name, granularity, forecast_track);

REVOKE ALL ON public.forecast_daily_mv FROM authenticated, anon;

-- Rebuild forecast_with_actual_v to include granularity passthrough.
-- Actual is keyed by business_date (daily-grain only); for weekly/monthly
-- forecasts the consumer (Phase 15 v2 endpoint) joins to k via target_date
-- which is already the bucket-start date for those grains, so the LEFT JOIN
-- works for daily but produces NULL actual_value for weekly/monthly rows
-- whose target_date doesn't land on a daily kpi_daily_mv row. The Phase
-- 15-11 endpoint handles that by building actuals from kpi_daily_mv directly
-- for the back-test window.
CREATE OR REPLACE VIEW public.forecast_with_actual_v AS
SELECT
    f.restaurant_id, f.kpi_name, f.target_date, f.model_name, f.granularity, f.forecast_track,
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
