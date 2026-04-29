-- 0047_shop_calendar.sql
-- Phase 13 EXT-07: per-restaurant open/closed calendar 365 days forward.
-- Tenant-scoped table — uses canonical auth.jwt()->>'restaurant_id'
-- pattern from 0010_cohort_mv.sql lines 73-76. Closed days are flagged
-- is_open=false; downstream forecast (Phase 14) maps those to NaN to
-- avoid demand-underestimate bias (PROPOSAL §14).
--
-- service_role bypasses RLS at the role level (`bypassrls=true`); the
-- REVOKE below is what gates anon/authenticated writes.

create table if not exists public.shop_calendar (
  restaurant_id  uuid         not null references public.restaurants(id) on delete cascade,
  date           date         not null,
  is_open        boolean      not null,
  open_at        time,
  close_at       time,
  reason         text,
  fetched_at     timestamptz  not null default now(),
  primary key (restaurant_id, date)
);

alter table public.shop_calendar enable row level security;

create policy shop_calendar_read
  on public.shop_calendar for select
  using (restaurant_id::text = (auth.jwt() ->> 'restaurant_id'));

revoke insert, update, delete on public.shop_calendar from authenticated, anon;
grant select on public.shop_calendar to authenticated, anon;
grant select, insert, update, delete on public.shop_calendar to service_role;
