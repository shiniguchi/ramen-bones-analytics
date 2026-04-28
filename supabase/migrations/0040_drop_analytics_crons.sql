-- 0040_drop_analytics_crons.sql
-- Quick task 260428-wmd: switch from time-based cron to ingest-driven refresh.
-- (0039 is reserved by Phase 12 for pipeline_runs_skeleton; this slot is 0040.)
--
-- Drops the two daily pg_cron schedules:
--   1. refresh-analytics-mvs (migration 0013, 03:00 UTC)
--   2. generate-insights    (migration 0017, 03:15 UTC)
--
-- Reason: data only arrives via CSV upload (one or two times per week, at most
-- daily). Firing both jobs every night burns LLM budget and creates duplicate
-- insights for unchanged data. The ingest script now refreshes MVs and
-- conditionally calls the Edge Function only when a new complete Mon-Sun week
-- is available compared to the most recent insight's business_date.
--
-- The underlying assets stay intact and on-demand callable:
--   - public.refresh_analytics_mvs()   — invoked from ingest via PostgREST RPC
--   - generate-insight Edge Function   — invoked from ingest via direct HTTP

-- 1. Unschedule the MV refresh job. Idempotent: DO block tolerates missing row
--    so re-applying this migration on a fresh fork (where the job was never
--    scheduled) does not error.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-analytics-mvs') THEN
    PERFORM cron.unschedule('refresh-analytics-mvs');
  END IF;
END$$;

-- 2. Unschedule the insight generation job. Same idempotency pattern as above.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-insights') THEN
    PERFORM cron.unschedule('generate-insights');
  END IF;
END$$;
