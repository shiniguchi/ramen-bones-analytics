-- 0053_weather_climatology.sql
-- Phase 14: 366-row lookup table for Berlin weather climatology.
-- One row per (month, day). Used as exogenous feature in forecast models.
-- Public read, service_role write only.

create table public.weather_climatology (
  month          smallint not null,
  day            smallint not null,
  temp_mean_c    numeric,
  precip_mm      numeric,
  wind_max_kmh   numeric,
  sunshine_hours numeric,
  n_years        int      not null default 0,
  primary key (month, day)
);

-- RLS: public can read, only service_role can write
alter table public.weather_climatology enable row level security;

create policy weather_climatology_public_read
  on public.weather_climatology
  for select
  using (true);

create policy weather_climatology_service_write
  on public.weather_climatology
  for all
  to service_role
  using (true)
  with check (true);

-- Revoke write from non-service roles
revoke insert, update, delete on public.weather_climatology from authenticated, anon;
