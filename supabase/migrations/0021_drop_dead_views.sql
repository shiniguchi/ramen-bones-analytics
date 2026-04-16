-- 0021_drop_dead_views.sql
-- Phase 8 VA-03: drop v1.0/v1.1 analytics views replaced by visit-attribution approach.
-- Drops frequency_v, new_vs_returning_v, ltv_v + their SECURITY DEFINER test helpers.
-- Rewrites transactions_filterable_v without the country column (no longer needed).

-- 1. Drop test helper functions FIRST (they reference the views)
DROP FUNCTION IF EXISTS public.test_frequency(uuid);
DROP FUNCTION IF EXISTS public.test_new_vs_returning(uuid);
DROP FUNCTION IF EXISTS public.test_ltv(uuid);

-- 2. Drop the three dead views
DROP VIEW IF EXISTS public.frequency_v;
DROP VIEW IF EXISTS public.new_vs_returning_v;
DROP VIEW IF EXISTS public.ltv_v;

-- 3. Rewrite transactions_filterable_v without country column
-- CREATE OR REPLACE with trailing column removed is safe (no dependents reference it by position).
CREATE OR REPLACE VIEW public.transactions_filterable_v
WITH (security_invoker = true) AS
SELECT
  t.restaurant_id,
  (t.occurred_at AT TIME ZONE r.timezone)::date AS business_date,
  t.gross_cents,
  t.sales_type,
  t.payment_method
FROM public.transactions t
JOIN public.restaurants r ON r.id = t.restaurant_id
WHERE t.restaurant_id::text = (auth.jwt() ->> 'restaurant_id');
