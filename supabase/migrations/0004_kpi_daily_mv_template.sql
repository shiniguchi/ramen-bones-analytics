-- supabase/migrations/0004_kpi_daily_mv_template.sql
--
-- Canonical wrapper-view template for tenant-scoped materialized views.
-- Every Phase 3 MV copies this exact shape: MV + unique index + REVOKE + wrapper view.
-- See 01-CONTEXT.md D-06, D-07, D-08, D-08a and 01-RESEARCH.md Pattern 3 / Pitfall A.

-- 1. Materialized view (placeholder content per D-08a). Owner: postgres.
--    Phase 3 replaces the body with the real daily aggregation.
create materialized view public.kpi_daily_mv as
select
  r.id         as restaurant_id,
  current_date as business_date,
  0::numeric   as revenue_cents
from public.restaurants r;

-- 2. MANDATORY unique index (D-08). Required for REFRESH MATERIALIZED VIEW CONCURRENTLY
--    in Phase 3. CI guard 3b (Plan 05) enforces this in the same migration file.
create unique index kpi_daily_mv_pk
  on public.kpi_daily_mv (restaurant_id, business_date);

-- 3. Lock the raw MV (D-07). anon/authenticated can never read it directly.
--    The wrapper view is the only tenant-facing read path.
revoke all on public.kpi_daily_mv from anon, authenticated;

-- 4. Wrapper view — the ONLY tenant-facing read path (D-06).
--    DO NOT override the default invoker mode here. The default is load-bearing:
--    the view executes with owner (postgres) privileges, which still has SELECT on
--    the REVOKE'd MV. authenticated has SELECT on the view; the WHERE clause enforces
--    tenancy via the JWT claim injected by the custom access token hook.
--    See 01-RESEARCH.md Pitfall A for the silent-leak failure mode if this is changed.
create view public.kpi_daily_v as
select
  restaurant_id,
  business_date,
  revenue_cents
from public.kpi_daily_mv
where restaurant_id::text = (auth.jwt()->>'restaurant_id');

grant select on public.kpi_daily_v to authenticated;
