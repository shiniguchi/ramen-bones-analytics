-- D-10: plain view exposing MAX(created_at) per tenant for freshness label.
-- Phase 4 UI reads this via the SvelteKit server load to compute the
-- "Updated {relative}" footer on the dashboard. security_invoker = true ensures
-- the view runs under the caller's RLS context (not the view owner's).
-- Note: transactions uses `created_at` (per 0003_transactions_skeleton.sql),
-- not `ingested_at` (which lives on staging). The plan spec said ingested_at;
-- this is the same semantic — row insertion timestamp — on the transactions
-- table. Aliased to `last_ingested_at` so UI contracts stay stable.
CREATE OR REPLACE VIEW public.data_freshness_v
WITH (security_invoker = true) AS
SELECT
  t.restaurant_id,
  MAX(t.created_at) AS last_ingested_at
FROM public.transactions t
WHERE t.restaurant_id::text = (auth.jwt() ->> 'restaurant_id')
GROUP BY t.restaurant_id;

GRANT SELECT ON public.data_freshness_v TO authenticated;
