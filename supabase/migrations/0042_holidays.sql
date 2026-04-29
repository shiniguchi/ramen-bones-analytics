-- 0042_holidays.sql
-- Phase 13 EXT-02: federal + Berlin (BE) state holidays incl. Frauentag.
-- Source: python-holidays (bundled, no API key). Re-runs are idempotent
-- via ON CONFLICT (date) DO UPDATE — each date collapses to one logical row.
-- subdiv_code = NULL  -> federal holiday observed nationally
--              = 'BE' -> Berlin-only (e.g. Internationaler Frauentag, Mar 8)
-- (REVIEW C-11: prior comment said "BE wins on overlap" — the correct rule
-- is FEDERAL wins on overlap so downstream string filters on the federal
-- name stay consistent regardless of BE locale variation. See
-- scripts/external/holidays.py for the rationale.)
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
