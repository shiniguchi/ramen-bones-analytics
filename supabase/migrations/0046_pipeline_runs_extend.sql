-- 0046_pipeline_runs_extend.sql
-- Phase 13 D-01 + C-03: extend the 0039 skeleton with the columns the
-- external-data cascade needs. Adds:
--   - upstream_freshness_h numeric NULL  (D-14: hours since the latest
--     data point in the upstream response — feeds the stale-data badge
--     in Phase 15)
--   - restaurant_id uuid NULL  (allows audit-script global rows from
--     Phase 12 to coexist with per-tenant fetcher rows in the same table)
-- Also installs the per-tenant RLS policy that lets dashboards read
-- "their" rows + global rows (restaurant_id IS NULL).
--
-- service_role bypasses RLS at the role level (`bypassrls=true`); the
-- REVOKE below is what gates anon/authenticated writes. The 0039 skeleton
-- already revoked writes; re-state explicitly to guard against drift.

alter table public.pipeline_runs
  add column if not exists upstream_freshness_h numeric,
  add column if not exists restaurant_id        uuid references public.restaurants(id) on delete cascade;

alter table public.pipeline_runs enable row level security;

-- Idempotent recreate: drop any prior policy (skeleton had none), then create.
drop policy if exists pipeline_runs_read on public.pipeline_runs;
create policy pipeline_runs_read
  on public.pipeline_runs for select
  using (
    restaurant_id is null
    OR restaurant_id::text = (auth.jwt() ->> 'restaurant_id')
  );

-- Writes remain service-role only (skeleton already revoked from anon/authenticated;
-- re-state explicitly in case future drift).
revoke insert, update, delete on public.pipeline_runs from authenticated, anon;
grant select on public.pipeline_runs to authenticated, anon;

-- test_table_policies: service-role-only RPC for vitest tests; returns the
-- policy list for an arbitrary public-schema table. Mirrors the
-- test_cron_job_schedule pattern from 0045. Required because PostgREST
-- does not expose pg_catalog.pg_policies to test clients.
create or replace function public.test_table_policies(p_table_name text)
returns table(policyname text, cmd text, qual text)
language sql
security definer
set search_path = public
as $$
  select p.policyname::text, p.cmd::text, coalesce(p.qual, '')::text
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = p_table_name;
$$;

revoke all on function public.test_table_policies(text) from public, anon, authenticated;
grant execute on function public.test_table_policies(text) to service_role;
