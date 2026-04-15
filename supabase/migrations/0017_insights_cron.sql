-- 0017_insights_cron.sql
-- Phase 5 Plan 01: pg_net + Vault-sourced pg_cron schedule for generate-insights Edge Function.
--
-- Per 05-CONTEXT D-14 + 05-RESEARCH Pitfall 1 — Phase 3 MV refresh cron
-- (0013_refresh_function_and_cron.sql) runs at 0 3 * * * UTC. This job fires
-- 15 min later (approx 03:15 Europe/Berlin in winter).
-- Decoupled from refresh: either job can fail without blocking the other.
--
-- Vault secrets (set out-of-band via `supabase secrets` / Dashboard — documented in 05-05 README):
--   vault.secrets.generate_insight_url      Edge Function URL
--   vault.secrets.generate_insight_bearer   service_role JWT
--
-- Migration tolerates missing secrets at apply time: pg_net will error at cron
-- run time (logged in cron.job_run_details), not during `supabase db push`.

-- 1. Ensure pg_net is available. Supabase installs into the `extensions` schema.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2. Idempotency: drop any prior generate-insights schedule so this migration
--    is safe to re-apply. Wrapped in DO block with EXCEPTION so a missing
--    cron.job row (first run) does not abort the migration.
DO $$
BEGIN
  PERFORM cron.unschedule('generate-insights')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-insights');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

-- 3. Register the insight job. URL + bearer pulled from Vault at run time so
--    no credentials are committed to the repo. pg_net posts an empty JSON body;
--    the Edge Function (05-03) reads tenant state from the DB itself.
SELECT cron.schedule(
  'generate-insights',
  '15 3 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'generate_insight_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'generate_insight_bearer')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
