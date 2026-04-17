-- 0026_transactions_filterable_v_drop_security_invoker.sql
-- HOTFIX: transactions_filterable_v was returning 0 rows for authenticated users.
--
-- Root cause: migration 0022 (Phase 9-03) added a LEFT JOIN on visit_attribution_mv
-- while keeping `security_invoker=true` on the view. Because visit_attribution_mv
-- has REVOKE ALL FROM authenticated (0020 line 32 — MVs use the wrapper-view
-- pattern), every authenticated SELECT against transactions_filterable_v failed
-- with "permission denied for materialized view visit_attribution_mv". SvelteKit's
-- per-query .catch() swallowed the error and returned [] — dashboard showed 0 €
-- for every date range since 0022 landed.
--
-- Fix: drop security_invoker so the view runs as its creator (superuser) and
-- can read visit_attribution_mv. Tenant isolation is preserved by the explicit
-- `where t.restaurant_id::text = (auth.jwt()->>'restaurant_id')` clause —
-- identical to the RLS policy on the underlying transactions table.
--
-- This matches the canonical pattern used by customer_ltv_v (0024) and
-- item_counts_daily_v (0025), both of which omit security_invoker and rely
-- on the explicit WHERE clause for tenant scoping.

drop view if exists public.transactions_filterable_v;

create view public.transactions_filterable_v as
select
  t.restaurant_id,
  (t.occurred_at at time zone r.timezone)::date as business_date,
  t.gross_cents,
  t.sales_type,
  t.payment_method,
  coalesce(va.is_cash, true) as is_cash,
  va.visit_seq,
  t.card_hash
from public.transactions t
join public.restaurants r on r.id = t.restaurant_id
left join public.visit_attribution_mv va
  on va.restaurant_id = t.restaurant_id and va.tx_id = t.source_tx_id
where t.restaurant_id::text = (auth.jwt() ->> 'restaurant_id');

grant select on public.transactions_filterable_v to authenticated;
