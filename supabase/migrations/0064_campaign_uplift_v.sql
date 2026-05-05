-- 0064_campaign_uplift_v.sql
-- Phase 16 D-08 / UPL-04 / UPL-05: campaign_uplift backing table + wrapper views
-- + DB CHECK constraint on forecast_daily forbidding (cf, revenue_eur) co-occurrence.
--
-- Per RESEARCH §1 / 16-PATTERNS.md: backing table populated nightly by
-- scripts/forecast/cumulative_uplift.py (Plan 06) + thin wrapper views with
-- auth.jwt()->>'restaurant_id' RLS. View-only would re-run the bootstrap CI on
-- every page load — too slow.
--
-- Per RESEARCH §6: DB CHECK constraint is the PRIMARY mitigation of T-16-05
-- (Track-B writing raw revenue_eur). Grep guard 9 (Plan 11) is secondary lint.
--
-- THIS MIGRATION ALSO RELAXES THE forecast_daily.kpi_name CHECK [Rule 3 deviation]:
--   Plan 05's counterfactual_fit.py writes kpi_name='revenue_comparable_eur' for
--   forecast_track='cf' rows. The original 0050_forecast_daily.sql CHECK only
--   permits ('revenue_eur', 'invoice_count'); without relaxing it, every CF
--   forecast_daily INSERT raises constraint violation and the cumulative_uplift
--   pipeline silently emits zero rows. We extend the allow-list to include
--   'revenue_comparable_eur' AND simultaneously add the cf-not-raw-revenue
--   guard. Both changes belong in this migration so the DEV push is one atomic
--   schema sync.

-- ---------------------------------------------------------------------------
-- Part 0 (Rule 3 prerequisite): allow kpi_name='revenue_comparable_eur'.
-- ---------------------------------------------------------------------------
-- The original CHECK from 0050 (kpi_name IN ('revenue_eur', 'invoice_count'))
-- is identified by its system-generated name `forecast_daily_kpi_name_check`.
-- Drop and recreate to add 'revenue_comparable_eur' to the allow-list.
ALTER TABLE public.forecast_daily DROP CONSTRAINT IF EXISTS forecast_daily_kpi_name_check;
ALTER TABLE public.forecast_daily
  ADD CONSTRAINT forecast_daily_kpi_name_check
  CHECK (kpi_name IN ('revenue_eur', 'invoice_count', 'revenue_comparable_eur'));

-- ---------------------------------------------------------------------------
-- Part A: campaign_uplift backing table.
-- ---------------------------------------------------------------------------
-- PK includes window_kind AND as_of_date so:
--   - per_day rows do not collide with per-window aggregates
--   - nightly per-window rows accumulate as audit history (fresh row per run)
-- DISTINCT ON in the wrapper view dedups per-window rows to the latest as_of_date.
-- Per-day rows are naturally unique by (campaign, model, day) because each day's
-- as_of_date IS that day.

CREATE TABLE public.campaign_uplift (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  campaign_id text NOT NULL,
  model_name text NOT NULL,
  window_kind text NOT NULL CHECK (window_kind IN ('campaign_window', 'cumulative_since_launch', 'per_day')),
  cumulative_uplift_eur numeric(14,2) NOT NULL,
  ci_lower_eur numeric(14,2) NOT NULL,
  ci_upper_eur numeric(14,2) NOT NULL,
  naive_dow_uplift_eur numeric(14,2),
  n_days integer NOT NULL CHECK (n_days >= 0),
  as_of_date date NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, campaign_id, model_name, window_kind, as_of_date)
);

COMMENT ON TABLE public.campaign_uplift IS 'Phase 16 D-08 + D-11: per-(campaign × model × window_kind × as_of_date) cumulative uplift with 95% bootstrap CI. window_kind=campaign_window/cumulative_since_launch hold per-window aggregates (one row per nightly run — historical rows accumulate on the backing table for audit; campaign_uplift_v dedups to the latest as_of_date); window_kind=per_day holds the per-day rolling cumulative trajectory powering the dashboard sparkline (each row uses as_of_date=that_day, so per-day rows are stable across runs). Populated by scripts/forecast/cumulative_uplift.py.';

-- Index supports the wrapper-view DISTINCT ON sort and tenant-scoped reads.
CREATE INDEX campaign_uplift_lookup_idx
  ON public.campaign_uplift(restaurant_id, campaign_id, model_name, window_kind, as_of_date DESC);

-- RLS: tenant-scoped read; service_role writes only (cumulative_uplift.py uses service_role).
-- Verbatim shape from supabase/migrations/0050_forecast_daily.sql lines 18-21.
ALTER TABLE public.campaign_uplift ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaign_uplift_select ON public.campaign_uplift
  FOR SELECT USING (restaurant_id = (auth.jwt()->>'restaurant_id')::uuid);
REVOKE INSERT, UPDATE, DELETE ON public.campaign_uplift FROM authenticated, anon;
GRANT SELECT ON public.campaign_uplift TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_uplift TO service_role;

-- ---------------------------------------------------------------------------
-- Part B1: campaign_uplift_v — headline wrapper view (per-window aggregates).
-- ---------------------------------------------------------------------------
-- DISTINCT ON dedup: keeps only the latest as_of_date per
-- (restaurant_id, campaign_id, model_name, window_kind). The backing table
-- accumulates one row per nightly run (as_of_date in PK) for audit/replay,
-- but the API headline pick (Plan 08) needs exactly one row per group.
-- Without DISTINCT ON, after N nights the view returns N rows per group and
-- the SvelteKit `find()` headline logic becomes nondeterministic.

CREATE OR REPLACE VIEW public.campaign_uplift_v AS
SELECT DISTINCT ON (u.restaurant_id, u.campaign_id, u.model_name, u.window_kind)
  u.restaurant_id,
  u.campaign_id,
  cc.start_date AS campaign_start,
  cc.end_date AS campaign_end,
  cc.name AS campaign_name,
  cc.channel AS campaign_channel,
  u.model_name,
  u.window_kind,
  u.cumulative_uplift_eur,
  u.ci_lower_eur,
  u.ci_upper_eur,
  u.naive_dow_uplift_eur,
  u.n_days,
  u.as_of_date,
  u.computed_at
FROM public.campaign_uplift u
INNER JOIN public.campaign_calendar cc
  ON cc.restaurant_id = u.restaurant_id
  AND cc.campaign_id = u.campaign_id
WHERE u.window_kind IN ('campaign_window', 'cumulative_since_launch')
  AND u.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid
ORDER BY u.restaurant_id, u.campaign_id, u.model_name, u.window_kind, u.as_of_date DESC;

GRANT SELECT ON public.campaign_uplift_v TO authenticated;
COMMENT ON VIEW public.campaign_uplift_v IS 'Phase 16 D-08: read-only campaign_uplift headline rows (per-window aggregates) joined to campaign_calendar; tenant-scoped. DISTINCT ON dedup ensures exactly 1 row per (campaign_id, model_name, window_kind) — the latest as_of_date — even though the backing table accumulates historical rows across nightly runs (each nightly run inserts a fresh aggregate row with as_of_date=run_date for audit/replay). Per-day rows surfaced via campaign_uplift_daily_v.';

-- ---------------------------------------------------------------------------
-- Part B2: campaign_uplift_daily_v — sister view for per-day sparkline (D-11).
-- ---------------------------------------------------------------------------
-- No DISTINCT ON because per-day rows are naturally unique by
-- (restaurant_id, campaign_id, model_name, as_of_date) — each day in the
-- window writes once with as_of_date=that_day. Same backing table as
-- campaign_uplift_v, different window_kind filter — no duplicate storage.

CREATE OR REPLACE VIEW public.campaign_uplift_daily_v AS
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
WHERE u.window_kind = 'per_day'
  AND u.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid;

GRANT SELECT ON public.campaign_uplift_daily_v TO authenticated;
COMMENT ON VIEW public.campaign_uplift_daily_v IS 'Phase 16 D-11: read-only per-day cumulative uplift trajectory for the dashboard sparkline (LayerChart Spline + Area CI band). Tenant-scoped. Same backing table as campaign_uplift_v but filtered to window_kind=per_day rows. No DISTINCT ON because per-day rows are unique by (campaign, model, as_of_date) construction (each day in the window writes once).';

-- ---------------------------------------------------------------------------
-- Part C: forecast_daily CHECK constraint — primary T-16-05 mitigation.
-- ---------------------------------------------------------------------------
-- Per RESEARCH §6: DB-level CHECK constraint forbidding the (cf, revenue_eur)
-- co-occurrence is mathematically airtight at the data layer. The grep guard
-- (Guard 9, Plan 11) is secondary lint for fast-fail in code review.
--
-- This CHECK is added AFTER forecast_daily is in use (post-Phase 14). PostgreSQL
-- validates the constraint against existing rows; if any (cf, revenue_eur) rows
-- exist (none should — Plan 05 sources from revenue_comparable_eur per Task 4),
-- this migration fails. Per project_silent_error_isolation.md: that is correct
-- behavior — fail loud, don't paper over with NOT VALID.
ALTER TABLE public.forecast_daily
  ADD CONSTRAINT forecast_daily_cf_not_raw_revenue
  CHECK (NOT (forecast_track = 'cf' AND kpi_name = 'revenue_eur'));

COMMENT ON CONSTRAINT forecast_daily_cf_not_raw_revenue ON public.forecast_daily IS
  'Phase 16 RESEARCH §6 / T-16-05 primary mitigation: forbid Track-B fits on raw revenue_eur. CF rows must source from kpi_daily_with_comparable_v.revenue_comparable_eur.';
