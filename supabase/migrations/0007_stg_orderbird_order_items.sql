-- supabase/migrations/0007_stg_orderbird_order_items.sql
-- Phase 2 / ING-01: 1:1 item-level mirror of ramen_bones_order_items.csv.
-- PK is synthetic (restaurant_id, invoice_number, row_index) because natural
-- composite collides on split-bill duplicate item rows (see RESEARCH Pitfall 6).

create table public.stg_orderbird_order_items (
  restaurant_id          uuid not null references public.restaurants(id),
  invoice_number         text not null,
  row_index              integer not null,
  -- 29 CSV columns, stored as text (strict parsing happens in loader TS)
  csv_date               text,
  csv_time               text,
  item_name              text,
  quantity               text,
  item_price_eur         text,
  category_name          text,
  category_kind          text,
  table_name             text,
  tab_name               text,
  party_name             text,
  tax_rate_pct           text,
  sales_type             text,
  item_gross_amount_eur  text,
  invoice_total_eur      text,
  payment_method         text,
  processor              text,
  tip_eur                text,
  given_eur              text,
  change_eur             text,
  card_type              text,
  card_last4             text,
  card_txn_id            text,
  is_cash                text,
  order_id               text,
  wl_card_number         text,
  wl_card_type           text,
  wl_payment_type        text,
  wl_issuing_country     text,
  -- loader-added audit columns (D-03)
  ingested_at            timestamptz not null default now(),
  source_file            text not null,
  primary key (restaurant_id, invoice_number, row_index)
);

create index stg_orderbird_order_items_restaurant_invoice
  on public.stg_orderbird_order_items (restaurant_id, invoice_number);

alter table public.stg_orderbird_order_items enable row level security;

create policy stg_tenant_read on public.stg_orderbird_order_items
  for select to authenticated
  using (restaurant_id::text = (auth.jwt()->>'restaurant_id'));
