-- 0006_test_helpers.sql — service_role-only RPCs that let integration tests
-- introspect system catalogs (which PostgREST does not expose) and refresh
-- the kpi_daily_mv snapshot after seeding test tenants.

-- 1. Refresh kpi_daily_mv after seeding runtime fixtures.
--    Tenant-isolation tests must call this in beforeAll — otherwise their
--    runtime-seeded tenants are not present in the MV snapshot.
create or replace function public.refresh_kpi_daily_mv()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  execute 'refresh materialized view concurrently public.kpi_daily_mv';
end;
$$;
revoke all on function public.refresh_kpi_daily_mv() from public, anon, authenticated;
grant execute on function public.refresh_kpi_daily_mv() to service_role;

-- 2. Assert RLS is enabled on a given set of public-schema tables.
create or replace function public.test_rls_enabled(tables text[])
returns table(tablename text, rls_enabled boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.relname::text, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = any(tables);
$$;
revoke all on function public.test_rls_enabled(text[]) from public, anon, authenticated;
grant execute on function public.test_rls_enabled(text[]) to service_role;

-- 3. Check which privileges a given role holds on a given public-schema table/view.
--    Uses has_table_privilege to avoid depending on information_schema (which
--    PostgREST exposes unevenly across Supabase versions).
create or replace function public.test_table_privileges(table_name text, role_name text)
returns table(privilege_type text)
language sql
stable
security definer
set search_path = public
as $$
  select priv
  from unnest(array['SELECT','INSERT','UPDATE','DELETE']) as priv
  where has_table_privilege(role_name, format('public.%I', table_name), priv);
$$;
revoke all on function public.test_table_privileges(text, text) from public, anon, authenticated;
grant execute on function public.test_table_privileges(text, text) to service_role;

-- 4. Compute business_date for transactions of a given restaurant, using the
--    restaurant's timezone. Backs the FND-08 day-boundary fixture test.
create or replace function public.test_business_date(rid uuid)
returns table(source_tx_id text, business_date date)
language sql
stable
security definer
set search_path = public
as $$
  select t.source_tx_id, (t.occurred_at at time zone r.timezone)::date
  from public.transactions t
  join public.restaurants r on r.id = t.restaurant_id
  where t.restaurant_id = rid
  order by t.source_tx_id;
$$;
revoke all on function public.test_business_date(uuid) from public, anon, authenticated;
grant execute on function public.test_business_date(uuid) to service_role;
