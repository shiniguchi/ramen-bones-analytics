-- 0011_kpi_daily_mv_real.sql
-- Replaces the placeholder body from 0004_kpi_daily_mv_template.sql with the
-- real daily aggregation per 03-CONTEXT D-15 and 03-RESEARCH §Pattern 2.
--
-- INCLUDES cash + April 2026 transactions — only identity metrics
-- (cohort/retention/LTV/frequency/new_vs_returning) exclude those (D-06).
--
-- `create materialized view` is not idempotent, so we drop-cascade the
-- 0004 MV (which also drops its dependent wrapper `kpi_daily_v`) and
-- recreate both. The 0006 `public.refresh_kpi_daily_mv()` helper has no
-- schema dependency on the MV body (it's a plpgsql EXECUTE string), so
-- cascade does NOT drop the function — verified in Pitfall 4.

drop materialized view public.kpi_daily_mv cascade;  -- cascades to kpi_daily_v; recreated below

-- Real aggregation body: sum gross_cents per (restaurant, business_date).
-- business_date derived via restaurant timezone per Phase 1 D-09.
create materialized view public.kpi_daily_mv as
select
  t.restaurant_id,
  (t.occurred_at at time zone r.timezone)::date         as business_date,
  sum(t.gross_cents)::numeric                           as revenue_cents,
  count(*)::int                                         as tx_count,
  case when count(*) = 0 then null
       else (sum(t.gross_cents)::numeric / count(*)) end as avg_ticket_cents
from public.transactions t
join public.restaurants r on r.id = t.restaurant_id
group by t.restaurant_id, (t.occurred_at at time zone r.timezone)::date;

-- MANDATORY unique index for REFRESH MATERIALIZED VIEW CONCURRENTLY.
create unique index kpi_daily_mv_pk
  on public.kpi_daily_mv (restaurant_id, business_date);

-- Lock raw MV — tenant roles read only through the wrapper view.
revoke all on public.kpi_daily_mv from anon, authenticated;

-- Recreate wrapper view (cascade dropped the 0004 original). Same JWT-claim
-- tenancy filter pattern as 0004. Do NOT override default invoker mode
-- (see 01-RESEARCH Pitfall A — silent-leak failure mode).
create view public.kpi_daily_v as
select
  restaurant_id,
  business_date,
  revenue_cents,
  tx_count,
  avg_ticket_cents
from public.kpi_daily_mv
where restaurant_id::text = (auth.jwt()->>'restaurant_id');

grant select on public.kpi_daily_v to authenticated;
