-- 0035_insights_action_points.sql
-- Adds action_points TEXT[] column to public.insights and refreshes insights_v.
-- Bullets are written by the nightly generate-insight Edge Function (Haiku tool-use)
-- and rendered by the dashboard InsightCard. Default '{}' backfills existing rows
-- so the view never returns NULL for the new column during the transition day.

ALTER TABLE public.insights
  ADD COLUMN IF NOT EXISTS action_points TEXT[] NOT NULL DEFAULT '{}';

-- Refresh the tenant-facing wrapper view to expose the new column.
-- security_invoker pattern unchanged; input_payload still omitted (audit-only).
CREATE OR REPLACE VIEW public.insights_v
  WITH (security_invoker = true) AS
SELECT
  id,
  restaurant_id,
  business_date,
  generated_at,
  headline,
  body,
  action_points,
  model,
  fallback_used
FROM public.insights
WHERE restaurant_id::text = (auth.jwt()->>'restaurant_id');
