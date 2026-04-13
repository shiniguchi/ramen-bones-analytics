-- supabase/migrations/0001_tenancy_schema.sql
create extension if not exists pgcrypto;

create table public.restaurants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  timezone   text not null,
  created_at timestamptz not null default now()
);

create type public.membership_role as enum ('owner', 'viewer');

create table public.memberships (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  role          public.membership_role not null default 'owner',
  created_at    timestamptz not null default now()
);

alter table public.restaurants enable row level security;
alter table public.memberships enable row level security;

create policy restaurants_own on public.restaurants
  for select to authenticated
  using (id::text = auth.jwt()->>'restaurant_id');

create policy memberships_own on public.memberships
  for select to authenticated
  using (user_id = auth.uid());
