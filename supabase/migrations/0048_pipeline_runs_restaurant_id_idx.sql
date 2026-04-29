-- 0048_pipeline_runs_restaurant_id_idx.sql
-- Phase 13 follow-up (REVIEW C-9): add the missing index that backs the
-- pipeline_runs RLS policy from 0046 + the natural dashboard query
-- pattern (most-recent rows for a restaurant).
--
-- Without this index every authenticated dashboard load that reads
-- pipeline_runs does a sequential scan filtered by:
--   `restaurant_id is null OR restaurant_id::text = (auth.jwt()->>'restaurant_id')`
-- pipeline_runs grows unbounded (~6 fetcher rows/day + Phase 12 audit
-- rows + the 0045 annual reminder). At v1 scale the seq scan is cheap;
-- the index is also cheap; ship it now to avoid a "why is the dashboard
-- slow" follow-up at the 100-restaurant scale point.
--
-- Composite index: leading column matches the RLS predicate; trailing
-- started_at desc matches the dashboard's ORDER BY started_at desc.

create index if not exists pipeline_runs_restaurant_id_idx
  on public.pipeline_runs (restaurant_id, started_at desc);
