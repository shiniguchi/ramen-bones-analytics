-- supabase/migrations/0002_auth_hook.sql
-- Custom Access Token Hook: injects top-level `restaurant_id` claim into every JWT.
-- Reads from public.memberships. Idempotent for zero-membership users.
-- See docs/reference/auth-hook-registration.md for Dashboard registration steps.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  rid uuid;
  new_claims jsonb;
begin
  select restaurant_id into rid
  from public.memberships
  where user_id = (event->>'user_id')::uuid
  limit 1;

  new_claims := event->'claims';

  if rid is not null then
    new_claims := jsonb_set(new_claims, '{restaurant_id}', to_jsonb(rid::text));
  end if;

  return jsonb_build_object('claims', new_claims);
end;
$$;

-- Pitfall C guard: missing grants = silent auth failure.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;

grant usage on schema public to supabase_auth_admin;
grant select on public.memberships to supabase_auth_admin;
