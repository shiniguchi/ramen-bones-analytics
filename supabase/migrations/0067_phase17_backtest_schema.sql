-- supabase/migrations/0067_phase17_backtest_schema.sql
-- Phase 17 — Backtest Gate & Quality Monitoring (BCK-04 + BCK-08)
-- Three atomic changes:
--   1. ALTER public.forecast_quality — add 4 nullable diagnostic columns for rolling_origin_cv rows
--   2. INSERT into public.feature_flags — seed 6 per-model gate rows per restaurant (D-04/D-06)
--   3. DROP+CREATE public.data_freshness_v — UNION branch for forecast cascade stages (D-10/BCK-08)
-- Single-column-shape contract preserved: SSR `+page.server.ts` consumers and FreshnessLabel.svelte
-- read the same `(restaurant_id, last_ingested_at)` shape — see RESEARCH §Codebase Reuse Map deliverable 8.

-- ────────────────────────────────────────────────────────────────────────
-- Section 1: forecast_quality diagnostic columns (D-04 / BCK-01)
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.forecast_quality
  ADD COLUMN IF NOT EXISTS fold_index      integer,
  ADD COLUMN IF NOT EXISTS train_end_date  date,
  ADD COLUMN IF NOT EXISTS eval_start_date date,
  ADD COLUMN IF NOT EXISTS gate_verdict    text
    CHECK (gate_verdict IN ('PASS', 'FAIL', 'PENDING', 'UNCALIBRATED') OR gate_verdict IS NULL);

COMMENT ON COLUMN public.forecast_quality.fold_index IS
  'Phase 17 BCK-01: 0..3 for rolling_origin_cv rows; NULL for last_7_days rows.';
COMMENT ON COLUMN public.forecast_quality.train_end_date IS
  'Phase 17 BCK-01: training cutoff for the fold; NULL for last_7_days rows.';
COMMENT ON COLUMN public.forecast_quality.eval_start_date IS
  'Phase 17 BCK-01: first date of the fold''s evaluation window; NULL for last_7_days rows.';
COMMENT ON COLUMN public.forecast_quality.gate_verdict IS
  'Phase 17 BCK-04: aggregated verdict per (model, horizon) used by ACCURACY-LOG and feature_flags writer.';

-- ────────────────────────────────────────────────────────────────────────
-- Section 2: feature_flags per-model seed (D-04 / D-06 / BCK-04)
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO public.feature_flags (restaurant_id, flag_key, enabled, description)
SELECT r.id, m.flag_key, true, m.description
FROM public.restaurants r
CROSS JOIN (VALUES
  ('model_sarimax',                 'Phase 17 BCK-04: SARIMAX gated by rolling-origin CV at h=7/35/120/365.'),
  ('model_prophet',                 'Phase 17 BCK-04: Prophet gated by rolling-origin CV at h=7/35/120/365.'),
  ('model_ets',                     'Phase 17 BCK-04: ETS gated by rolling-origin CV at h=7/35/120/365.'),
  ('model_theta',                   'Phase 17 BCK-04: Theta gated by rolling-origin CV at h=7/35/120/365.'),
  ('model_naive_dow',               'Phase 17 BCK-04: naive_dow baseline (always-on; gate compares challengers against THIS).'),
  ('model_naive_dow_with_holidays', 'Phase 17 BCK-03: regressor-aware naive baseline.')
) m(flag_key, description)
ON CONFLICT (restaurant_id, flag_key) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────
-- Section 3: data_freshness_v cascade-stage UNION extension (D-10 / BCK-08)
-- ────────────────────────────────────────────────────────────────────────
-- Returns the LATEST freshness timestamp across transactions ingest + forecast
-- pipeline runs. FreshnessLabel.svelte reads the unchanged column shape and
-- surfaces yellow >24h / red >30h automatically (after threshold tightening).
DROP VIEW IF EXISTS public.data_freshness_v;
CREATE VIEW public.data_freshness_v
WITH (security_invoker = true) AS
WITH all_stages AS (
  -- Stage 1: transactions ingest (existing branch — unchanged shape)
  SELECT
    t.restaurant_id,
    MAX(t.created_at) AS stage_last
  FROM public.transactions t
  WHERE t.restaurant_id::text = (auth.jwt() ->> 'restaurant_id')
  GROUP BY t.restaurant_id

  UNION ALL

  -- Stage 2: forecast pipeline cascade (NEW per BCK-08)
  -- step_name literals verified against scripts/forecast/*_fit.py STEP_NAME constants:
  --   forecast_run_all (run_all.py:42), forecast_sarimax (sarimax_fit.py:50),
  --   forecast_prophet (prophet_fit.py:57), forecast_ets (ets_fit.py:47),
  --   forecast_theta (theta_fit.py:46), forecast_naive_dow (naive_dow_fit.py:50),
  --   forecast_backtest (backtest.py — Phase 17 new), forecast_naive_dow_with_holidays (Phase 17 new)
  SELECT
    pr.restaurant_id,
    MAX(pr.finished_at) AS stage_last
  FROM public.pipeline_runs pr
  WHERE pr.status = 'success'
    AND pr.step_name IN (
      'forecast_run_all',
      'forecast_backtest',
      'forecast_sarimax',
      'forecast_prophet',
      'forecast_ets',
      'forecast_theta',
      'forecast_naive_dow',
      'forecast_naive_dow_with_holidays'
    )
    AND (
      pr.restaurant_id IS NULL  -- Phase 12 audit-script global rows
      OR pr.restaurant_id::text = (auth.jwt() ->> 'restaurant_id')
    )
  GROUP BY pr.restaurant_id
)
SELECT
  restaurant_id,
  -- MIN(stage_last) = the stalest stage drives the freshness label
  MIN(stage_last) AS last_ingested_at
FROM all_stages
WHERE restaurant_id IS NOT NULL  -- drop global Phase 12 audit rows from per-tenant output
GROUP BY restaurant_id;

GRANT SELECT ON public.data_freshness_v TO authenticated;

COMMENT ON VIEW public.data_freshness_v IS
  'Phase 17 BCK-08: returns stalest cascade-stage timestamp per restaurant. '
  'UNION branches: (1) transactions.created_at, (2) pipeline_runs.finished_at for forecast steps. '
  'security_invoker=true enforces auth.jwt()->>''restaurant_id'' RLS via underlying tables.';
