-- 0051_forecast_quality.sql
-- Phase 14: per-model evaluation results.
-- Stores RMSE, MAPE, bias, direction_hit_rate per evaluation window.
-- Same hybrid RLS pattern as forecast_daily (C-06).

create table public.forecast_quality (
  restaurant_id      uuid        not null references public.restaurants(id),
  kpi_name           text        not null,
  model_name         text        not null,
  evaluation_window  text        not null default 'last_7_days',
  n_days             int         not null,
  rmse               numeric     not null,
  mape               numeric     not null,
  bias               numeric,
  direction_hit_rate numeric,
  evaluated_at       timestamptz not null default now(),
  primary key (restaurant_id, kpi_name, model_name, evaluation_window, evaluated_at)
);

-- RLS: hybrid pattern — authenticated reads own tenant, service_role writes
alter table public.forecast_quality enable row level security;

create policy forecast_quality_tenant_read
  on public.forecast_quality
  for select
  to authenticated
  using (restaurant_id = (auth.jwt() ->> 'restaurant_id')::uuid);

create policy forecast_quality_service_write
  on public.forecast_quality
  for all
  to service_role
  using (true)
  with check (true);

revoke insert, update, delete on public.forecast_quality from authenticated, anon;
