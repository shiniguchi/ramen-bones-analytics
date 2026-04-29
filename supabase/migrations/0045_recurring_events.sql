-- 0045_recurring_events.sql
-- Phase 13 EXT-05: hand-curated city events from config/recurring_events.yaml.
-- ~15 events per year for Berlin. event_id is the slug from the YAML —
-- stable across years (e.g. 'berlin-marathon-2026', 'csd-berlin-2026').
--
-- The pg_cron annual reminder writes one row to public.pipeline_runs on
-- Sep 15 each year. The reminder is intentionally a pipeline_runs row,
-- not an email — surfacing in maintainer-review of the table is enough
-- for v1 (CONTEXT specifics).
--
-- Hybrid-RLS pattern (CONTEXT.md C-05): SELECT for everyone, writes
-- service-role only. service_role bypasses RLS at the role level
-- (`bypassrls=true`); the REVOKE below is what gates anon/authenticated.

create table if not exists public.recurring_events (
  event_id          text         not null primary key,
  name              text         not null,
  category          text         not null check (category in ('festival','sports','market','holiday','other')),
  start_date        date         not null,
  end_date          date         not null,
  impact_estimate   text         not null check (impact_estimate in ('high','medium','low')),
  notes             text,
  source            text,
  fetched_at        timestamptz  not null default now()
);

alter table public.recurring_events enable row level security;

create policy recurring_events_read
  on public.recurring_events for select
  using (true);

revoke insert, update, delete on public.recurring_events from authenticated, anon;
grant select on public.recurring_events to authenticated, anon;
grant select, insert, update, delete on public.recurring_events to service_role;

-- pg_cron annual reminder: every Sep 15 at 09:00 UTC, write a warning
-- row to pipeline_runs nudging the maintainer to add next-year events.
-- Schedule: minute=0 hour=9 dom=15 month=9 dow=*
--
-- Idempotency (REVIEW C-7): cron.schedule() raises duplicate-jobname on a
-- fresh replay (e.g. `supabase db reset`, or a forker's first deploy after
-- the job was already created). The earlier "upserts on jobname" comment
-- was wrong. Pattern below mirrors 0013/0040's unschedule-if-exists guard
-- so this migration is replay-safe.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'recurring-events-yearly-reminder') then
    perform cron.unschedule('recurring-events-yearly-reminder');
  end if;
end$$;

select cron.schedule(
  'recurring-events-yearly-reminder',
  '0 9 15 9 *',
  $$ insert into public.pipeline_runs (step_name, started_at, finished_at, status, row_count, error_msg)
     values (
       'recurring_events_reminder',
       now(),
       now(),
       'warning',
       0,
       'Add recurring_events for ' || (extract(year from now()) + 1)::text || ' to config/recurring_events.yaml and run external-data-refresh.yml backfill'
     ); $$
);

-- test_cron_job_schedule: service-role-only RPC for vitest tests to query
-- the cron.job table (which lives outside the public schema and is not
-- exposed via PostgREST by default). SECURITY DEFINER lets it read cron.*.
create or replace function public.test_cron_job_schedule(p_jobname text)
returns table(jobname text, schedule text)
language sql
security definer
set search_path = public
as $$
  select j.jobname::text, j.schedule::text
  from cron.job j
  where j.jobname = p_jobname;
$$;

revoke all on function public.test_cron_job_schedule(text) from public, anon, authenticated;
grant execute on function public.test_cron_job_schedule(text) to service_role;
