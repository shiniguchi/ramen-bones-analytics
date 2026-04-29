-- 0049_pipeline_runs_lockdown.sql
-- Phase 13 follow-up (REVIEW MS-2): close the pipeline_runs information-leak
-- vector introduced by 0046's permissive `restaurant_id IS NULL OR ...` SELECT
-- policy.
--
-- WHAT WAS WRONG:
--   0046 enabled RLS on pipeline_runs and granted SELECT to anon + authenticated
--   with policy `restaurant_id is null OR restaurant_id::text = (auth.jwt() ->>
--   'restaurant_id')`. All Phase 13 fetcher rows lack `restaurant_id`, and the
--   Phase 12 audit cron also writes global rows. So `error_msg` (which contains
--   raw upstream response bodies, stack traces, internal hostnames) became
--   readable by ANY anon visitor with the project's anon key (which ships in
--   the SvelteKit client bundle on a public deploy).
--
-- WHAT THIS DOES:
--   1. Tighten the raw-table RLS to STRICT tenant-scoping (drops the global-
--      row OR clause). Service-role bypasses RLS as before, so writers
--      (run_all.py, audit cron) still insert freely.
--   2. REVOKE direct SELECT on pipeline_runs from anon + authenticated —
--      restoring the 0039 skeleton's original "service-role only direct
--      access" stance (Phase 12 D-08).
--   3. Create `pipeline_runs_status_v` SECURITY DEFINER wrapper view that
--      exposes a SAFE column subset (no error_msg, no commit_sha) and applies
--      its own row filter (`restaurant_id IS NULL OR matches JWT`). This
--      preserves REQUIREMENTS EXT-06 + BCK-08 + FUI-08: dashboards can still
--      read freshness/status for the stale-data badge, just without the
--      sensitive payload columns.
--
-- TRADE-OFF: maintainers debugging a Sunday-morning failure must read
-- error_msg via service-role console access (psql/Supabase Studio), not
-- through the dashboard. That is the correct privilege boundary.

-- 1. Replace the permissive policy with strict tenant-scoping.
drop policy if exists pipeline_runs_read on public.pipeline_runs;
create policy pipeline_runs_read
  on public.pipeline_runs for select
  using (restaurant_id::text = (auth.jwt() ->> 'restaurant_id'));

-- 2. Revoke the broad SELECT grant from 0046. Clients now go through the
--    wrapper view below.
revoke select on public.pipeline_runs from authenticated, anon;

-- 3. Wrapper view. SECURITY INVOKER off (Postgres default for views) means
--    the view runs with the OWNER's privileges, bypassing pipeline_runs RLS.
--    The view applies its own filter using `auth.jwt()` (which still reads
--    the CALLER's JWT — the function is request-context, not view-owner-
--    context). Net effect: dashboards see global rows + their own tenant
--    rows; never see error_msg / commit_sha.
create or replace view public.pipeline_runs_status_v as
select
  step_name,
  status,
  started_at,
  finished_at,
  row_count,
  upstream_freshness_h,
  restaurant_id
from public.pipeline_runs
where restaurant_id is null
   or restaurant_id::text = (auth.jwt() ->> 'restaurant_id');

-- The view inherits anon/authenticated SELECT from the table-level grant
-- chain by default; make the grant explicit so a fork that re-grants
-- privileges later doesn't lose access.
grant select on public.pipeline_runs_status_v to authenticated, anon;

comment on view public.pipeline_runs_status_v is
  'Safe-columns wrapper for pipeline_runs (REVIEW MS-2). Hides error_msg + '
  'commit_sha; surfaces freshness fields for the dashboard stale-data badge. '
  'Phase 15 dashboards MUST read this view, NOT the raw table.';
