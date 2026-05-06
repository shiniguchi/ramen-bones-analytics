-- supabase/migrations/0068_phase17_backtest_schema_gap.sql
-- Phase 17 — Gap closure for migration 0067:
--   1. ADD qhat column (omitted from 0067)
--   2. Relax n_days/rmse/mape/mean_bias to NULLABLE for rolling_origin_cv PENDING rows
--   3. Add CHECK constraint forcing gate_verdict NOT NULL on rolling_origin_cv rows (BCK-04)

-- ─────────────────────────────────────────────────────────────────────────
-- 1. qhat column (BCK-02 conformal calibration result)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.forecast_quality
  ADD COLUMN IF NOT EXISTS qhat double precision;

COMMENT ON COLUMN public.forecast_quality.qhat IS
  'Phase 17 BCK-02: conformal prediction interval half-width at h=35, pooled across folds. NULL for last_7_days rows.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Relax NOT NULL on metric columns (allow PENDING rows with no metrics)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.forecast_quality
  ALTER COLUMN n_days   DROP NOT NULL,
  ALTER COLUMN rmse     DROP NOT NULL,
  ALTER COLUMN mape     DROP NOT NULL,
  ALTER COLUMN mean_bias DROP NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Enforce gate_verdict NOT NULL for rolling_origin_cv rows (BCK-04)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.forecast_quality
  ADD CONSTRAINT forecast_quality_rolling_origin_cv_verdict_required
  CHECK (
    evaluation_window != 'rolling_origin_cv'
    OR gate_verdict IS NOT NULL
  );
