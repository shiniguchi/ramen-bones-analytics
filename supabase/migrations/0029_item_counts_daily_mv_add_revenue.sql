-- 0029_item_counts_daily_mv_add_revenue.sql
-- Feedback #4: per-item revenue chart needs revenue summed per (day, item).
-- Columns can't be added to a materialized view in place — drop + recreate.
-- refresh_analytics_mvs() already references the MV; no function change needed.

drop view if exists public.item_counts_daily_v;
drop materialized view if exists public.item_counts_daily_mv;

create materialized view public.item_counts_daily_mv as
with filtered as (
  select
    t.restaurant_id,
    (t.occurred_at at time zone r.timezone)::date as business_date,
    oi.item_name,
    t.sales_type,
    coalesce(va.is_cash, true) as is_cash,
    -- item_gross_amount_eur is text in staging; empty string → 0
    coalesce(nullif(oi.item_gross_amount_eur, '')::numeric, 0) as gross_eur
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
  count(*)::integer               as item_count,
  (sum(gross_eur) * 100)::bigint  as item_revenue_cents
from filtered
group by restaurant_id, business_date, item_name, sales_type, is_cash;

-- MANDATORY unique index for REFRESH CONCURRENTLY
create unique index item_counts_daily_mv_pk
  on public.item_counts_daily_mv (restaurant_id, business_date, item_name, sales_type, is_cash);

-- Lock raw MV
revoke all on public.item_counts_daily_mv from anon, authenticated;

-- Wrapper view (JWT tenant filter)
create view public.item_counts_daily_v as
select
  restaurant_id,
  business_date,
  item_name,
  sales_type,
  is_cash,
  item_count,
  item_revenue_cents
from public.item_counts_daily_mv
where restaurant_id::text = (auth.jwt()->>'restaurant_id');

grant select on public.item_counts_daily_v to authenticated;

-- Postgres won't let CREATE OR REPLACE change an existing function's return
-- type — must drop the old signature first before recreating with the extra
-- item_revenue_cents bigint column.
drop function if exists public.test_item_counts_daily(uuid);

create function public.test_item_counts_daily(rid uuid)
returns table (
  restaurant_id      uuid,
  business_date      date,
  item_name          text,
  sales_type         text,
  is_cash            boolean,
  item_count         integer,
  item_revenue_cents bigint
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
