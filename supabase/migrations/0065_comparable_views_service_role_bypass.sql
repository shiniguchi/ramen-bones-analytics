-- 0065_comparable_views_service_role_bypass.sql
-- Phase 16 Plan 12 hotfix (Rule 3 — blocking deviation, Wave 4 of Phase 16).
--
-- Problem:
--   Migrations 0054 (forecast_with_actual_v), 0059 (baseline_items_v),
--   0060 (kpi_daily_with_comparable_v), and 0064 (campaign_uplift_v +
--   campaign_uplift_daily_v) all filter their final SELECT with
--     WHERE <table>.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid
--   This is fine for AUTHENTICATED dashboard sessions (JWT carries
--   restaurant_id; tenant scope is enforced).
--
--   But the forecast pipeline (`scripts/forecast/run_all.py` + the
--   `counterfactual_fit.py` track-B fits + `cumulative_uplift.py`) runs
--   under the SERVICE_ROLE key. service_role has `bypassrls=true` at the
--   role level, but there is no JWT — `auth.jwt()` returns NULL. So
--   `(auth.jwt()->>'restaurant_id')::uuid` evaluates to NULL, and
--   `<col> = NULL` is always FALSE. Every CF query against these views
--   silently returns 0 rows under service_role.
--
--   Live verification (Plan 12 executor probe, 2026-05-03):
--     kpi_daily_mv:                239 rows under service_role  (raw, no JWT filter)
--     forecast_daily (raw):       7300 rows under service_role  (raw, no JWT filter)
--     forecast_with_actual_v:        0 rows under service_role  (broken)
--     baseline_items_v:              0 rows under service_role  (broken)
--     kpi_daily_with_comparable_v:   0 rows under service_role  (broken)
--     campaign_uplift_v:             0 rows under service_role  (broken)
--
--   Consequence: counterfactual_fit cannot read training data → 0 CF rows
--   ever land in forecast_daily. cumulative_uplift cannot read
--   forecast_with_actual_v → 0 campaign_uplift rows ever land. The whole
--   ITS attribution pipeline is dead at the data layer.
--
-- Fix:
--   Relax the JWT filter to permit service_role (no JWT) AND authenticated
--   dashboard sessions (tenant-scoped):
--
--     WHERE (auth.jwt()->>'restaurant_id') IS NULL
--        OR <table>.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid
--
--   Pattern precedent: migration 0046_pipeline_runs_extend.sql line 27-28
--   uses the same `IS NULL OR ... = jwt-claim` shape for its RLS policy
--   (admittedly there for nullable restaurant_id rows, not for service-role
--   bypass — but the SQL idiom is identical and the resulting predicate
--   semantics are precisely what we need).
--
--   service_role gets full table access; authenticated stays tenant-scoped.
--   anon — no JWT — would also see all rows, BUT the GRANT statements on
--   each view (`GRANT SELECT ... TO authenticated`) explicitly do NOT grant
--   to anon, so anon access stays denied at the privilege layer (verify
--   with `\dp public.kpi_daily_with_comparable_v` post-migration).
--
-- Scope:
--   Recreates the 5 affected views (4 views + 1 sister view in 0064) with
--   identical body except for the relaxed WHERE clause. NO data changes.
--   NO schema changes. NO new objects. Idempotent re-runnable.
--
-- Risk:
--   LOW. The relaxation only widens visibility for callers that have NO
--   JWT (i.e., service_role and unauthenticated). anon access is still
--   gated by GRANT (no SELECT privilege granted to anon). authenticated
--   sessions continue to see only their own restaurant_id (the second
--   branch of the OR holds; the first NULL branch is FALSE because
--   authenticated JWTs always carry restaurant_id).
--
-- Plan-level deviation classification:
--   Rule 3 (auto-fix blocking issue) — this gap was inherited from
--   Wave-2 spec (CONTEXT.md C-06: "Hybrid RLS — auth.jwt()->>'restaurant_id'
--   filter; REVOKE on MVs; wrapper-view-only access from SvelteKit") which
--   did not anticipate the service_role-side read path. Plan 03's
--   executor mirrored the literal SQL from CONTEXT.md / Phase 14 patterns,
--   inheriting Phase 14's same gap (0054). This migration is the first
--   one written with the service-role read path in mind.

-- ---------------------------------------------------------------------------
-- Part A: forecast_with_actual_v (originally migration 0054).
-- ---------------------------------------------------------------------------

-- Live DEV column list (verified 2026-05-03 via REST OpenAPI introspection):
--   restaurant_id, kpi_name, target_date, model_name, granularity,
--   forecast_track, run_date, yhat, yhat_lower, yhat_upper, horizon_days,
--   exog_signature, actual_value
-- The `granularity` column was added by migration 0057 (Phase 15 D-15) and
-- MUST be preserved here — `CREATE OR REPLACE VIEW` requires the new
-- definition to be a strict superset of the existing column list.

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
WHERE (auth.jwt()->>'restaurant_id') IS NULL
   OR f.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid;

GRANT SELECT ON public.forecast_with_actual_v TO authenticated;

COMMENT ON VIEW public.forecast_with_actual_v IS
  'Phase 14 view (migration 0054) extended by Phase 16 Plan 12 (migration 0065): JWT filter relaxed to permit service_role reads alongside authenticated tenant-scoped reads. Required for cumulative_uplift.py to read CF rows + actuals during the ITS attribution pipeline.';

-- ---------------------------------------------------------------------------
-- Part B: baseline_items_v (originally migration 0059).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.baseline_items_v AS
WITH first_seen AS (
  SELECT
    oi.restaurant_id,
    oi.item_name,
    MIN(t.occurred_at::date) AS first_seen_date
  FROM public.stg_orderbird_order_items oi
  JOIN public.transactions t
    ON t.restaurant_id = oi.restaurant_id
   AND t.source_tx_id  = oi.invoice_number
  WHERE oi.item_name IS NOT NULL
    AND oi.item_name <> ''
  GROUP BY oi.restaurant_id, oi.item_name
),
min_campaign AS (
  SELECT
    restaurant_id,
    MIN(start_date) AS earliest_campaign_start
  FROM public.campaign_calendar
  GROUP BY restaurant_id
)
SELECT
  fs.restaurant_id,
  fs.item_name,
  fs.first_seen_date
FROM first_seen fs
INNER JOIN min_campaign mc
  ON mc.restaurant_id = fs.restaurant_id
WHERE fs.first_seen_date <= mc.earliest_campaign_start - INTERVAL '7 days'
  -- Phase 16 Plan 12: relaxed to admit service_role (no JWT) reads.
  AND (
    (auth.jwt()->>'restaurant_id') IS NULL
    OR fs.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid
  );

COMMENT ON VIEW public.baseline_items_v IS
  'Phase 16 D-02 / UPL-03 (migration 0059, JWT filter relaxed in 0065 for service_role reads): items first seen >=7d before earliest campaign_start; comparable-revenue baseline for ITS counterfactual fits.';

GRANT SELECT ON public.baseline_items_v TO authenticated;

-- ---------------------------------------------------------------------------
-- Part C: kpi_daily_with_comparable_v (originally migration 0060).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.kpi_daily_with_comparable_v AS
WITH comparable AS (
  SELECT
    t.restaurant_id,
    (t.occurred_at AT TIME ZONE r.timezone)::date AS business_date,
    (SUM(COALESCE(NULLIF(oi.item_gross_amount_eur, '')::numeric, 0)) * 100)::bigint
      AS revenue_comparable_cents
  FROM public.stg_orderbird_order_items oi
  JOIN public.transactions t
    ON  t.restaurant_id = oi.restaurant_id
    AND t.source_tx_id  = oi.invoice_number
  JOIN public.restaurants r
    ON r.id = t.restaurant_id
  INNER JOIN public.baseline_items_v b
    ON  b.restaurant_id = oi.restaurant_id
    AND b.item_name     = oi.item_name
  WHERE oi.item_name IS NOT NULL
    AND oi.item_name <> ''
  GROUP BY t.restaurant_id, (t.occurred_at AT TIME ZONE r.timezone)::date
)
SELECT
  k.restaurant_id,
  k.business_date,
  (k.revenue_cents / 100.0)::numeric(14,2)        AS revenue_eur,
  k.tx_count,
  (k.avg_ticket_cents / 100.0)::numeric(10,2)     AS avg_ticket_eur,
  (COALESCE(c.revenue_comparable_cents, 0) / 100.0)::numeric(14,2)
                                                   AS revenue_comparable_eur
FROM public.kpi_daily_mv k
LEFT JOIN comparable c
  ON  c.restaurant_id = k.restaurant_id
  AND c.business_date = k.business_date
WHERE (auth.jwt()->>'restaurant_id') IS NULL
   OR k.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid;

COMMENT ON VIEW public.kpi_daily_with_comparable_v IS
  'Phase 16 D-03 (migration 0060, JWT filter relaxed in 0065 for service_role reads): extends kpi_daily_mv with revenue_comparable_eur for Track-B fits. baseline_items_v INNER JOIN already filters out post-campaign-launch items (Onsen EGG, Tantan, Hell beer).';

GRANT SELECT ON public.kpi_daily_with_comparable_v TO authenticated;

-- ---------------------------------------------------------------------------
-- Part D: campaign_uplift_v (originally migration 0064 Part B1).
-- ---------------------------------------------------------------------------

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
  AND (
    (auth.jwt()->>'restaurant_id') IS NULL
    OR u.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid
  )
ORDER BY u.restaurant_id, u.campaign_id, u.model_name, u.window_kind, u.as_of_date DESC;

GRANT SELECT ON public.campaign_uplift_v TO authenticated;

COMMENT ON VIEW public.campaign_uplift_v IS
  'Phase 16 D-08 (migration 0064, JWT filter relaxed in 0065 for service_role reads): per-window campaign uplift headline rows joined to campaign_calendar; tenant-scoped for authenticated, full-access for service_role. DISTINCT ON dedup ensures exactly 1 row per (campaign_id, model_name, window_kind).';

-- ---------------------------------------------------------------------------
-- Part E: campaign_uplift_daily_v (originally migration 0064 Part B2).
-- ---------------------------------------------------------------------------

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
  AND (
    (auth.jwt()->>'restaurant_id') IS NULL
    OR u.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid
  );

GRANT SELECT ON public.campaign_uplift_daily_v TO authenticated;

COMMENT ON VIEW public.campaign_uplift_daily_v IS
  'Phase 16 D-11 (migration 0064, JWT filter relaxed in 0065 for service_role reads): read-only per-day cumulative uplift trajectory for the dashboard sparkline. Tenant-scoped for authenticated, full-access for service_role.';
