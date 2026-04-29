-- 0050_forecast_daily.sql
-- Phase 14: forecast predictions in long format.
-- One row per (restaurant, kpi, target_date, model, run_date, track).
-- Composite PK lets multiple models + tracks coexist; MV collapses to
-- "latest run" per key (see 0052).

create table public.forecast_daily (
  restaurant_id  uuid        not null references public.restaurants(id),
  kpi_name       text        not null,
  target_date    date        not null,
  model_name     text        not null,
  run_date       date        not null,
  forecast_track text        not null default 'bau',
  yhat           numeric     not null,
  yhat_lower     numeric,
  yhat_upper     numeric,
  yhat_samples   jsonb,
  ci_level       numeric     not null default 0.95,
  horizon_days   int         generated always as ((target_date - run_date)) stored,
  exog_signature jsonb,
  fitted_at      timestamptz not null default now(),
  primary key (restaurant_id, kpi_name, target_date, model_name, run_date, forecast_track)
);

-- RLS: hybrid pattern (C-06) — authenticated can SELECT via tenant policy,
-- only service_role can INSERT/UPDATE/DELETE.
alter table public.forecast_daily enable row level security;

-- Tenant read policy
create policy forecast_daily_tenant_read
  on public.forecast_daily
  for select
  to authenticated
  using (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid);

-- Service role full access
create policy forecast_daily_service_write
  on public.forecast_daily
  for all
  to service_role
  using (true)
  with check (true);

-- Revoke write from non-service roles (hybrid RLS — C-06)
revoke insert, update, delete on public.forecast_daily from authenticated, anon;

-- Performance indexes
create index forecast_daily_model_horizon_idx
  on public.forecast_daily (restaurant_id, model_name, horizon_days);

create index forecast_daily_run_date_idx
  on public.forecast_daily (restaurant_id, run_date desc);
