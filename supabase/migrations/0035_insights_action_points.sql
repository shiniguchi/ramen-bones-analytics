-- 0035_insights_action_points.sql
-- Adds action_points TEXT[] column to public.insights and refreshes insights_v.
-- Bullets are written by the nightly generate-insight Edge Function (Haiku tool-use)
-- and rendered by the dashboard InsightCard. Default '{}' backfills existing rows
-- so the view never returns NULL for the new column during the transition day.

ALTER TABLE public.insights
  ADD COLUMN IF NOT EXISTS action_points TEXT[] NOT NULL DEFAULT '{}';

-- Refresh the tenant-facing wrapper view to expose the new column.
-- input_payload still omitted (audit-only).
--
-- Column order preserves the existing suffix (model, fallback_used) and appends
-- action_points at the end — CREATE OR REPLACE VIEW in Postgres cannot insert
-- a new column in the middle of the SELECT list (SQLSTATE 42P16), it can only
-- append. Column order in a view is cosmetic; consumers select by name.
--
-- Flipped `security_invoker = true` → `false` to fix the pre-existing
-- "permission denied for table insights" bug documented in the project memory
-- (2026-04-17). With security_invoker=true the view executes as the invoking
-- role (authenticated), which has no SELECT on public.insights (service_role
-- only by design). With security_invoker=false (owner-invoked, the default)
-- the view runs as postgres and can read the base table, while the WHERE
-- clause auth.jwt()->>'restaurant_id' still enforces tenant isolation — this
-- is the canonical Supabase wrapper-view pattern.
CREATE OR REPLACE VIEW public.insights_v
  WITH (security_invoker = false) AS
SELECT
  id,
  restaurant_id,
  business_date,
  generated_at,
  headline,
  body,
  model,
  fallback_used,
  action_points
FROM public.insights
WHERE restaurant_id::text = (auth.jwt()->>'restaurant_id');
