-- 0018_transactions_filterable_v.sql
-- Phase 6 (FLT-03, FLT-04, FLT-07): filterable wrapper view over transactions.
--
-- Exposes the columns the SvelteKit loader needs to honor sales_type +
-- payment_method filters on chip-scoped KPI tiles, without reading raw
-- `transactions` from the frontend (Guard 1). JWT-claim tenant filter
-- matches the existing 0011 / 0014 wrapper pattern.
--
-- SELECT DISTINCT-style dropdown queries (via select-then-JS-dedupe) run
-- against this view UNFILTERED to decouple option arrays from current
-- filter state (D-14).
--
-- Column names on public.transactions (per 0008_transactions_columns.sql):
--   sales_type     text  -- INHOUSE | TAKEAWAY
--   payment_method text  -- Bar, MasterCard, Visa, ...
--   gross_cents    integer
--   occurred_at    timestamptz
--   restaurant_id  uuid
-- business_date derived via restaurant timezone (same pattern as
-- 0011_kpi_daily_mv_real.sql).

create view public.transactions_filterable_v
with (security_invoker = true) as
select
  t.restaurant_id,
  (t.occurred_at at time zone r.timezone)::date as business_date,
  t.gross_cents,
  t.sales_type,
  t.payment_method
from public.transactions t
join public.restaurants r on r.id = t.restaurant_id
where t.restaurant_id::text = (auth.jwt() ->> 'restaurant_id');

grant select on public.transactions_filterable_v to authenticated;
