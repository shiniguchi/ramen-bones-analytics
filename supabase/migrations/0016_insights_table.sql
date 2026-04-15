-- 0016_insights_table.sql
-- Phase 5 Plan 01: insights base table + RLS-safe wrapper view + grants.
-- See .planning/phases/05-insights-forkability/05-CONTEXT.md §D-10, §D-16.
--
-- Surface contract:
--   - public.insights           raw table, service_role-only (REVOKE ALL from anon/authenticated)
--   - public.insights_v         JWT-filtered wrapper view (the only tenant-facing read path)
--   - RLS policy on the raw table is defense-in-depth; wrapper view is primary tenancy gate.
--
-- Phase 1 D-06/07/08 pattern: raw object is locked, wrapper enforces tenant via
-- auth.jwt()->>'restaurant_id'. This plan is SQL-only — Edge Function writes
-- happen in 05-03 via service_role, SvelteKit reads happen in 05-04 via insights_v.

-- 1. Base table. Idempotent (CREATE TABLE IF NOT EXISTS) so re-applying the migration is safe.
CREATE TABLE IF NOT EXISTS public.insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
  business_date date NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  headline text NOT NULL,
  body text NOT NULL,
  input_payload jsonb NOT NULL,
  model text NOT NULL,
  fallback_used boolean NOT NULL DEFAULT false,
  CONSTRAINT insights_restaurant_date_key UNIQUE (restaurant_id, business_date)
);

-- 2. Lock the raw table per D-16. Only service_role (Edge Function) may write.
--    authenticated/anon get nothing here — they must go through insights_v.
REVOKE ALL ON public.insights FROM authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON public.insights TO service_role;

-- 3. Defense-in-depth RLS policy on the base table. The wrapper view is the
--    primary gate, but if a future migration grants SELECT on public.insights
--    by accident, RLS still blocks cross-tenant reads.
ALTER TABLE public.insights ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'insights'
      AND policyname = 'insights_tenant_read'
  ) THEN
    CREATE POLICY insights_tenant_read ON public.insights
      FOR SELECT TO authenticated
      USING (restaurant_id::text = (auth.jwt()->>'restaurant_id'));
  END IF;
END$$;

-- 4. Wrapper view — JWT-filtered, security_invoker (matches 0014 shape).
--    input_payload is deliberately OMITTED from the wrapper: clients never need
--    the raw Claude input; it stays in the base table for audit only.
CREATE OR REPLACE VIEW public.insights_v
  WITH (security_invoker = true) AS
SELECT
  id,
  restaurant_id,
  business_date,
  generated_at,
  headline,
  body,
  model,
  fallback_used
FROM public.insights
WHERE restaurant_id::text = (auth.jwt()->>'restaurant_id');

-- 5. Grant read on the wrapper. This is the only public read path for insights.
GRANT SELECT ON public.insights_v TO authenticated;
