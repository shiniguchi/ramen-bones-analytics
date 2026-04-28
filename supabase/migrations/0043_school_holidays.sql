-- 0043_school_holidays.sql
-- Phase 13 EXT-03: BE state-school break blocks (~5-6 per year).
-- Source: ferien-api.de (raw httpx; the abandoned `ferien-api` PyPI wrapper
-- is NOT used). Natural key is (state_code, block_name, start_date) — the
-- same block can shift dates year-to-year, so block_name+year alone is
-- not unique enough.
--
-- Hybrid-RLS pattern (CONTEXT.md C-05): SELECT for everyone, writes
-- service-role only. service_role bypasses RLS at the role level
-- (`bypassrls=true`); the REVOKE below is what gates anon/authenticated.

create table if not exists public.school_holidays (
  state_code   text         not null,
  block_name   text         not null,
  start_date   date         not null,
  end_date     date         not null,
  year         int          not null,
  fetched_at   timestamptz  not null default now(),
  primary key (state_code, block_name, start_date)
);

alter table public.school_holidays enable row level security;

create policy school_holidays_read
  on public.school_holidays for select
  using (true);

revoke insert, update, delete on public.school_holidays from authenticated, anon;
grant select on public.school_holidays to authenticated, anon;
grant select, insert, update, delete on public.school_holidays to service_role;
