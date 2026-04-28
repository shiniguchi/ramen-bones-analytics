-- 0041_weather_daily.sql
-- Phase 13 EXT-01: nightly weather observations + 7-day-forward forecast.
-- Shared location-keyed table — every restaurant in the city reads the same row.
-- Hybrid-RLS pattern (CONTEXT.md C-05): SELECT for everyone, writes service-role only.
-- Provider switchable via WEATHER_PROVIDER env (brightsky default, open-meteo dev).
-- Backfill window starts 2025-06-11; 7 days forward beyond today via forecast API.

create table if not exists public.weather_daily (
  date         date         not null,
  location     text         not null,
  temp_min_c   numeric,
  temp_max_c   numeric,
  precip_mm    numeric,
  wind_kph     numeric,
  cloud_cover  numeric,
  provider     text         not null,
  fetched_at   timestamptz  not null default now(),
  primary key (date, location)
);

-- Idempotent backfill via ON CONFLICT (date, location) DO UPDATE SET ... — the
-- composite PK above also serves as the natural-key unique index (D-03).

alter table public.weather_daily enable row level security;

-- Shared read: any authenticated session may read.
create policy weather_daily_read
  on public.weather_daily for select
  using (true);

-- Writes are service-role only.
revoke insert, update, delete on public.weather_daily from authenticated, anon;
grant select on public.weather_daily to authenticated, anon;
grant select, insert, update, delete on public.weather_daily to service_role;

-- Test helper RPC: returns column metadata for any public-schema table.
-- Used by integration tests to verify schema without relying on information_schema
-- (which PostgREST does not expose reliably). Service-role only.
create or replace function public.test_table_columns(p_table_name text)
returns table(column_name text, data_type text, is_nullable text)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.attname::text           as column_name,
    t.typname::text           as data_type,
    case when a.attnotnull then 'NO' else 'YES' end as is_nullable
  from pg_attribute a
  join pg_class     c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_type      t on t.oid = a.atttypid
  where n.nspname = 'public'
    and c.relname = p_table_name
    and a.attnum  > 0          -- exclude system columns
    and not a.attisdropped
  order by a.attnum;
$$;
revoke all on function public.test_table_columns(text) from public, anon, authenticated;
grant execute on function public.test_table_columns(text) to service_role;
