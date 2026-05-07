-- supabase/migrations/0069_campaign_uplift_iso_week.sql
-- Phase 18 — Weekly Counterfactual Window (UPL-08)
-- Two atomic changes:
--   1. Extend CHECK constraint on campaign_uplift.window_kind to allow 'iso_week' value.
--   2. Create wrapper view public.campaign_uplift_weekly_v (sister to campaign_uplift_daily_v).
-- Single atomic migration per the codebase convention set by 0064 (one logical unit
-- per file). Existing campaign_uplift_v + campaign_uplift_daily_v wrapper views are
-- unaffected — they filter to other window_kind values and stay back-compat.
-- Per CONTEXT.md line 27: iso_week rows write as_of_date = the Sunday of the ISO week,
-- making them unique by (campaign, model, as_of_date) and stable across nightly runs.

-- ────────────────────────────────────────────────────────────────────────
-- Section 1: extend window_kind CHECK constraint to include 'iso_week'
-- ────────────────────────────────────────────────────────────────────────
-- The original CHECK from 0064:48 (window_kind IN ('campaign_window',
-- 'cumulative_since_launch', 'per_day')) is identified by its system-generated
-- name `campaign_uplift_window_kind_check` (PostgreSQL convention: <table>_<column>_check).
-- Drop and recreate to add 'iso_week' to the allow-list. PostgreSQL revalidates
-- the new CHECK against existing rows; all current values (campaign_window,
-- cumulative_since_launch, per_day) remain in the new allow-list, so revalidation
-- passes with no data migration.
ALTER TABLE public.campaign_uplift
  DROP CONSTRAINT IF EXISTS campaign_uplift_window_kind_check;
ALTER TABLE public.campaign_uplift
  ADD CONSTRAINT campaign_uplift_window_kind_check
  CHECK (window_kind IN ('campaign_window', 'cumulative_since_launch', 'per_day', 'iso_week'));

COMMENT ON COLUMN public.campaign_uplift.window_kind IS
  'Phase 16: campaign_window | cumulative_since_launch | per_day. '
  'Phase 18 (UPL-08): iso_week added — one row per fully-completed ISO week (Mon-Sun) '
  'since campaign launch with as_of_date = the Sunday of that week. Re-fits bootstrap '
  'CI on the 7-day slice; never derives weekly CI by subtracting daily cumulative bounds.';

-- ────────────────────────────────────────────────────────────────────────
-- Section 2: tenant-scoped wrapper view for the dashboard bar chart
-- Mirror of campaign_uplift_daily_v (0064:120-143) with WHERE clause swapped
-- to filter window_kind='iso_week'. No DISTINCT ON — per-week rows are unique
-- by (campaign, model, as_of_date=Sunday) by construction and idempotent across
-- nightly runs (the upsert PK includes window_kind + as_of_date).
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.campaign_uplift_weekly_v AS
SELECT
  u.restaurant_id,
  u.campaign_id,
  cc.start_date AS campaign_start,
  cc.end_date AS campaign_end,
  cc.name AS campaign_name,
  cc.channel AS campaign_channel,
  u.model_name,
  u.cumulative_uplift_eur,
  u.ci_lower_eur,
  u.ci_upper_eur,
  u.n_days,
  u.as_of_date,
  u.computed_at
FROM public.campaign_uplift u
INNER JOIN public.campaign_calendar cc
  ON cc.restaurant_id = u.restaurant_id
  AND cc.campaign_id = u.campaign_id
WHERE u.window_kind = 'iso_week'
  AND u.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid;

GRANT SELECT ON public.campaign_uplift_weekly_v TO authenticated;

COMMENT ON VIEW public.campaign_uplift_weekly_v IS
  'Phase 18 (UPL-08): read-only per-ISO-week (Mon-Sun) cumulative uplift trajectory '
  'for the CampaignUpliftCard bar chart. Tenant-scoped via the inline auth.jwt() filter '
  '(belt-and-suspenders matching 0064 precedent). Same backing table as campaign_uplift_v '
  'but filtered to window_kind=iso_week rows. No DISTINCT ON because iso_week rows are '
  'unique by (campaign, model, as_of_date=Sunday) by construction (each completed week '
  'writes once per nightly run with as_of_date pinned to the Sunday — upsert is idempotent).';
