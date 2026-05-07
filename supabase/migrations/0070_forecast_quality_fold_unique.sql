-- supabase/migrations/0070_forecast_quality_fold_unique.sql
-- Fix: forecast_quality had no uniqueness on fold_index, so multiple backtest
-- runs accumulated duplicate rows per (model, kpi, horizon, fold). The PK
-- includes evaluated_at=now() which is always fresh, so upserts always INSERT.
--
-- Two changes:
--   1. Deduplicate: keep the best row per fold (non-null rmse, lowest rmse, newest)
--   2. Add unique constraint on (restaurant_id, kpi_name, model_name, horizon_days,
--      evaluation_window, fold_index) as a safety net for future runs.
--      NULL fold_index rows (last_7_days) are unaffected — PostgreSQL treats each
--      NULL as distinct so multiple NULL-fold rows never violate this constraint.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Deduplicate rolling_origin_cv rows — keep best per fold
-- ─────────────────────────────────────────────────────────────────────────
DELETE FROM public.forecast_quality
WHERE evaluation_window = 'rolling_origin_cv'
  AND fold_index IS NOT NULL
  AND ctid NOT IN (
    SELECT DISTINCT ON (restaurant_id, kpi_name, model_name, horizon_days, evaluation_window, fold_index)
      ctid
    FROM public.forecast_quality
    WHERE evaluation_window = 'rolling_origin_cv'
      AND fold_index IS NOT NULL
    ORDER BY
      restaurant_id, kpi_name, model_name, horizon_days, evaluation_window, fold_index,
      (rmse IS NOT NULL) DESC,   -- rows with actual RMSE beat PENDING rows
      rmse ASC NULLS LAST,       -- lower RMSE = better model
      evaluated_at DESC          -- most recent run as tiebreak
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Unique constraint — prevents future duplicate fold rows
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.forecast_quality
  ADD CONSTRAINT forecast_quality_fold_unique
  UNIQUE (restaurant_id, kpi_name, model_name, horizon_days, evaluation_window, fold_index);

COMMENT ON CONSTRAINT forecast_quality_fold_unique ON public.forecast_quality IS
  'Prevents duplicate rows per (model, kpi, horizon, fold) across backtest runs. '
  'NULL fold_index rows (last_7_days) are exempt — PostgreSQL treats NULLs as distinct.';
