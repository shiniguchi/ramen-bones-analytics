-- 0044_transit_alerts.sql
-- Phase 13 EXT-04: BVG RSS strike alerts. Phase 13 keyword scope is
-- {Streik, Warnstreik} (D-12); v1.4 PR extends the module constant.
-- alert_id is sha256(title || '|' || pub_date_iso) computed in Python — keeps
-- the table idempotent across feed re-fetches.
--
-- Hybrid-RLS pattern (CONTEXT.md C-05): SELECT for everyone, writes
-- service-role only. service_role bypasses RLS at the role level
-- (`bypassrls=true`); the REVOKE below is what gates anon/authenticated.

create table if not exists public.transit_alerts (
  alert_id          text         not null primary key,
  title             text         not null,
  pub_date          timestamptz  not null,
  matched_keyword   text         not null,
  description       text,
  source_url        text         not null,
  fetched_at        timestamptz  not null default now()
);

alter table public.transit_alerts enable row level security;

create policy transit_alerts_read
  on public.transit_alerts for select
  using (true);

revoke insert, update, delete on public.transit_alerts from authenticated, anon;
grant select on public.transit_alerts to authenticated, anon;
grant select, insert, update, delete on public.transit_alerts to service_role;
