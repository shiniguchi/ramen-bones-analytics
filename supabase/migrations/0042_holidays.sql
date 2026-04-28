-- 0042_holidays.sql
-- Phase 13 EXT-02: federal + Berlin (BE) state holidays incl. Frauentag.
-- Source: python-holidays (bundled, no API key). Re-runs are idempotent
-- via ON CONFLICT (date) DO UPDATE — federal + BE rows MUST collapse to
-- one logical row per date; if a date is both federal and BE-only, BE
-- wins (subdiv_code='BE') and `name` carries both.
--
-- Hybrid-RLS pattern (CONTEXT.md C-05): SELECT for everyone, writes
-- service-role only. service_role bypasses RLS at the role level
-- (`bypassrls=true`); the REVOKE below is what gates anon/authenticated.

create table if not exists public.holidays (
  date          date        not null primary key,
  name          text        not null,
  country_code  text        not null default 'DE',
  subdiv_code   text,
  fetched_at    timestamptz not null default now()
);

alter table public.holidays enable row level security;

create policy holidays_read
  on public.holidays for select
  using (true);

revoke insert, update, delete on public.holidays from authenticated, anon;
grant select on public.holidays to authenticated, anon;
grant select, insert, update, delete on public.holidays to service_role;
