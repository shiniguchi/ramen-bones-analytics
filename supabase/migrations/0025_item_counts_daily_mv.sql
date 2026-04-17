-- 0025_item_counts_daily_mv.sql
-- Phase 10 Plan 03: per-day × item_name × sales_type × is_cash item counts.
-- Feeds VA-08 only. Client picks top-8 + "Other" rollup (D-14).
--
-- Join key: stg_orderbird_order_items.invoice_number = transactions.source_tx_id
-- (confirmed in scripts/ingest/normalize.ts:185 — source_tx_id = invoice).
-- Additional join to visit_attribution_mv for is_cash (Phase 8 canonical source, D-02).
-- Metric = COUNT, not gross (D-16). Revenue-by-item deferred.

create materialized view public.item_counts_daily_mv as
with filtered as (
  select
    t.restaurant_id,
    (t.occurred_at at time zone r.timezone)::date as business_date,
    oi.item_name,
    t.sales_type,
    coalesce(va.is_cash, true) as is_cash
  from public.stg_orderbird_order_items oi
  join public.transactions t
    on  t.restaurant_id  = oi.restaurant_id
    and t.source_tx_id   = oi.invoice_number
  join public.restaurants r
    on r.id = t.restaurant_id
  left join public.visit_attribution_mv va
    on  va.restaurant_id = t.restaurant_id
    and va.tx_id         = t.source_tx_id
  where oi.item_name is not null
    and oi.item_name <> ''
)
select
  restaurant_id,
  business_date,
  item_name,
  sales_type,
  is_cash,
  count(*)::integer as item_count
from filtered
group by restaurant_id, business_date, item_name, sales_type, is_cash;

-- MANDATORY unique index for REFRESH CONCURRENTLY — full grain tuple is the natural key
create unique index item_counts_daily_mv_pk
  on public.item_counts_daily_mv (restaurant_id, business_date, item_name, sales_type, is_cash);

-- Lock raw MV
revoke all on public.item_counts_daily_mv from anon, authenticated;

-- Wrapper view (JWT tenant filter; do NOT set security_invoker)
create view public.item_counts_daily_v as
select
  restaurant_id,
  business_date,
  item_name,
  sales_type,
  is_cash,
  item_count
from public.item_counts_daily_mv
where restaurant_id::text = (auth.jwt()->>'restaurant_id');

grant select on public.item_counts_daily_v to authenticated;

-- Test helper
create or replace function public.test_item_counts_daily(rid uuid)
returns table (
  restaurant_id uuid,
  business_date date,
  item_name     text,
  sales_type    text,
  is_cash       boolean,
  item_count    integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('restaurant_id', rid::text)::text, true);
  return query select * from public.item_counts_daily_v;
end;
$$;
revoke all on function public.test_item_counts_daily(uuid) from public, anon, authenticated;
grant execute on function public.test_item_counts_daily(uuid) to service_role;

-- Extend refresh_analytics_mvs() — item_counts_daily_mv depends on visit_attribution_mv
-- and is the LAST step (D-04 DAG: cohort → kpi → visit_attr → customer_ltv → item_counts).
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
  refresh materialized view concurrently public.customer_ltv_mv;
  refresh materialized view concurrently public.item_counts_daily_mv;
end;
$$;
