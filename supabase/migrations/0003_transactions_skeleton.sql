-- supabase/migrations/0003_transactions_skeleton.sql
-- Phase 2 will ALTER this table to add raw jsonb / additional columns as the scraper
-- introduces them. This phase owns the tenancy + RLS + timestamptz shape only.

create table public.transactions (
  restaurant_id  uuid not null references public.restaurants(id),
  source_tx_id   text not null,
  occurred_at    timestamptz not null,
  card_hash      text,
  gross_cents    integer not null,
  net_cents      integer not null,
  created_at     timestamptz not null default now(),
  primary key (restaurant_id, source_tx_id)
);

create index transactions_restaurant_occurred
  on public.transactions (restaurant_id, occurred_at);

alter table public.transactions enable row level security;

create policy tx_tenant_read on public.transactions
  for select to authenticated
  using (restaurant_id::text = (auth.jwt()->>'restaurant_id'));
