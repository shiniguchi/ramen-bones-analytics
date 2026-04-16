-- 0022_transactions_filterable_v_is_cash.sql
-- Phase 9 Plan 01: Add is_cash to transactions_filterable_v by joining visit_attribution_mv.
-- Enables client-side cash/card filtering without a second query.
-- payment_method kept in view for backward compat; removed from filter schema only.

CREATE OR REPLACE VIEW public.transactions_filterable_v
WITH (security_invoker = true) AS
SELECT
  t.restaurant_id,
  (t.occurred_at AT TIME ZONE r.timezone)::date AS business_date,
  t.gross_cents,
  t.sales_type,
  t.payment_method,
  COALESCE(va.is_cash, true) AS is_cash
FROM public.transactions t
JOIN public.restaurants r ON r.id = t.restaurant_id
LEFT JOIN public.visit_attribution_mv va
  ON va.restaurant_id = t.restaurant_id AND va.tx_id = t.id
WHERE t.restaurant_id::text = (auth.jwt() ->> 'restaurant_id');
