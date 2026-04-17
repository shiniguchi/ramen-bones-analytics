-- 0023_transactions_filterable_v_visit_seq.sql
-- Phase 10 Plan 02: extend transactions_filterable_v with visit_seq + card_hash.
-- Calendar charts (VA-04, VA-05) use these columns from the already-fetched
-- client stream — no new SSR query required.
--
-- Pattern: extending the existing join with visit_attribution_mv (added in 0022
-- for is_cash). Adding 2 more columns to the same join is cheap.
--
-- NOTE: Per Phase 9 09-03 gap-closure (STATE.md 2026-04-17), view column-shape
-- changes must use DROP VIEW + CREATE VIEW — Postgres forbids column removal
-- via CREATE OR REPLACE VIEW (SQLSTATE 42P16). We're ADDING columns here,
-- but DROP+CREATE is the canonical safe pattern going forward.

drop view if exists public.transactions_filterable_v;

create view public.transactions_filterable_v
with (security_invoker = true) as
select
  t.restaurant_id,
  (t.occurred_at at time zone r.timezone)::date as business_date,
  t.gross_cents,
  t.sales_type,
  t.payment_method,
  coalesce(va.is_cash, true) as is_cash,
  va.visit_seq,                              -- new: NULL for cash / unattributed
  t.card_hash                                -- new: NULL for cash
from public.transactions t
join public.restaurants r on r.id = t.restaurant_id
left join public.visit_attribution_mv va
  on va.restaurant_id = t.restaurant_id and va.tx_id = t.source_tx_id
where t.restaurant_id::text = (auth.jwt() ->> 'restaurant_id');

-- No explicit grant needed: authenticated inherited SELECT from the prior view definition.
-- security_invoker=true means RLS on the underlying transactions table still applies.
