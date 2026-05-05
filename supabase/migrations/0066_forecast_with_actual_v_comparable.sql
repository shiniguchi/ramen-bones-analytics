-- 0066_forecast_with_actual_v_comparable.sql
-- Phase 16 Plan 12 follow-up (Rule 3 — blocking bug): extend forecast_with_actual_v
-- to surface actual_value for kpi_name='revenue_comparable_eur'.
--
-- Why this migration exists:
--   forecast_with_actual_v (mig 0054, last touched in 0065) has a CASE
--   expression that maps f.kpi_name to actual_value:
--     CASE f.kpi_name
--       WHEN 'revenue_eur'    THEN k.revenue_cents / 100.0
--       WHEN 'invoice_count'  THEN k.tx_count::double precision
--     END
--   When Phase 16 introduced kpi_name='revenue_comparable_eur' (D-04 / Guard 9)
--   for Track-B (counterfactual) fits, the CASE was not extended. CF rows
--   appeared in the view with actual_value=NULL even though the comparable
--   actuals exist in kpi_daily_with_comparable_v.revenue_comparable_eur.
--
--   Result: cumulative_uplift.compute_uplift_for_window receives 0 actuals,
--   bootstrap CI fails the empty-window guard, no rows land in
--   campaign_uplift, sensitivity grid is empty.
--
--   This was untestable from Plan 05/06 internal tests (mocked DB clients);
--   first end-to-end DEV exposure was during Plan 12 sensitivity runs on
--   2026-05-04. Surfaces alongside three other Wave-2 spec gap fixes folded
--   into 16-12 budget (started_at probe, migration 0065, pred_dates anchor).
--
-- Fix: LEFT JOIN kpi_daily_with_comparable_v and extend the CASE.
--
-- Side condition: kpi_daily_with_comparable_v has its own JWT predicate. Since
-- forecast_with_actual_v already has JWT-or-service_role access via 0065,
-- joining the comparable view introduces the same predicate transitively;
-- this is correct — both predicates evaluate to TRUE for service_role and
-- to (restaurant_id = jwt.restaurant_id) for authenticated. No new attack
-- surface.

CREATE OR REPLACE VIEW public.forecast_with_actual_v AS
SELECT
    f.restaurant_id, f.kpi_name, f.target_date, f.model_name, f.granularity, f.forecast_track,
    f.run_date, f.yhat, f.yhat_lower, f.yhat_upper, f.horizon_days, f.exog_signature,
    CASE f.kpi_name
        WHEN 'revenue_eur'           THEN k.revenue_cents / 100.0
        WHEN 'invoice_count'         THEN k.tx_count::double precision
        WHEN 'revenue_comparable_eur' THEN c.revenue_comparable_eur::double precision
    END AS actual_value
FROM public.forecast_daily_mv f
LEFT JOIN public.kpi_daily_mv k
    ON k.restaurant_id = f.restaurant_id
   AND k.business_date = f.target_date
LEFT JOIN public.kpi_daily_with_comparable_v c
    ON c.restaurant_id = f.restaurant_id
   AND c.business_date = f.target_date
WHERE (auth.jwt()->>'restaurant_id') IS NULL
   OR f.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid;

GRANT SELECT ON public.forecast_with_actual_v TO authenticated;

COMMENT ON VIEW public.forecast_with_actual_v IS
  'Phase 14 view (migration 0054, JWT filter relaxed in 0065, comparable branch added in 0066): joins forecast_daily_mv with kpi_daily_mv (revenue_eur/invoice_count) and kpi_daily_with_comparable_v (revenue_comparable_eur) to expose actual_value for any kpi_name the forecast row carries. Required for Track-B (CF) cumulative_uplift to read non-NULL actuals.';
