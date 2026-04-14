-- 0013_refresh_function_and_cron.sql
-- Phase 3 orchestration: single SECURITY DEFINER refresh function + pg_cron schedule.
-- See .planning/phases/03-analytics-sql/03-CONTEXT.md D-20..D-23 and
-- .planning/phases/03-analytics-sql/03-RESEARCH.md Pattern 7, Pitfall 3, Pitfall 4.

-- 0. Ensure pg_cron extension is enabled. Lives in schema `cron`.
--    Supabase hosts it in the `pg_catalog` extension set; create-if-missing
--    is idempotent and safe to ship in a migration so forkers get it on push.
create extension if not exists pg_cron;

-- 1. Single orchestration function — refreshes cohort_mv then kpi_daily_mv sequentially.
--    plpgsql wraps each statement in its own savepoint; do NOT add BEGIN/COMMIT (Pitfall 3).
create or replace function public.refresh_analytics_mvs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.cohort_mv;
  refresh materialized view concurrently public.kpi_daily_mv;
end;
$$;

revoke all on function public.refresh_analytics_mvs() from public, anon, authenticated;
grant execute on function public.refresh_analytics_mvs() to service_role;

-- 2. Supersede the Phase 1 test helper so existing tenant-isolation tests keep working
--    AND transparently also refresh cohort_mv going forward (Pitfall 4).
create or replace function public.refresh_kpi_daily_mv()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_analytics_mvs();
end;
$$;

revoke all on function public.refresh_kpi_daily_mv() from public, anon, authenticated;
grant execute on function public.refresh_kpi_daily_mv() to service_role;

-- 3. Drop the temporary refresh_cohort_mv helper from migration 0010 (03-02 cleanup owed).
drop function if exists public.refresh_cohort_mv();

-- 4. pg_cron schedule: 03:00 UTC = 05:00 Europe/Berlin (D-21).
--    Idempotent via unschedule-by-name pre-step so re-applying the migration is safe.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'refresh-analytics-mvs') then
    perform cron.unschedule('refresh-analytics-mvs');
  end if;
end $$;

select cron.schedule(
  'refresh-analytics-mvs',
  '0 3 * * *',
  $job$select public.refresh_analytics_mvs();$job$
);
