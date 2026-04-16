-- 0020_visit_attribution_mv.sql
-- Phase 8 Plan 01: visit attribution materialized view.
-- Tags every transaction with visit_seq (nth visit per card_hash) and is_cash.
-- See .planning/phases/08-visit-attribution-data-model/08-CONTEXT.md D-01..D-06, D-09.

-- 1. Materialized view: one row per transaction
-- Cash rows (card_hash IS NULL) get visit_seq=NULL and is_cash=true.
-- Card rows get sequential visit_seq via ROW_NUMBER and is_cash=false.
create materialized view public.visit_attribution_mv as
select
  t.restaurant_id,
  t.source_tx_id                as tx_id,
  t.card_hash,
  (t.card_hash is null)         as is_cash,
  case
    when t.card_hash is not null then
      row_number() over (
        partition by t.restaurant_id, t.card_hash
        order by t.occurred_at
      )
    else null
  end::integer                  as visit_seq,
  (t.occurred_at at time zone r.timezone)::date as business_date
from public.transactions t
join public.restaurants r on r.id = t.restaurant_id;

-- 2. Unique index required for REFRESH CONCURRENTLY
create unique index visit_attribution_mv_pk
  on public.visit_attribution_mv (restaurant_id, tx_id);

-- 3. Lock raw MV — wrapper view is the only tenant-facing read path
revoke all on public.visit_attribution_mv from anon, authenticated;

-- 4. Wrapper view with JWT tenant filter (do NOT set security_invoker)
create view public.visit_attribution_v as
select
  restaurant_id, tx_id, card_hash, is_cash, visit_seq, business_date
from public.visit_attribution_mv
where restaurant_id::text = (auth.jwt()->>'restaurant_id');

-- 5. Grant read access to authenticated users
grant select on public.visit_attribution_v to authenticated;

-- 6. Test helper: lets integration tests query the wrapper view via service_role
-- without minting JWTs. Follows pattern from 0012_leaf_views.sql.
create or replace function public.test_visit_attribution(rid uuid)
returns table (
  restaurant_id uuid,
  tx_id         text,
  card_hash     text,
  is_cash       boolean,
  visit_seq     integer,
  business_date date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('restaurant_id', rid::text)::text, true);
  return query select * from public.visit_attribution_v;
end;
$$;
revoke all on function public.test_visit_attribution(uuid) from public, anon, authenticated;
grant execute on function public.test_visit_attribution(uuid) to service_role;

-- 7. Update refresh function to include the new MV as third refresh step.
-- Existing REVOKE/GRANT persist through CREATE OR REPLACE.
create or replace function public.refresh_analytics_mvs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.cohort_mv;
  refresh materialized view concurrently public.kpi_daily_mv;
  refresh materialized view concurrently public.visit_attribution_mv;
end;
$$;
